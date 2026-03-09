import { Button } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

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
        {__(
          "Log in to your WPSignal dashboard and authorize this site in one click.",
          "wordsocket",
        )}
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
