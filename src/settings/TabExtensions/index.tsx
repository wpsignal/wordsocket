/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { useEffect, useState } from "@wordpress/element";
import {
  Card,
  CardBody,
  CardHeader,
  Notice,
  Spinner,
} from "@wordpress/components";

/**
 * Internal dependencies.
 */
import { getExtensions } from "../api";
import { useSettings } from "../context";
import { ExtensionPanelSlot } from "../extensions/api";

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
  const needing = (extensions ?? []).filter(
    (ext) => ext.installed && ext.missing.length > 0,
  );

  return (
    <div className="wpsignal-extensions-tab">
      <h2>{title}</h2>
      <p>
        {__(
          "Extensions are WordPress plugins built on WordSocket.",
          "wordsocket",
        )}
      </p>

      <h3>{__("Installed extensions", "wordsocket")}</h3>

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
        <div className="wpsignal-extensions-catalogue">
          <h3>{__("Available extensions", "wordsocket")}</h3>
          <p>
            {__(
              "These extensions are coming soon.",
              "wordsocket",
            )}
          </p>
          <div className="wpsignal-extensions-grid">
            {catalogue.map((ext) => (
              <Card
                key={ext.slug}
                className="wpsignal-extension wpsignal-extension--catalogue"
                data-extension={ext.slug}
              >
                <CardHeader>
                  <h4>{ext.title}</h4>
                  {ext.available ? (
                    <a
                      href={ext.docs_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {__("Get it", "wordsocket")}
                    </a>
                  ) : (
                    <span className="wpsignal-extension__soon">
                      {__("Coming soon", "wordsocket")}
                    </span>
                  )}
                </CardHeader>
                <CardBody>
                  <p>{ext.description}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
