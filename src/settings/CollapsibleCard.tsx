/*
 * A collapsible card with a title, a leading icon or a help tooltip, and an optional summary at the right of
 * the header.
 */

/**
 * WordPress dependencies.
 */
import { helpFilled } from "@wordpress/icons";
import {
  CollapsibleCard as WpCollapsibleCard,
  Card,
  Stack,
  Text,
} from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { HelpToolTip } from "./HelpToolTip";

/**
 * The card; `icon` leads the title, or the help icon does when `help` is given.
 *
 * @since 0.31.0
 */
export default function CollapsibleCard({
  children,
  title,
  defaultOpen = true,
  summary,
  help,
  icon,
  className,
}: {
  children: React.ReactNode;
  title: string;
  defaultOpen?: boolean;
  summary?: string;
  help?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  const leading =
    icon ??
    (help ? <HelpToolTip hint={help} icon={helpFilled} /> : null);
  return (
    <WpCollapsibleCard.Root
      className={["wpsignal-collapsible-card", className]
        .filter(Boolean)
        .join(" ")}
      defaultOpen={defaultOpen}
    >
      <WpCollapsibleCard.Header className="wpsignal-collapsible-card-header">
        <Stack
          direction="row"
          gap="lg"
          align={summary ? "start" : "center"}
          justify="space-between"
          style={{ width: "100%" }}
        >
          <Stack direction="row" gap="sm" align="center">
            {leading}
            <Card.Title>{title}</Card.Title>
          </Stack>
          {summary && (
            <Text className="wpsignal-muted" variant="body-md" render={<p />}>
              {summary}
            </Text>
          )}
        </Stack>
      </WpCollapsibleCard.Header>
      <WpCollapsibleCard.Content className="wpsignal-collapsible-card-content">{children}</WpCollapsibleCard.Content>
    </WpCollapsibleCard.Root>
  );
}
