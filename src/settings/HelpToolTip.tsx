import { Tooltip } from "@wordpress/ui";
import { Icon, info } from "@wordpress/icons";

export function HelpToolTip({ hint }: { hint: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        aria-label={hint}
        render={<span className="wpsignal-rule-hint" />}
      >
        <Icon icon={info} size={16} />
      </Tooltip.Trigger>
      <Tooltip.Popup>{hint}</Tooltip.Popup>
    </Tooltip.Root>
  );
}