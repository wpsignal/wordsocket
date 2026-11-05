/*
 * Settings tab: one collapsible card per concern, each in its own file, the switches through
 * `useSettingSwitch`; the features first, then the tools.
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
import { MomentsCard } from "./MomentsCard";
import { JourneysCard } from "./JourneysCard";

/**
 * The Settings tab.
 *
 * @since 0.14.0
 */
export function TabSettings({ title }: { title: string }) {
  return (
    <Stack direction="column" gap="lg" className="wpsignal-settings-tab">
      <TabHeading title={title} />
      <Stack gap="lg" align="start" className="wpsignal-collapsible-cards">
        <MomentsCard />
        <JourneysCard />
      </Stack>
      <Stack gap="lg" align="start" className="wpsignal-collapsible-cards">
        <DeveloperToolsCard />
        <CollaborationCard />
      </Stack>
    </Stack>
  );
}
