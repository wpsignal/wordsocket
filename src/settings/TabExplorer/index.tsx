/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { CollapsibleCard, Card, Badge } from "@wordpress/ui";
import { useState, useRef, useEffect } from "@wordpress/element";
import {
  Button,
  Icon,
  Tooltip,
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

const settings = window.wpsignalSettings ?? { triggers: [], baseUrl: "" };

const { isSsl = false } = window.wpSignalConfig ?? {};

interface LogEntry {
  text: string;
  color: string;
}

/**
 * PanelTriggers is a collapsible card with the registered triggers table.
 * This table combines triggers created in UI and triggers created in PHP.
 *
 * @TODO: Sync triggers between triggers tab and triggers table.
 */
function PanelTriggers() {
  const triggers = settings.triggers;
  if (!triggers.length) return null;
  return (
    <CollapsibleCard.Root style={{ gridColumn: "span 2" }}>
      <CollapsibleCard.Header>
        <Card.Title>{__("Registered Triggers", "wordsocket")}</Card.Title>
      </CollapsibleCard.Header>
      <CollapsibleCard.Content>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 2fr auto auto 1fr auto",
            fontSize: 13,
            borderTop: "1px solid #ddd",
            borderLeft: "1px solid #ddd",
          }}
        >
          {[
            __("Event", "wordsocket"),
            __("Hook", "wordsocket"),
            __("Priority", "wordsocket"),
            __("Args", "wordsocket"),
            __("Channel", "wordsocket"),
            __("Condition", "wordsocket"),
          ].map((h) => (
            <div
              key={h}
              style={{
                fontWeight: 600,
                padding: "8px 12px",
                background: "#f0f0f1",
                borderRight: "1px solid #ddd",
                borderBottom: "1px solid #ddd",
              }}
            >
              {h}
            </div>
          ))}
          {triggers.flatMap((t, i) => {
            const bg = i % 2 ? "#f9f9f9" : "#fff";
            const cell = (key: string, content: React.ReactNode) => (
              <div
                key={key}
                style={{
                  padding: "8px 12px",
                  background: bg,
                  borderRight: "1px solid #ddd",
                  borderBottom: "1px solid #ddd",
                }}
              >
                {content}
              </div>
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
        ˝
      </CollapsibleCard.Content>
    </CollapsibleCard.Root>
  );
}

// @TODO: Unused, but demos how to test the connection status.
function PanelConnection() {
  const { isConnected, siteKey } = useSettings();
  const [testText, setTestText] = useState("");
  const [testOk, setTestOk] = useState(true);

  function test() {
    setTestText(__("Testing...", "wordsocket"));
    const url = (settings.baseUrl ?? "").replace(/\/+$/, "") + "/healthz";
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(() => {
        setTestOk(true);
        setTestText(__("OK", "wordsocket"));
      })
      .catch((err: Error) => {
        setTestOk(false);
        setTestText(`${__("Failed:", "wordsocket")} ${err.message}`);
      });
  }

  return (
    <Card.Root className="wpsignal-card">
      <h3>{__("Connection Status", "wordsocket")}</h3>
      {isConnected ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "max-content 1fr",
              gap: "8px 20px",
              alignItems: "baseline",
              marginBottom: 12,
            }}
          >
            <strong>{__("Server URL", "wordsocket")}</strong>
            <code>{settings.baseUrl}</code>
            <strong>{__("Site Key", "wordsocket")}</strong>
            <code>{siteKey}</code>
          </div>
          <Button variant="secondary" onClick={test}>
            {__("Test Connection", "wordsocket")}
          </Button>
          {testText && (
            <span
              style={{ marginLeft: 10, color: testOk ? "#46b450" : "#dc3232" }}
            >
              {testText}
            </span>
          )}
        </>
      ) : (
        <p style={{ color: "#dc3232" }}>
          {__(
            "Not configured. Go to Connect to set up the plugin.",
            "wordsocket",
          )}
        </p>
      )}
    </Card.Root>
  );
}

/**
 * PanelEventLog is a collapsible card with the event log.
 * This log is used to display the events that are published to the server.
 *
 * @TODO: Add a way to clear the log.
 */
