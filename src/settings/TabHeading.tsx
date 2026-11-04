/*
 * The heading every tab opens with: an `h2` in ui heading type, with an optional help tooltip ahead
 * of the title.
 */

/**
 * WordPress dependencies.
 */
import { helpFilled } from "@wordpress/icons";
import { Stack, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { HelpToolTip } from "./HelpToolTip";

/**
 * A tab's heading with its help text and breadcrumbs.
 *
 * @since 0.31.0
 */
export function TabHeading({
  title,
  beforeTitle,
  help,
  breadcrumbs,
}: {
  title: string;
  beforeTitle?: React.ReactNode;
  help?: string;
  breadcrumbs?: string[];
}) {
  return (
    <Stack direction="column" gap="sm">
      {beforeTitle}
      <Text variant="heading-xl" render={<h2 />}>
        {help && <HelpToolTip hint={help} icon={helpFilled} />}{" "}
        {breadcrumbs ? (
          <Stack direction="row" gap="sm" align="center">
            {[title, ...breadcrumbs].join(" > ")}
          </Stack>
        ) : (
          title
        )}
      </Text>
    </Stack>
  );
}
