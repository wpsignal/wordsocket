import { Tooltip, Icon } from "@wordpress/components";
import { helpFilled } from "@wordpress/icons";
import {
  CollapsibleCard as WpCollapsibleCard,
  Card,
  Stack,
} from "@wordpress/ui";

export default function CollapsibleCard({
  children,
  title,
  defaultOpen = true,
  help,
}: {
  children: React.ReactNode;
  title: string;
  defaultOpen: boolean;
  help: string;
}) {
  return (
    <WpCollapsibleCard.Root
      className="wpsignal-collapsible-card"
      defaultOpen={defaultOpen}
    >
      <WpCollapsibleCard.Header>
        <Stack direction="row" gap="sm" align="center">
          {help && (
            <Tooltip text={help}>
              <Icon size={16} icon={helpFilled} />
            </Tooltip>
          )}
          <Card.Title>{title}</Card.Title>
        </Stack>
      </WpCollapsibleCard.Header>
      <WpCollapsibleCard.Content>{children}</WpCollapsibleCard.Content>
    </WpCollapsibleCard.Root>
  );
}
