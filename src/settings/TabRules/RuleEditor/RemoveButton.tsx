/*
 * The small close button every row of the builder carries, named for what it removes.
 */

/**
 * WordPress dependencies.
 */
import { IconButton } from "@wordpress/ui";
import { closeSmall } from "@wordpress/icons";

/**
 * The button that removes a row from the builder.
 *
 * @since 0.31.0
 */
export function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick(): void;
}) {
  return (
    <IconButton
      className="wpsignal-rule-remove"
      variant="minimal"
      size="compact"
      tone="neutral"
      onClick={onClick}
      label={label}
      icon={closeSmall}
    />
  );
}
