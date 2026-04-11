import { __ } from "@wordpress/i18n";
import { Button } from "@wordpress/components";
import { createInterpolateElement } from "@wordpress/element";

export default function Automatic({ isConnecting }: { isConnecting: boolean }) {
  const handleOAuthConnect = (): void => {
    const oauthStartUrl = (window as any).wpsignalSettings?.oauthStartUrl;
    if (oauthStartUrl) {
      window.location.href = oauthStartUrl;
    }
  };
  return (
    <>
      <h3>{__("Automatic Connection", "wordsocket")}</h3>
      <p>
        {createInterpolateElement(__(
          "Log in to your <a>WPSignal dashboard</a> and authorize this site in one click.",
          "wordsocket",
        ), {
          a: <a href="https://api.wpsignal.io/dashboard" target="_blank" rel="noopener noreferrer" />,
        })}
      </p>
      <Button
        variant="primary"
        onClick={handleOAuthConnect}
        isBusy={isConnecting}
      >
        {isConnecting
          ? __("Connecting...", "wordsocket")
          : __("Connect with WPSignal", "wordsocket")}
      </Button>
    </>
  );
}
