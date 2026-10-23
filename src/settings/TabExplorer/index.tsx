/**
 * WordPress dependencies.
 */
import { __, sprintf } from "@wordpress/i18n";
import { CollapsibleCard, Card, Badge, Stack, Text } from "@wordpress/ui";
import { useState, useRef, useEffect } from "@wordpress/element";
import {
  Button,
  TextControl,
  TextareaControl,
  FlexBlock,
  Flex,
  FlexItem,
  Notice,
} from "@wordpress/components";

/**
 * Internal dependencies.
 */
import { useSettings } from "../context";
import { getToken, publishEvent } from "../api";
import { useTask } from "../useTask";
import { relayEndpoints, withQuery } from "../../utils/relay";
import { TabHeading } from "../TabHeading";

const settings = window.wpsignalSettings ?? { triggers: [], baseUrl: "" };

/** A log line's tone picks its colour token in the stylesheet. */
type Tone = "info" | "success" | "warning" | "error" | "neutral";

interface LogEntry {
  text: string;
  tone: Tone;
}

const LOG_LINES = 500;

// TODO: sync triggers between triggers tab and triggers table.
function PanelTriggers() {
  const triggers: WpSignalTriggerRow[] = settings.triggers ?? [];
  if (!triggers.length) return null;
  return (
    <CollapsibleCard.Root className="wpsignal-card--wide">
      <CollapsibleCard.Header>
        <Card.Title>{__("Registered Triggers", "wordsocket")}</Card.Title>
      </CollapsibleCard.Header>
      <CollapsibleCard.Content>
        <div className="wpsignal-triggers-table">
          {[
            __("Event", "wordsocket"),
            __("Hook", "wordsocket"),
            __("Priority", "wordsocket"),
            __("Args", "wordsocket"),
            __("Channel", "wordsocket"),
            __("Condition", "wordsocket"),
          ].map((h) => (
            <div key={h} className="is-head">
              {h}
            </div>
          ))}
          {triggers.flatMap((t, i) => {
            const cell = (key: string, content: React.ReactNode) => (
              <div key={key}>{content}</div>
            );
            return [
              cell(`${i}-e`, <code>{t.event}</code>),
              cell(`${i}-h`, <code>{t.hook}</code>),
              cell(`${i}-p`, t.priority),
              cell(`${i}-a`, t.args),
              cell(`${i}-c`, <code>{t.channel}</code>),
              cell(`${i}-cond`, t.condition ? "✓" : "—"),
            ];
          })}
        </div>
      </CollapsibleCard.Content>
    </CollapsibleCard.Root>
  );
}