function PanelEventLog({
  isConnected,
  setIsConnected,
}: {
  isConnected: boolean;
  setIsConnected: (isConnected: boolean) => void;
}) {
  const [channels, setChannels] = useState("events");
  const [wsStatus, setWsStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [log, setLog] = useState<LogEntry[]>([
    {
      text: __("Waiting for connection...", "wordsocket"),
      color: "#72aee6",
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

  function addLog(text: string, color = "#c3c4c7") {
    const time = new Date().toLocaleTimeString();
    setLog((prev) => [...prev, { text: `${time}  ${text}`, color }]);
  }

  function connect() {
    setLog([{ text: __("Fetching token...", "wordsocket"), color: "#72aee6" }]);
    setWsStatus("connecting");

    getToken()
      .then(({ token }) => {
        const baseUrl = new URL(settings?.baseUrl ?? "");
        const proto = isSsl ? "wss" : "ws";
        const host = baseUrl.host;
        const ws = new WebSocket(
          `${proto}://${host}/ws?token=${encodeURIComponent(token)}`,
        );
        wsRef.current = ws;

        addLog(__("Connecting...", "wordsocket"), "#72aee6");

        ws.addEventListener("open", () => {
          setWsStatus("connected");
          setIsConnected(true);
          addLog(__("Connected", "wordsocket"), "#46b450");
          const list = channels.split(",").map((c) => c.trim());
          ws.send(JSON.stringify({ type: "subscribe", channels: list }));
          addLog(
            `${__("Subscribing to:", "wordsocket")} ${list.join(", ")}`,
            "#72aee6",
          );
        });

        ws.addEventListener("message", (e: MessageEvent) => {
          try {
            const msg = JSON.parse(e.data);
            switch (msg.type) {
              case "message":
                addLog(
                  `[${msg.channel}] ${msg.event}: ${JSON.stringify(msg.data)}`,
                  "#00e676",
                );
                break;
              case "subscribed":
                addLog(
                  `${__("Subscribed to:", "wordsocket")} ${(msg.channels || []).join(", ")}`,
                  "#72aee6",
                );
                break;
              case "unsubscribed":
                addLog(
                  `${__("Unsubscribed from:", "wordsocket")} ${(msg.channels || []).join(", ")}`,
                  "#ffb74d",
                );
                break;
              case "ping":
                ws.send(JSON.stringify({ type: "pong" }));
                break;
              case "error":
                addLog(
                  `${__("Error:", "wordsocket")} ${msg.code}: ${msg.message}`,
                  "#dc3232",
                );
                break;
              default:
                addLog(JSON.stringify(msg));
            }
          } catch (err) {
            addLog(
              `${__("Parse error:", "wordsocket")} ${(err as Error).message}`,
              "#dc3232",
            );
          }
        });

        ws.addEventListener("close", (e: CloseEvent) => {
          setWsStatus("disconnected");
          setIsConnected(false);
          addLog(
            `${__("Disconnected", "wordsocket")} (code=${e.code})`,
            "#ffb74d",
          );
          wsRef.current = null;
        });

        ws.addEventListener("error", () => {
          setIsConnected(false);
          addLog(__("WebSocket error", "wordsocket"), "#dc3232");
        });
      })
      .catch((err: Error) => {
        setWsStatus("disconnected");
        addLog(`${__("Error:", "wordsocket")} ${err.message}`, "#dc3232");
      });
  }

  function disconnect() {
    wsRef.current?.close();
  }

  const isWsConnected = wsStatus === "connected";

  return (
    <Card.Root className="wpsignal-card">
      <Card.Title>
        {__("Event Log", "wordsocket")}{" "}
        {isWsConnected ? (
          <Badge intent="stable">{__("Connected", "wordsocket")}</Badge>
        ) : (
          <Badge intent="none">{__("Not connected", "wordsocket")}</Badge>
        )}{" "}
        {wsStatus === "connecting" && (
          <small style={{ marginLeft: 10, color: "#46b450" }}>
            {__("Connecting...", "wordsocket")}
          </small>
        )}
      </Card.Title>
      <Card.Content>
        <TextControl
          label={__("Channels (comma-separated):", "wordsocket")}
          value={channels}
          onChange={(value: string) => setChannels(value)}
          disabled={isWsConnected}
        />
        <p>
          <Button
            variant="primary"
            onClick={connect}
            disabled={wsStatus !== "disconnected"}
          >
            {__("Connect", "wordsocket")}
          </Button>{" "}
          <Button
            variant="secondary"
            onClick={disconnect}
            disabled={wsStatus === "disconnected"}
          >
            {__("Disconnect", "wordsocket")}
          </Button>
        </p>
        <div
          ref={logRef}
          style={{
            maxHeight: 300,
            overflowY: "auto",
            background: "#1d2327",
            padding: 10,
            fontFamily: "monospace",
            fontSize: 13,
            borderRadius: 4,
          }}
        >
          {log.map((entry, i) => (
            <div key={i} style={{ color: entry.color }}>
              {entry.text}
            </div>
          ))}
        </div>
      </Card.Content>
    </Card.Root>
  );
}

/**
 * PanelPublish is a collapsible card with the publish test event form.
 * This form is used to publish test events to the server.
 */
function PanelPublish({ isConnected }: { isConnected: boolean }) {
  const [channel, setChannel] = useState("events");
  const [event, setEvent] = useState("test.event");
  const [data, setData] = useState('{"message":"Hello from Explorer!"}');
  const [statusText, setStatusText] = useState("");
  const [statusOk, setStatusOk] = useState(true);

  function publish() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      setStatusOk(false);
      setStatusText(
        `${__("Invalid JSON:", "wordsocket")} ${(err as Error).message}`,
      );
      return;
    }
    setStatusOk(true);
    setStatusText(__("Publishing...", "wordsocket"));
    publishEvent(channel, event, parsed)
      .then(() => {
        setStatusOk(true);
        setStatusText(__("Published!", "wordsocket"));
      })
      .catch((err: Error) => {
        setStatusOk(false);
        setStatusText(`${__("Failed:", "wordsocket")} ${err.message}`);
      });
  }

  useEffect(() => {
    if (!isConnected) {
      setStatusText("");
    }
  }, [isConnected, statusText]);

  return (
    <Card.Root className="wpsignal-card">
      <Card.Title>{__("Publish Test Event", "wordsocket")}</Card.Title>
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
                {__("Click connect under Event Log to publish events.")}
              </Notice>
            ) : (
              <>
                <Button variant="primary" onClick={publish}>
                  {__("Publish Event", "wordsocket")}
                </Button>
                {statusText && (
                  <span
                    style={{
                      marginLeft: 10,
                      color: statusOk ? "#46b450" : "#dc3232",
                    }}
                  >
                    {statusText}
                  </span>
                )}
              </>
            )}
          </FlexItem>
        </Flex>
      </Card.Content>
    </Card.Root>
  );
}

