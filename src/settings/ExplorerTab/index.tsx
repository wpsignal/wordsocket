/**
 * WordPress dependencies.
 */
import { useState, useRef, useEffect } from "@wordpress/element";
import { Button, Icon, Tooltip } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import { useSettings } from "../context";
import { getToken, publishEvent } from "../api";

const settings = window.wpsignalSettings ?? { triggers: [], baseUrl: "" };

interface LogEntry {
  text: string;
  color: string;
}

function ConnectionPanel() {
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
    <div className="wpsignal-section">
      <h3>{__("Connection Status", "wordsocket")}</h3>
      {isConnected ? (
        <>
          <table
            className="form-table"
            role="presentation"
            style={{ marginBottom: 10 }}
          >
            <tbody>
              <tr>
                <th scope="row">{__("Server URL", "wordsocket")}</th>
                <td>
                  <code>{settings.baseUrl}</code>
                </td>
              </tr>
              <tr>
                <th scope="row">{__("Site Key", "wordsocket")}</th>
                <td>
                  <code>{siteKey}</code>
                </td>
              </tr>
            </tbody>
          </table>
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
    </div>
  );
}

function TriggersPanel() {
  const triggers = settings.triggers;
  if (!triggers.length) return null;
  return (
    <div className="wpsignal-section" style={{ maxWidth: "100%", marginBottom: 16 }}>
      <h3>{__("Registered Triggers", "wordsocket")}</h3>
      <table className="widefat striped">
        <thead>
          <tr>
            <th>{__("Event", "wordsocket")}</th>
            <th>{__("Hook", "wordsocket")}</th>
            <th>{__("Priority", "wordsocket")}</th>
            <th>{__("Args", "wordsocket")}</th>
            <th>{__("Channel", "wordsocket")}</th>
            <th>{__("Condition", "wordsocket")}</th>
          </tr>
        </thead>
        <tbody>
          {triggers.map((t, i) => (
            <tr key={i}>
              <td>
                <code>{t.event}</code>
              </td>
              <td>
                <code>{t.hook}</code>
              </td>
              <td>{t.priority}</td>
              <td>{t.args}</td>
              <td>
                <code>{t.channel}</code>
              </td>
              <td>{t.condition ? "✓" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventLogPanel() {
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
    if (logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  function addLog(text: string, color = "#c3c4c7") {
    const time = new Date().toLocaleTimeString();
    setLog((prev) => [...prev, { text: `${time}  ${text}`, color }]);
  }

  function connect() {
    setLog([{ text: __("Fetching token...", "wordsocket"), color: "#72aee6" }]);
    setWsStatus("connecting");

    getToken()
      .then(({ token }) => {
        const base = (settings?.baseUrl ?? "").replace(/\/+$/, "");
        const proto = base.startsWith("https") ? "wss" : "ws";
        const host = base.replace(/^https?:\/\//, "");
        const ws = new WebSocket(
          `${proto}://${host}/ws?token=${encodeURIComponent(token)}`,
        );
        wsRef.current = ws;

        addLog(__("Connecting...", "wordsocket"), "#72aee6");

        ws.addEventListener("open", () => {
          setWsStatus("connected");
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
          addLog(
            `${__("Disconnected", "wordsocket")} (code=${e.code})`,
            "#ffb74d",
          );
          wsRef.current = null;
        });

        ws.addEventListener("error", () =>
          addLog(__("WebSocket error", "wordsocket"), "#dc3232"),
        );
      })
      .catch((err: Error) => {
        setWsStatus("disconnected");
        addLog(`${__("Error:", "wordsocket")} ${err.message}`, "#dc3232");
      });
  }

  function disconnect() {
    wsRef.current?.close();
  }

  return (
    <div className="wpsignal-section">
      <h3>{__("Live Event Log", "wordsocket")}</h3>
      <p>
        <label style={{ marginRight: 8 }} htmlFor="wpsignal-exp-channels">
          {__("Channels (comma-separated):", "wordsocket")}
        </label>
        <input
          id="wpsignal-exp-channels"
          type="text"
          value={channels}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setChannels(e.target.value)
          }
          className="regular-text"
          disabled={wsStatus !== "disconnected"}
        />
      </p>
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
        {wsStatus === "connected" && (
          <span style={{ marginLeft: 10, color: "#46b450" }}>
            {__("Connected", "wordsocket")}
          </span>
        )}
        {wsStatus === "connecting" && (
          <span style={{ marginLeft: 10, color: "#72aee6" }}>
            {__("Connecting...", "wordsocket")}
          </span>
        )}
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
    </div>
  );
}

function PublishPanel() {
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

  return (
    <div className="wpsignal-section">
      <h3>{__("Publish Test Event", "wordsocket")}</h3>
      <table className="form-table" role="presentation">
        <tbody>
          <tr>
            <th scope="row">
              <label htmlFor="wpsignal-exp-ch">
                {__("Channel", "wordsocket")}
              </label>
            </th>
            <td>
              <input
                id="wpsignal-exp-ch"
                type="text"
                value={channel}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setChannel(e.target.value)
                }
                className="regular-text"
              />
            </td>
          </tr>
          <tr>
            <th scope="row">
              <label htmlFor="wpsignal-exp-ev">
                {__("Event Name", "wordsocket")}
              </label>
            </th>
            <td>
              <input
                id="wpsignal-exp-ev"
                type="text"
                value={event}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setEvent(e.target.value)
                }
                className="regular-text"
              />
            </td>
          </tr>
          <tr>
            <th scope="row">
              <label htmlFor="wpsignal-exp-data">
                {__("JSON Data", "wordsocket")}
              </label>
            </th>
            <td>
              <textarea
                id="wpsignal-exp-data"
                value={data}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setData(e.target.value)
                }
                className="large-text"
                rows={4}
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p>
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
      </p>
    </div>
  );
}

function TokenPanel() {
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
    <div className="wpsignal-section" style={{ maxWidth: "100%", marginBottom: 16 }}>
      <h3>{__("Token Inspector", "wordsocket")}</h3>
      <p>
        <Button variant="secondary" onClick={mint}>
          {__("Mint Token", "wordsocket")}
        </Button>
      </p>
      {error && <p style={{ color: "#dc3232" }}>{error}</p>}
      {tokenData && (
        <>
          <h4>{__("Raw Token", "wordsocket")}</h4>
          <textarea
            className="large-text"
            rows={3}
            readOnly
            value={tokenData.raw}
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
            {JSON.stringify(tokenData.claims, null, 2)}
          </pre>
          {expiryText && <p style={{ color: expiryColor }}>{expiryText}</p>}
        </>
      )}
    </div>
  );
}

export function ExplorerTab() {
  return (
    <div className="wpsignal-explorer-tab">
      <h3>
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
        {__("Explorer", "wordsocket")}{" "}
      </h3>
      <p>{__("Test your connection, view registered triggers, and publish test events to see realtime event handling in action.", "wordsocket")}</p>
      <ConnectionPanel />
      <TriggersPanel />
      <EventLogPanel />
      <PublishPanel />
      <TokenPanel />
    </div>
  );
}
