/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import {
  useState,
  useEffect,
  createInterpolateElement,
} from "@wordpress/element";
import { Button, Flex, Icon, Notice, Tooltip } from "@wordpress/components";

/**
 * Internal dependencies.
 */
import { TriggerRow } from "./TriggerRow";
import { getTriggers, saveTriggers } from "../api";
import type { Trigger, PostTypeOption } from "../types";

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
export function TriggersTab() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const postTypes: PostTypeOption[] = window.wpsignalSettings?.postTypes || [];

  useEffect(() => {
    getTriggers()
      .then((res) => {
        if (res.triggers?.length) {
          setTriggers(res.triggers);
        } else {
          setTriggers([]);
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
    setTriggers([...triggers, { ...EMPTY_TRIGGER }]);
  };

  const updateTrigger = (index: number, updated: Trigger): void => {
    const next = [...triggers];
    next[index] = updated;
    setTriggers(next);
  };

  const removeTrigger = (index: number): void => {
    setTriggers(triggers.filter((_, i) => i !== index));
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setNotice(null);

    try {
      const res = await saveTriggers(triggers);
      setTriggers(res.triggers);
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

  return (
    <div className="wpsignal-triggers-app">
      <h3>
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
        {__("Triggers", "wordsocket")}{" "}
      </h3>
      <p>
        {createInterpolateElement(
          __(
            "This section is intended for setting up basic predefined triggers, for more advanced use cases look into our <a>API</a> to setup triggers through code. For a complete list of WordPress core action hooks, see the <b>WordPress Action Reference</b>. To see all available action hooks with your setup, install a plugin like <c>Action Scheduler</c>.",
            "wordsocket",
          ),
          {
            a: (
              <a
                href="https://wpsignal.io/docs/getting-started/"
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
          isDismissible
          onDismiss={() => setNotice(null)}
        >
          {notice.message}
        </Notice>
      )}

      <Flex gap={5} align="flex-start" direction="column">
        {triggers.map((trigger, index) => (
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

      <div className="wpsignal-triggers-footer">
        <Button variant="secondary" onClick={addTrigger}>
          {__("Add Trigger", "wordsocket")}
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          isBusy={saving}
          disabled={saving}
        >
          {__("Save Triggers", "wordsocket")}
        </Button>
      </div>
    </div>
  );
}
