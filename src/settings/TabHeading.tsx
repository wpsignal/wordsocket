/*
 * The heading every tab opens with: an `h2` in ui heading type, with an optional help tooltip ahead
 * of the title.
 */

/**
 * WordPress dependencies.
 */
import { Icon, Tooltip } from "@wordpress/components";
import { Stack, Text } from "@wordpress/ui";

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
        {help && (
          <>
            <Tooltip text={help}>
              <span>
                <Icon size={16} icon="editor-help" />
              </span>
            </Tooltip>{" "}
          </>
        )}
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
