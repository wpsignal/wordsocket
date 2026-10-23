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

/** Each switch saves on its own; send only what changed. */
export interface SettingsPost {
  yjs_provider_enabled?: boolean;
  developer_mode?: boolean;
}
/** `GET /wpsignal/v1/settings`, as `Token::handle_get_settings()` answers it. */
export interface Settings {
  base_url: string;
  api_key: string;
  site_key: string;
  is_connected: boolean;
  yjs_provider_enabled: boolean;
  developer_mode: boolean;
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

export interface NoticeState {
  type: "success" | "error" | "warning";
  message: string | React.ReactNode;
}
