/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { useEffect, useState } from "@wordpress/element";
import { Notice } from "@wordpress/components";
import { Badge, ButtonLink, Card, Spinner, Stack, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { getExtensions } from "../api";
import { useSettings } from "../context";
import { ExtensionPanelSlot } from "../extensions/api";
import { TabHeading } from "../TabHeading";

/**
 * Whether a link leaves this site. The installer lives in this wp-admin and
 * opens in place; wpsignal.io pages open in a new tab.
 */
function isExternal(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return true;
  }
}

/**
 * Extensions tab: cards rendered by installed extensions (through the slot),
 * followed by the catalogue of extensions not installed here.
 */
export function TabExtensions({ title }: { title: string }) {
  const { isConnected } = useSettings();
  const [extensions, setExtensions] = useState<
    WordSocketExtensionInfo[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getExtensions()
      .then((res) => setExtensions(res.extensions))
      .catch((err: any) =>
        setError(
          err?.message || __("Could not load extensions.", "wordsocket"),
        ),
      );
  }, []);

  const catalogue = (extensions ?? []).filter((ext) => !ext.installed);
  const comingSoon = catalogue.some((ext) => !ext.available);
  const needing = (extensions ?? []).filter(
    (ext) => ext.installed && ext.missing.length > 0,
  );

  return (
    <Stack direction="column" gap="lg" className="wpsignal-extensions-tab">
      <TabHeading title={title} />
      <Text render={<p />}>
        {__(
          "Extensions are WordPress plugins built on WordSocket.",
          "wordsocket",
        )}
      </Text>

      <Text variant="heading-sm" render={<h4 />}>
        {__("Installed extensions", "wordsocket")}
      </Text>

      {error && (
        <Notice status="error" isDismissible={false}>
          {error}
        </Notice>
      )}
      {!isConnected && (
        <Notice status="info" isDismissible={false}>
          {__(
            "Connect your site on the Connect tab to use installed extensions.",
            "wordsocket",
          )}
        </Notice>
      )}
      {needing.map((ext) => (
        <Notice key={ext.slug} status="warning" isDismissible={false}>
          {ext.title}: {__("requires", "wordsocket")} {ext.missing.join(", ")}.
        </Notice>
      ))}

      <div className="wpsignal-extensions-installed">
        <ExtensionPanelSlot />
      </div>

      {extensions === null && !error && <Spinner />}
      {catalogue.length > 0 && (
        <Stack direction="column" gap="md">
          <Text variant="heading-sm" render={<h4 />}>
            {__("Available extensions", "wordsocket")}
          </Text>
          <Text render={<p />}>
            {comingSoon
              ? __(
                  "Install the ones that are ready now. The rest are coming soon.",
                  "wordsocket",
                )
              : __("Install any of these from WordPress.org.", "wordsocket")}
          </Text>
          <div className="wpsignal-extensions-grid">
            {catalogue.map((ext) => (
              <Card.Root
                key={ext.slug}
                className="wpsignal-extension wpsignal-extension--catalogue"
                data-extension={ext.slug}
              >
                <Card.Header>
                  <Stack
                    direction="row"
                    gap="sm"
                    align="center"
                    justify="space-between"
                    wrap="wrap"
                  >
                    <Card.Title>{ext.title}</Card.Title>
                    {ext.available ? (
                      <ButtonLink
                        href={ext.docs_url}
                        variant="solid"
                        tone="brand"
                        size="compact"
                        openInNewTab={isExternal(ext.docs_url)}
                      >
                        {__("Get it", "wordsocket")}
                      </ButtonLink>
                    ) : (
                      <Badge
                        intent="draft"
                        className="wpsignal-extension__soon"
                      >
                        {__("Coming soon", "wordsocket")}
                      </Badge>
                    )}
                  </Stack>
                </Card.Header>
                <Card.Content>
                  <Text render={<p />}>{ext.description}</Text>
                </Card.Content>
              </Card.Root>
            ))}
          </div>
        </Stack>
      )}
    </Stack>
  );
}
