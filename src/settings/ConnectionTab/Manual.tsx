import {Button} from "@wordpress/components";
import { TextControl } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

export default function Manual({
  isConnecting,
  apiKey,
  setApiKey,
  handleConnect,
}: {
  isConnecting: boolean;
  apiKey: string;
  setApiKey: (apiKey: string) => void;
  handleConnect: () => void;
}) {
  return (
    <>
      <h3>{__("Manual Connection", "wordsocket")}</h3>
      <p>
        {__(
          "Copy your API key from the WPSignal dashboard and paste it here.",
          "wordsocket",
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
