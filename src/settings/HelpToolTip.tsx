/*
 * A small icon whose tooltip is a hint.
 */

/**
 * WordPress dependencies.
 */
import { Tooltip } from "@wordpress/ui";
import { Icon, info } from "@wordpress/icons";

/**
 * The hint's icon, `info` unless `icon` says otherwise, with the hint as its tooltip.
 *
 * @since 0.31.0 `icon`.
 */
export function HelpToolTip({
  hint,
  icon = info,
}: {
  hint: string;
  icon?: JSX.Element;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        aria-label={hint}
        render={<span className="wpsignal-rule-hint" />}
      >
        <Icon icon={icon} size={16} />
      </Tooltip.Trigger>
      <Tooltip.Popup>{hint}</Tooltip.Popup>
    </Tooltip.Root>
  );
}
