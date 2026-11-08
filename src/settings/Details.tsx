/*
 * A native disclosure: a summary row with an optional icon, and a panel that spans the card.
 */

/**
 * WordPress dependencies.
 */
import { Icon } from "@wordpress/ui";
import type { ReactNode } from "react";

interface DetailsProps {
  /** What the summary row reads. */
  summary: ReactNode;
  /** An icon before the summary text. */
  icon?: JSX.Element;
  /** An icon after the summary text. */
  iconOpen?: JSX.Element;
  /** Whether the panel starts open. */
  defaultOpen?: boolean;
  /** Whether the panel spans the card it sits in, edge to edge. */
  fullBleed?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A `<details>` element styled as the settings tabs' disclosures.
 *
 * @since 0.31.0
 */
export default function Details({
  summary,
  icon,
  iconOpen,
  defaultOpen = false,
  fullBleed = false,
  className,
  children,
}: DetailsProps) {
  return (
    <details
      className={["wpsignal-details", className].filter(Boolean).join(" ")}
      open={defaultOpen || undefined}
    >
      <summary className="wpsignal-details__summary">
        {icon && <Icon icon={icon} className="wpsignal-details__icon" />}
        {iconOpen && (
          <Icon
            icon={iconOpen}
            className="wpsignal-details__icon wpsignal-details__icon-open"
          />
        )}
        {summary}
      </summary>
      <div
        className={["wpsignal-details__panel", fullBleed && "full-bleed"]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
    </details>
  );
}
