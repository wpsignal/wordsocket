/*
 * Settings tab: one collapsible card per concern, each in its own file, the switches through
 * `useSettingSwitch`.
 */

/**
 * WordPress dependencies.
 */
import { Stack } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { TabHeading } from "../TabHeading";
import { DeveloperToolsCard } from "./DeveloperToolsCard";
import { CollaborationCard } from "./CollaborationCard";

export function TabSettings({ title }: { title: string }) {
  return (
    <Stack direction="column" gap="lg" className="wpsignal-settings-tab">
      <TabHeading title={title} />
      <Stack direction="row" gap="lg" align="start">
        <DeveloperToolsCard />
        <CollaborationCard />
      </Stack>
    </Stack>
  );
}
