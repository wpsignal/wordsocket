/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import {
  useState,
  useEffect,
  createInterpolateElement,
} from "@wordpress/element";
import { Button, Notice } from "@wordpress/components";
import { Stack, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { TriggerRow } from "./TriggerRow";
import { getTriggers, saveTriggers } from "../api";
import type { NoticeState, PostTypeOption, Trigger } from "../types";
import { useSettings } from "../context";
import { useTask } from "../useTask";
import { TabHeading } from "../TabHeading";

const EMPTY_TRIGGER: Trigger = {
  type: "post_type",
  post_type: "",
  option_name: "",
  channel: "events",
  event: "",
};

/**
 * Triggers tab.
 */
export function TabTriggers({ title }: { title: string }) {
  const { tabsCache, setTabsCache } = useSettings();
  /*
   * Saved triggers are fetched once; until they arrive the buttons stay disabled so a row added
   * early is not overwritten by the response.
   */
  const [loading, setLoading] = useState(tabsCache.triggers.length === 0);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const postTypes: PostTypeOption[] = window.wpsignalSettings?.postTypes || [];

  useEffect(() => {
    if (tabsCache.triggers.length > 0) {
      return;
    }
    getTriggers()
      .then((res) => {
        if (res.triggers?.length) {
          setTabsCache({ ...tabsCache, triggers: res.triggers });
        } else {
          setNotice({
            type: "warning",
            message: __(
              "No triggers found. Add a trigger to get started.",
              "wordsocket",
            ),
          });
        }
      })
      .catch(() => {
        setNotice({
          type: "error",
          message: __("Failed to load triggers.", "wordsocket"),
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const addTrigger = (): void => {
    setNotice(null);
    setTabsCache({
      ...tabsCache,
      triggers: [...tabsCache.triggers, { ...EMPTY_TRIGGER }],
    });
  };

  function isTriggersValid(): boolean {
    return tabsCache.triggers.every((trigger) => {
      return trigger.type === "post_type"
        ? trigger.post_type !== ""
        : trigger.option_name !== "";
    });
  }

  function updateTrigger(index: number, updated: Trigger): void {
    const next = [...tabsCache.triggers];
    next[index] = updated;
    setTabsCache({ ...tabsCache, triggers: next });
  }

  function removeTrigger(index: number): void {
    setNotice(null);
    setTabsCache({
      ...tabsCache,
      triggers: tabsCache.triggers.filter((_, i) => i !== index),
    });
  }

  const save = useTask(() => saveTriggers(tabsCache.triggers), {
    success: (res) => res.message || __("Triggers saved.", "wordsocket"),
    error: __("Failed to save triggers.", "wordsocket"),
    onSuccess: (res) => setTabsCache({ ...tabsCache, triggers: res.triggers }),
  });

  function handleSave(): void {
    setNotice(null);
    save.run();
  }

  const isTriggersEmpty = tabsCache.triggers.length === 0;

  return (
    <Stack direction="column" gap="lg" className="wpsignal-triggers-app">
      <TabHeading
        title={title}
        help={__(
          "Triggers are events that can be triggered by a specific action hook.",
          "wordsocket",
        )}
      />
      <Text render={<p />}>
        {createInterpolateElement(
          __(
            "This section is intended for setting up basic predefined triggers, for more advanced use cases look into our <a>API</a> to setup triggers through code. For a complete list of WordPress core action hooks, see the <b>WordPress Action Reference</b>. To see all available action hooks with your setup, install a plugin like <c>WP Hooks Finder</c>.",
            "wordsocket",
          ),
          {
            a: (
              <a
                href="https://wpsignal.io/docs/php-api/"
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
            b: (
              <a
                href="https://developer.wordpress.org/apis/hooks/action-reference/"
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
            c: (
              <a
                href="https://wordpress.org/plugins/wp-hooks-finder/"
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          },
        )}
      </Text>
      {notice && (
        <Notice
          status={notice.type}
          isDismissible={false}
          onDismiss={() => setNotice(null)}
        >
          {notice.message}
        </Notice>
      )}

      {!isTriggersEmpty && (
        <Stack direction="column" gap="md">
          {tabsCache.triggers.map((trigger: Trigger, index: number) => (
            <TriggerRow
              key={index}
              trigger={trigger}
              index={index}
              postTypes={postTypes}
              onChange={updateTrigger}
              onRemove={removeTrigger}
            />
          ))}
        </Stack>
      )}

      <Stack direction="row" gap="sm">
        <Button
          variant="secondary"
          onClick={addTrigger}
          disabled={loading || !isTriggersValid()}
        >
          {__("Add Trigger", "wordsocket")}
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          isBusy={save.isPending}
          disabled={loading || save.isPending || !isTriggersValid()}
        >
          {__("Save Triggers", "wordsocket")}
        </Button>
      </Stack>
    </Stack>
  );
}
