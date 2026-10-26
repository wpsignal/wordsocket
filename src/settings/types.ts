/**
 * Types.
 */

export interface Trigger {
  type: "post_type" | "option";
  post_type: string;
  option_name: string;
  channel: string;
  event: string;
}

export interface PostTypeOption {
  value: string;
  label: string;
}

/** Each field saves on its own; send only what changed. */
export interface SettingsPost {
  yjs_provider_enabled?: boolean;
  developer_mode?: boolean;
  history_enabled?: boolean;
  journeys_retention_months?: number;
}
/** `GET /wpsignal/v1/settings`, as `Token::handle_get_settings()` answers it. */
export interface Settings {
  base_url: string;
  api_key: string;
  site_key: string;
  is_connected: boolean;
  yjs_provider_enabled: boolean;
  developer_mode: boolean;
  /** Journeys are kept on the site (the Journeys tab's switch). */
  history_enabled: boolean;
  /** How many months a journey is kept, 1 to 36. */
  journeys_retention_months: number;
  credential_source: "constant" | "database";
  /** Last publish failure recorded by the plugin, if events are not being delivered. */
  last_error?: {
    code: string;
    message: string;
    detail: string;
    time: number;
  } | null;
}

export interface ConnectResponse {
  message: string;
  site_key: string;
}

/**
 * One journey as `GET /wpsignal/v1/journeys/visuals` lists it (`Journeys::newest()`).
 *
 * @since 0.31.0
 */
export interface JourneyRow {
  /** `kind:id:ms` steps joined by `>`. */
  journey: string;
  /** RFC 3339 UTC. */
  started_at: string;
  outcome: string;
  has_ref: boolean;
  value: number;
  /** Index into `days`, -1 when outside the window. */
  day: number;
  /** Minute of the local day it started. */
  minute: number;
}

/**
 * Counts of journeys by outcome key.
 *
 * @since 0.31.0
 */
export type OutcomeCounts = Record<string, number>;

/**
 * The Journeys tab's figures (`Journeys::visuals()`): the last 28 days on the site's clock.
 *
 * @since 0.31.0
 */
export interface JourneyVisuals {
  /** Start of the window, RFC 3339 UTC. */
  since: string;
  /** The site's timezone, as WordPress names it. */
  timezone: string;
  /** The weekday the site's week starts on, 0 Sunday. */
  week_start: number;
  /** One entry per local day, oldest first; `left_ref` is journeys left with a ref. */
  days: Array<{ date: string; visits: number; left_ref: number; outcomes: OutcomeCounts }>;
  /** Weekday (0 Sunday) by hour of the local day. */
  hours: Array<Array<{ visits: number; minutes: number; outcomes: OutcomeCounts }>>;
  /** The newest journeys of the window, at most `Journeys::VISUALS_JOURNEYS`. */
  journeys: JourneyRow[];
  /** Journeys in the window, listed or not. */
  total: number;
  /** The registered outcomes, the built-in ones first. */
  outcomes: Record<string, { label: string; color: string; series: string }>;
  /** What a journey's ref is, when an extension said. */
  ref: { label: string; left_series: string } | null;
  /** Page kind labels, as the Moments tab has them. */
  kinds: Record<string, string>;
  /** ISO 4217, or empty. */
  currency: string;
}

export interface NoticeState {
  type: "success" | "error" | "warning";
  message: string | React.ReactNode;
}
