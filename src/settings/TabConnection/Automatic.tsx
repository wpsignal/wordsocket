/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { Button } from "@wordpress/components";
import { Stack, Text } from "@wordpress/ui";
import { createInterpolateElement } from "@wordpress/element";

const { dashboardUrl = "https://api.wpsignal.io/dashboard" } =
  window.wpSignalConfig ?? {};

export default function Automatic({ isConnecting }: { isConnecting: boolean }) {
  const handleOAuthConnect = (): void => {
    const oauthStartUrl = window.wpsignalSettings?.oauthStartUrl;
    if (oauthStartUrl) {
      window.location.href = oauthStartUrl;
    }
  };
  return (
    <Stack direction="column" gap="md" align="flex-start">
      <Text variant="heading-md" render={<h3 />}>
        {__("Automatic Connection", "wordsocket")}
      </Text>
      <Text render={<p />}>
        {createInterpolateElement(
          __(
            "Log in to your <a>WPSignal dashboard</a> and authorize this site in one click.",
            "wordsocket",
          ),
          {
            a: (
              <a
                href={dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          },
        )}
      </Text>
      <Button
        variant="primary"
        onClick={handleOAuthConnect}
        isBusy={isConnecting}
      >
        {isConnecting
          ? __("Connecting...", "wordsocket")
          : __("Connect with WPSignal", "wordsocket")}
      </Button>
    </Stack>
  );
}
