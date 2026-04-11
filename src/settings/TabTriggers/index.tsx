/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import {
  useState,
  useEffect,
  createInterpolateElement,
} from "@wordpress/element";
import {
  Button,
  Flex,
  Icon,
  Notice,
  Tooltip,
} from "@wordpress/components";

/**
 * Internal dependencies.
 */
import { TriggerRow } from "./TriggerRow";
import { getTriggers, saveTriggers } from "../api";
import type { Trigger, PostTypeOption } from "../types";
import { useSettings } from "../context";

const EMPTY_TRIGGER: Trigger = {
  type: "post_type",
  post_type: "",
  option_name: "",
  channel: "events",
  event: "",
};

interface NoticeState {
  type: "success" | "error" | "warning";
  message: string;
}

/**
 * Triggers tab.
 */
export function TabTriggers({ title }: { title: string }) {
  const { tabsCache, setTabsCache } = useSettings();
  const [saving, setSaving] = useState(false);
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
          setTabsCache({ ...tabsCache, triggers: [] });
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
      });
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
      return trigger.type === "post_type" ? trigger.post_type !== "" : trigger.option_name !== "";
    });
  }

  function updateTrigger(index: number, updated: Trigger): void {
    const next = [...tabsCache.triggers];
    next[index] = updated;
    setTabsCache({ ...tabsCache, triggers: next });
  };

  function removeTrigger(index: number): void {
    setNotice(null);
    setTabsCache({
      ...tabsCache,
      triggers: tabsCache.triggers.filter((_, i) => i !== index),
    });
  };

  async function handleSave(): Promise<void> {
    setSaving(true);
    setNotice(null);

    try {
      const res = await saveTriggers(tabsCache.triggers);
      setTabsCache({ ...tabsCache, triggers: res.triggers });
      setNotice({ type: "success", message: res.message || "Saved." });
    } catch {
      setNotice({
        type: "error",
        message: __("Failed to save triggers.", "wordsocket"),
      });
    } finally {
      setSaving(false);
    }
  };

  const isTraggersEmpty = tabsCache.triggers.length === 0;

  return (
    <div className="wpsignal-triggers-app">
      <h2>
        <Tooltip
          text={__(
            "Triggers are events that can be triggered by a specific action hook.",
            "wordsocket",
          )}
        >
          <span>
            <Icon size={16} icon="editor-help" />
          </span>
        </Tooltip>{" "}
        {title}{" "}
      </h2>
      <p>
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
      </p>
      {notice && (
        <Notice
          status={notice.type}
          isDismissible={false}
          onDismiss={() => setNotice(null)}
        >
          {notice.message}
        </Notice>
      )}

      {!isTraggersEmpty && (
        <Flex gap={5} align="flex-start" direction="column">
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
        </Flex>
      )}

      <div className="wpsignal-triggers-footer">
        <Button variant="secondary" onClick={addTrigger} disabled={!isTriggersValid()}>
          {__("Add Trigger", "wordsocket")}
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          isBusy={saving}
          disabled={saving || !isTriggersValid()}
        >
          {__("Save Triggers", "wordsocket")}
        </Button>
      </div>
    </div>
  );
}