function PanelEventLog({
  setIsConnected,
}: {
  setIsConnected: (isConnected: boolean) => void;
}) {
  const [channels, setChannels] = useState("events");
  const [wsStatus, setWsStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [log, setLog] = useState<LogEntry[]>([
    {
      text: __("Waiting for connection...", "wordsocket"),
      tone: "info",
    },
  ]);
  const wsRef = useRef<WebSocket | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(
    () => () => {
      wsRef.current?.close();
    },
    [],
  );

  /* The newest LOG_LINES only, so a long session does not grow the page without end. */
  function addLog(text: string, tone: Tone = "neutral") {
    const time = new Date().toLocaleTimeString();
    setLog((prev) =>
      [...prev, { text: `${time}  ${text}`, tone }].slice(-LOG_LINES),
    );
  }

  function connect() {
    setLog([{ text: __("Fetching token...", "wordsocket"), tone: "info" }]);
    setWsStatus("connecting");

    getToken()
      .then(({ token }) => {
        // The endpoint comes from PHP, so an http:// admin still talks to a wss:// relay.
        const ws = new WebSocket(
          withQuery(relayEndpoints(settings).ws, { token }),
        );
        wsRef.current = ws;

        addLog(__("Connecting...", "wordsocket"), "info");

        ws.addEventListener("open", () => {
          setWsStatus("connected");
          setIsConnected(true);
          addLog(__("Connected", "wordsocket"), "success");
          const list = channels.split(",").map((c) => c.trim());
          ws.send(JSON.stringify({ type: "subscribe", channels: list }));
          addLog(
            `${__("Subscribing to:", "wordsocket")} ${list.join(", ")}`,
            "info",
          );
        });

        ws.addEventListener("message", (e: MessageEvent) => {
          try {
            const msg = JSON.parse(e.data);
            switch (msg.type) {
              case "message":
                addLog(
                  `[${msg.channel}] ${msg.event}: ${JSON.stringify(msg.data)}`,
                  "success",
                );
                break;
              case "subscribed":
                addLog(
                  `${__("Subscribed to:", "wordsocket")} ${(
                    msg.channels || []
                  ).join(", ")}`,
                  "info",
                );
                break;
              case "unsubscribed":
                addLog(
                  `${__("Unsubscribed from:", "wordsocket")} ${(
                    msg.channels || []
                  ).join(", ")}`,
                  "warning",
                );
                break;
              case "ping":
                ws.send(JSON.stringify({ type: "pong" }));
                break;
              case "error":
                addLog(
                  `${__("Error:", "wordsocket")} ${msg.code}: ${msg.message}`,
                  "error",
                );
                break;
              default:
                addLog(JSON.stringify(msg));
            }
          } catch (err) {
            addLog(
              `${__("Parse error:", "wordsocket")} ${(err as Error).message}`,
              "error",
            );
          }
        });

        ws.addEventListener("close", (e: CloseEvent) => {
          setWsStatus("disconnected");
          setIsConnected(false);
          addLog(
            `${__("Disconnected", "wordsocket")} (code=${e.code})`,
            "warning",
          );
          wsRef.current = null;
        });

        ws.addEventListener("error", () => {
          setIsConnected(false);
          addLog(__("WebSocket error", "wordsocket"), "error");
        });
      })
      .catch((err: Error) => {
        setWsStatus("disconnected");
        addLog(`${__("Error:", "wordsocket")} ${err.message}`, "error");
      });
  }

  function disconnect() {
    wsRef.current?.close();
  }

  const isWsConnected = wsStatus === "connected";

  return (
    <Card.Root>
      <Card.Header>
        <Stack direction="row" gap="sm" align="center" wrap="wrap">
          <Card.Title>{__("Event Log", "wordsocket")}</Card.Title>
          {isWsConnected ? (
            <Badge intent="stable">{__("Connected", "wordsocket")}</Badge>
          ) : (
            <Badge intent="none">{__("Not connected", "wordsocket")}</Badge>
          )}
          {wsStatus === "connecting" && (
            <Text variant="body-sm" className="wpsignal-tone-success">
              {__("Connecting...", "wordsocket")}
            </Text>
          )}
        </Stack>
      </Card.Header>
      <Card.Content>
        <Stack direction="column" gap="md">
          <TextControl
            label={__("Channels (comma-separated):", "wordsocket")}
            value={channels}
            onChange={(value: string) => setChannels(value)}
            disabled={isWsConnected}
            __next40pxDefaultSize
            __nextHasNoMarginBottom
          />
          <p ref={logRef} className="wpsignal-explorer-output">
            {log.map((entry, i) => (
              <span key={i} className={`is-${entry.tone}`}>
                {entry.text}
              </span>
            ))}
          </p>
          <Stack direction="row" gap="sm">
            <Button
              variant="primary"
              onClick={connect}
              disabled={wsStatus !== "disconnected"}
            >
              {__("Connect", "wordsocket")}
            </Button>
            <Button
              variant="secondary"
              onClick={disconnect}
              disabled={wsStatus === "disconnected"}
            >
              {__("Disconnect", "wordsocket")}
            </Button>
          </Stack>
        </Stack>
      </Card.Content>
    </Card.Root>
  );
}

function PanelPublish({ isConnected }: { isConnected: boolean }) {
  const [channel, setChannel] = useState("events");
  const [event, setEvent] = useState("test.event");
  const [data, setData] = useState('{"message":"Hello from Explorer!"}');
  const publishTask = useTask(
    async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch (err) {
        throw new Error(
          `${__("Invalid JSON:", "wordsocket")} ${(err as Error).message}`,
        );
      }
      return publishEvent(channel, event, parsed);
    },
    {
      pending: __("Publishing...", "wordsocket"),
      success: __("Published.", "wordsocket"),
      error: (err) =>
        `${__("Failed:", "wordsocket")} ${(err as Error).message}`,
    },
  );

  return (
    <Card.Root>
      <Card.Header>
        <Card.Title>{__("Publish Test Event", "wordsocket")}</Card.Title>
      </Card.Header>
      <Card.Content>
        <Flex direction="column">
          <FlexBlock>
            <TextControl
              disabled={!isConnected}
              label={__("Channel", "wordsocket")}
              value={channel}
              onChange={(value: string) => setChannel(value)}
              __nextHasNoMarginBottom
              __next40pxDefaultSize
            />
          </FlexBlock>
          <FlexBlock>
            <TextControl
              disabled={!isConnected}
              label={__("Event Name", "wordsocket")}
              value={event}
              onChange={(value: string) => setEvent(value)}
              __nextHasNoMarginBottom
              __next40pxDefaultSize
            />
          </FlexBlock>
          <FlexItem>
            <TextareaControl
              disabled={!isConnected}
              label={__("JSON Data", "wordsocket")}
              value={data}
              onChange={(value: string) => setData(value)}
              rows={4}
              __nextHasNoMarginBottom
            />
          </FlexItem>
          <FlexItem>
            {!isConnected ? (
              <Notice status="warning" isDismissible={false}>
                {__(
                  "Click connect under Event Log to publish events.",
                  "wordsocket",
                )}
              </Notice>
            ) : (
              <>
                <Button
                  variant="primary"
                  onClick={() => publishTask.run()}
                  isBusy={publishTask.isPending}
                  disabled={publishTask.isPending}
                >
                  {__("Publish Event", "wordsocket")}
                </Button>
              </>
            )}
          </FlexItem>
        </Flex>
      </Card.Content>
    </Card.Root>
  );
}

