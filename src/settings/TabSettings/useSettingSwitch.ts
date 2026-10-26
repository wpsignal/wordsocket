/*
 * One optimistic switch on the Settings tab: the context flips at once, the save goes through
 * `useTask` (so the toasts are its), and a failed save flips the context back.
 */

/**
 * Internal dependencies.
 */
import { saveSettings } from "../api";
import { useSettings } from "../context";
import type { SettingsPost } from "../types";
import { useTask } from "../useTask";

/** The context key the switch shows, and the field `POST /wpsignal/v1/settings` saves it under. */
const FIELDS = {
  developerMode: "developer_mode",
  yjsProviderEnabled: "yjs_provider_enabled",
  historyEnabled: "history_enabled",
} as const satisfies Record<string, keyof SettingsPost>;

export function useSettingSwitch(
  key: keyof typeof FIELDS,
  messages: { success: string; error: string },
) {
  const settings = useSettings();
  const { setSetting } = settings;
  const save = useTask(
    (value: boolean) => saveSettings({ [FIELDS[key]]: value }),
    {
      ...messages,
      onError: (_error, value) => setSetting(key, !value),
    },
  );
  return {
    checked: settings[key],
    isPending: save.isPending,
    change(value: boolean) {
      setSetting(key, value);
      return save.run(value);
    },
  };
}
