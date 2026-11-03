import { Tooltip, Icon } from "@wordpress/components";
import { helpFilled } from "@wordpress/icons";
import {
  CollapsibleCard as WpCollapsibleCard,
  Card,
  Stack,
  Text,
} from "@wordpress/ui";

export default function CollapsibleCard({
  children,
  title,
  defaultOpen = true,
  summary,
  help,
  icon,
}: {
  children: React.ReactNode;
  title: string;
  defaultOpen?: boolean;
  summary?: string;
  help?: string;
  icon?: React.ReactNode;
}) {
  const HeaderIcon = icon ?? null;
  return (
    <WpCollapsibleCard.Root
      className="wpsignal-collapsible-card"
      defaultOpen={defaultOpen}
    >
      <WpCollapsibleCard.Header>
        <Stack direction="row" gap="sm" align="center">
          {HeaderIcon ? (
            HeaderIcon
          ) : help ? (
            <Tooltip text={help}>
              <Icon size={16} icon={helpFilled} />
            </Tooltip>
          ) : null}
          {summary ? (
            <Stack
              direction="row"
              gap="lg"
              align="center"
              style={{ width: "100%" }}
              justify="space-between"
            >
              <Card.Title>{title}</Card.Title>
              {summary && (
                <Text
                  className="wpsignal-muted"
                  variant="body-md"
                  render={<p />}
                >
                  {summary}
                </Text>
              )}
            </Stack>
          ) : (
            <Card.Title>{title}</Card.Title>
          )}
        </Stack>
      </WpCollapsibleCard.Header>
      <WpCollapsibleCard.Content>{children}</WpCollapsibleCard.Content>
    </WpCollapsibleCard.Root>
  );
}
