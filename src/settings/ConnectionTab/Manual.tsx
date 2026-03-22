import { __ } from "@wordpress/i18n";
import { Button } from "@wordpress/components";
import { TextControl } from "@wordpress/components";
import { createInterpolateElement } from "@wordpress/element";

export default function Manual({
  isConnecting,
  apiKey,
  setApiKey,
  handleConnect,
  title,
}: {
  isConnecting: boolean;
  apiKey: string;
  setApiKey: (apiKey: string) => void;
  handleConnect: () => void;
  title: string;
}) {
  return (
    <>
      <h3>{title}</h3>
      <p>
        {createInterpolateElement(
          __(
            "Copy your API key from the <a>WPSignal dashboard</a> and paste it here.",
            "wordsocket",
          ),
          {
            a: (
              <a
                href="https://api.wpsignal.io/dashboard"
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          },
        )}
      </p>
      <TextControl
        className={`wpsignal-connection-input${
          isConnecting ? " is-loading" : ""
        }`}
        label={__("API Key", "wordsocket")}
        value={apiKey}
        minLength={64}
        maxLength={64}
        onChange={setApiKey}
        type="password"
        __nextHasNoMarginBottom
        __next40pxDefaultSize
      />
      <div className="wpsignal-connection-actions">
        <Button
          variant="secondary"
          onClick={handleConnect}
          isBusy={isConnecting}
          disabled={!apiKey || isConnecting || apiKey.length !== 64}
        >
          {__("Save Settings", "wordsocket")}
        </Button>
      </div>
    </>
  );
}