function PanelToken() {
  const [tokenData, setTokenData] = useState<{
    raw: string;
    claims: Record<string, unknown>;
  } | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    },
    [],
  );

  function mint() {
    setError("");
    getToken()
      .then(({ token }) => {
        const parts = token.split(".");
        const claims = JSON.parse(
          atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
        );
        setTokenData({ raw: token, claims });
        if (intervalRef.current) clearInterval(intervalRef.current);
        const tick = () =>
          setRemaining(claims.exp - Math.floor(Date.now() / 1000));
        tick();
        intervalRef.current = setInterval(tick, 1000);
      })
      .catch((err: Error) => setError(err.message));
  }

  let expiryText = "";
  let expiryTone = "wpsignal-tone-success";
  if (remaining !== null) {
    if (remaining > 0) {
      expiryText = sprintf(
        /* translators: 1: minutes, 2: seconds */
        __("Expires in: %1$dm %2$ds", "wordsocket"),
        Math.floor(remaining / 60),
        remaining % 60,
      );
      expiryTone =
        remaining < 60 ? "wpsignal-tone-error" : "wpsignal-tone-success";
    } else {
      expiryText = __("Expired", "wordsocket");
      expiryTone = "wpsignal-tone-error";
    }
  }

  return (
    <CollapsibleCard.Root className="wpsignal-card--wide">
      <CollapsibleCard.Header>
        <Card.Title>{__("Token Inspector", "wordsocket")}</Card.Title>
      </CollapsibleCard.Header>
      <CollapsibleCard.Content>
        <Flex direction="column">
          <FlexItem>
            {error && (
              <Text className="wpsignal-tone-error" render={<p />}>
                {error}
              </Text>
            )}
            {tokenData && (
              <>
                <Text variant="heading-sm" render={<h4 />}>
                  {__("Raw Token", "wordsocket")}
                </Text>
                <TextareaControl
                  className="large-text"
                  rows={3}
                  readOnly
                  value={tokenData.raw}
                  onChange={() => {}}
                />
                <Text variant="heading-sm" render={<h4 />}>
                  {__("Decoded Claims", "wordsocket")}
                </Text>
                <pre className="wpsignal-explorer-claims">
                  <code>{JSON.stringify(tokenData.claims, null, 2)}</code>
                </pre>
                {expiryText && (
                  <Text className={expiryTone} render={<p />}>
                    {expiryText}
                  </Text>
                )}
              </>
            )}
          </FlexItem>
          <FlexItem>
            <Button variant="secondary" onClick={mint}>
              {__("Mint Token", "wordsocket")}
            </Button>
          </FlexItem>
        </Flex>
      </CollapsibleCard.Content>
    </CollapsibleCard.Root>
  );
}

export function TabExplorer({ title }: { title: string }) {
  const [isConnected, setIsConnected] = useState(false);
  return (
    <Stack direction="column" gap="lg" className="wpsignal-explorer-tab">
      <TabHeading
        title={title}
        help={__(
          "Explorer is a tool for testing and debugging WPSignal events.",
          "wordsocket",
        )}
      />
      <Text render={<p />}>
        {__(
          "View registered triggers and publish test events to see realtime event handling in action.",
          "wordsocket",
        )}
      </Text>
      <div className="wpsignal-cards">
        <PanelTriggers />
        <PanelEventLog setIsConnected={setIsConnected} />
        <PanelPublish isConnected={isConnected} />
        <PanelToken />
      </div>
    </Stack>
  );
}