/**
 * PanelToken is a collapsible card with the token inspector.
 * This inspector is used to inspect the token, and claims, that is used to authenticate the client.
 */
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
  let expiryColor = "#46b450";
  if (remaining !== null) {
    if (remaining > 0) {
      expiryText = `${__("Expires in:", "wordsocket")} ${Math.floor(remaining / 60)}m ${remaining % 60}s`;
      expiryColor = remaining < 60 ? "#dc3232" : "#46b450";
    } else {
      expiryText = __("Expired", "wordsocket");
      expiryColor = "#dc3232";
    }
  }

  return (
    <CollapsibleCard.Root style={{ gridColumn: "span 2" }}>
      <CollapsibleCard.Header>
        <Card.Title>{__("Token Inspector", "wordsocket")}</Card.Title>
      </CollapsibleCard.Header>
      <CollapsibleCard.Content>
        <Flex direction="column">
          <FlexItem>
            {error && <p style={{ color: "#dc3232" }}>{error}</p>}
            {tokenData && (
              <>
                <h4>{__("Raw Token", "wordsocket")}</h4>
                <TextareaControl
                  className="large-text"
                  rows={3}
                  readOnly
                  value={tokenData.raw}
                  onChange={() => {}}
                />
                <h4>{__("Decoded Claims", "wordsocket")}</h4>
                <pre
                  style={{
                    background: "#f0f0f1",
                    padding: 10,
                    overflowX: "auto",
                    fontSize: 12,
                  }}
                >
                  <code>{JSON.stringify(tokenData.claims, null, 2)}</code>
                </pre>
                {expiryText && (
                  <p style={{ color: expiryColor }}>{expiryText}</p>
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

/**
 * TabExplorer is the main component for the Explorer tab.
 * This tab is used to test and debug the WordSocket plugin.
 */
export function TabExplorer({ title }: { title: string }) {
  const [isConnected, setIsConnected] = useState(false);
  return (
    <div className="wpsignal-explorer-tab">
      <h2>
        <Tooltip
          text={__(
            "Explorer is a tool for testing and debugging WPSignal events.",
            "wordsocket",
          )}
        >
          <span>
            <Icon size={16} icon="editor-help" />
          </span>
        </Tooltip>{" "}
        {title}
      </h2>
      <p>
        {__(
          "View registered triggers and publish test events to see realtime event handling in action.",
          "wordsocket",
        )}
      </p>
      <div className="wpsignal-cards">
        <PanelTriggers />
        <PanelEventLog
          isConnected={isConnected}
          setIsConnected={setIsConnected}
        />
        <PanelPublish isConnected={isConnected} />
        <PanelToken />
      </div>
    </div>
  );
}
