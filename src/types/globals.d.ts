/** The relay endpoints, built in PHP by `Config::endpoints()`; the browser only appends the query. */
interface WpSignalEndpoints {
  /** WebSocket endpoint, e.g. `wss://api.wpsignal.io/ws`. */
  ws: string;
  /** Server-Sent Events endpoint, e.g. `https://api.wpsignal.io/sse`. */
  sse: string;
}

/** Localized by class-wpsignal-client.php */
interface WpSignalConfig {
  /** WordPress version. */
  wpVersion: number;
  /** Whether to use constant credentials. */
  isConstant: boolean;
  /** Whether the WP sync engine is present (Gutenberg plugin until RTC ships in core). */
  isWpRtcAvailable: boolean;
  /** Whether real-time collaboration is enabled (Gutenberg > Experiments toggle, via wp_is_collaboration_enabled()). */
  isWpRtcEnabled: boolean;
  /** Whether to use SSL. */
  isSsl: boolean;
  /** WPSignal dashboard URL (settings page only; derived from the server base URL). */
  dashboardUrl?: string;
  /** Whether to enable debug mode. */
  isDebug: boolean;
  /** WordPress REST URL. */
  restUrl: string;
  /** WordPress REST nonce. Printed for logged-in visitors only: a cached guest page must carry none. */
  nonce?: string;
  /** WPSignal server URL. */
  baseUrl: string;
  /** Relay endpoints from PHP. Absent only on a page cached before 0.25 (see `relayEndpoints`). */
  endpoints?: WpSignalEndpoints;
  /** Server-side minted token (present on first load; absent on refresh calls). */
  token?: string;
  channels?: string[];
  exp?: number;
  /** Base64-encoded raw AES-256 key for decrypting incoming "encrypted" messages. Never sent to WPSignal. */
  encryptionKey?: string;
  /** Force use of SSE instead of WebSocket. */
  forceSSE?: boolean;
  /** This page's step and the report routes, for `WPS.presence.track()` (0.30). Absent on a page cached before it. */
  presence?: WpSignalPresenceConfig;
  /** The site's name, for the `{site.name}` placeholder in prompts (0.31). */
  siteName?: string;
  /** The enabled rules and the recovery settings (0.31); absent on an older cached page. */
  rules?: WpSignalRulesConfig;
}

/** Printed by class-wpsignal-client.php from `Rules::config()`, and the shape of a `rules.updated` frame. */
interface WpSignalRulesConfig {
  version: number;
  /** Enabled rules only; a disabled rule never leaves wp-admin. */
  rules: WPSRule[];
  /** `GET /wpsignal/v1/prompt/{id}`, without the id. */
  promptUrl: string;
  /** Kinds that are taxonomy archives. */
  taxonomies?: string[];
  /** The site's timezone, IANA name or "+02:00". */
  timezone?: string;
  /** `POST /wpsignal/v1/fired`; printed only while something listens to `wpsignal_rule_fired`. */
  firedUrl?: string;
  /** `GET /wpsignal/v1/rules/live`: the enabled rules and version, fetched once on every reconnect. */
  liveUrl?: string;
}

interface WPSRuleCondition {
  condition: string;
  op: string;
  value?: unknown;
}
interface WPSRuleGroup {
  all?: Array<WPSRuleCondition | WPSRuleGroup>;
  any?: Array<WPSRuleCondition | WPSRuleGroup>;
}
interface WPSRuleAction {
  action: string;
  [param: string]: unknown;
}
interface WPSRule {
  id: string;
  name: string;
  enabled: boolean;
  frequency: "always" | "page" | "visit" | "visitor";
  rev: number;
  source?: string;
  attention?: { enabled: boolean; title: string };
  conditions: WPSRuleGroup;
  actions: WPSRuleAction[];
}

/** What a condition test or an action runner sees: the built-in contexts plus every registered one. */
type WPSRuleContext = Record<string, unknown> & {
  page: {
    kind: string;
    id: number;
    title: string;
    dwell: number;
    hidden: number;
    taxonomy: boolean;
  };
  journey: {
    current: string;
    pagesViewed: number;
    visitTime: number;
    returned: number;
    kinds: Record<string, number>;
  };
  attention: { state: WPSAttentionState };
  clock: { hour: number; weekday: number; minute: number; siteHour: number };
  visitor: {
    id: string;
    isNew: boolean;
    loggedIn: boolean;
    device: "desktop" | "tablet" | "mobile";
  };
  site: { name: string };
};

interface WPSFiring {
  rule: string;
  action: string;
  step: number;
  data?: Record<string, unknown>;
}

interface WPSHistoryJourney {
  journey: string;
  started_at?: string;
  outcome?: string;
  value?: number;
  context?: Record<string, unknown>;
}

interface WPSHistoryProvider {
  load(options: {
    days?: number;
    limit?: number;
  }): Promise<WPSHistoryJourney[]>;
  outcomes?: boolean;
}

interface WPSRulesApi {
  /** The browser half of a condition `WPS::rules()->condition()` described. */
  condition(
    key: string,
    test: (ctx: WPSRuleContext, condition: WPSRuleCondition) => boolean,
  ): void;
  /** A live value under `key` in every context; call the returned function when it changes. */
  context(key: string, read: () => unknown): () => void;
  /** The browser half of an action; the third argument is `WPS.recovery`. */
  action(
    key: string,
    run: (
      ctx: WPSRuleContext,
      params: Record<string, unknown>,
      recovery: WPSRecoveryApi,
      rule: WPSRule,
    ) => void | Promise<void>,
  ): void;
  /** Stored journeys for the replay panel. */
  history(provider: WPSHistoryProvider): void;
  /** Every firing in this browser. Returns the unsubscribe. */
  onFire(handler: (firing: WPSFiring, ctx: WPSRuleContext) => void): () => void;
  /** Run a rule over journeys with a synthetic context per step. */
  replay(
    rule: WPSRule,
    journeys: WPSHistoryJourney[],
  ): {
    count: number;
    fired: Array<{ index: number; step: number }>;
    unanswerable: string[];
  };
  readonly current: { version: number; rules: WPSRule[] };
  readonly historyProvider: WPSHistoryProvider | null;
}

/** Printed by class-wpsignal-client.php from `Presence::config()`. */
interface WpSignalPresenceConfig {
  /** The page's kind: a post type, a taxonomy, a post type's `<type>_archive`, or `home`, `search`, `archive`, `other`, `admin` (the `wpsignal_page_step` filter). */
  kind: string;
  /** The post or term id, 0 when the kind has none. */
  id: number;
  /** `POST /wpsignal/v1/visit`. */
  visitUrl: string;
  /** `POST /wpsignal/v1/leave`. */
  leaveUrl: string;
}

/** Localized by class-wpsignal-admin-page.php (Settings React app) */
interface WpSignalSettings {
  /** URL for the connection endpoint. */
  connectUrl: string;
  /** URL for the OAuth start endpoint. */
  oauthStartUrl: string;
  /** URL for the REST endpoint. */
  restUrl: string;
  /** wp_rest nonce for authenticated REST requests. */
  nonce: string;
  /** Array of public post type objects (value, label) for trigger dropdowns. */
  postTypes: Array<{ value: string; label: string }>;
  /** WPSignal server base URL. */
  baseUrl: string;
  /** Relay endpoints from PHP, for the Explorer's socket. */
  endpoints?: WpSignalEndpoints;
  /** WPSignal dashboard URL, derived from baseUrl. */
  dashboardUrl: string;
  /** Stored site key (set after either connection flow completes). */
  siteKey: string;
  /** Array of registered trigger instances. */
  triggers: WpSignalTriggerRow[];
  /** Real-time collaboration on this site: Gutenberg present, its experiment switched on, and where to switch it on. */
  rtc?: { available: boolean; enabled: boolean; experimentsUrl: string };
  /** Whether the Triggers and Explorer tabs are shown (the Settings tab's "Developer tools" switch). */
  developerMode?: boolean;
}

/** Localized by class-wpsignal-client.php (enqueue_yjs_provider) */
interface WpSignalYjsConfig {
  /** Channel prefix for Yjs channels, e.g. `site:{site_id}:yjs:`. Keeps Yjs channels within the JWT's allowed_channel_prefixes. */
  channelPrefix: string;
}

/** Localized by class-wpsignal-admin-page.php (added to wpsignalSettings for the Explorer tab) */
interface WpSignalTriggerRow {
  event: string;
  hook: string;
  priority: number;
  args: number;
  channel: string;
  condition: boolean;
}

type WPSMessageHandler = (
  event: string,
  data: Record<string, unknown>,
  channel: string,
) => void;
type WPSEventHandler = (data: Record<string, unknown>, channel: string) => void;
/** Handler for incoming binary WebSocket frames (e.g. Yjs updates). */
type WPSBinaryHandler = (channel: string, data: Uint8Array) => void;
type WPSTransportName = "ws" | "sse";
type WPSStatus = {
  name: WPSTransportName | null;
  connected: boolean;
  readyState: number | null;
  canPublish: boolean;
  canPublishBinary: boolean;
  /** Timestamp (ms) of the last inbound frame (including server pings); null when unknown or on SSE. */
  lastMessageAt: number | null;
  /** Why the connection is down, if it is; cleared on the next successful open. */
  lastError: WPSConnectionError | null;
  /** Consecutive failed connection attempts since the last successful open. */
  failures: number;
};

/**
 * Error codes shared with the Yjs provider. They mirror @wordpress/sync's
 * ConnectionErrorCode so the editor can pick its copy without translation.
 */
type WPSConnectionErrorCode =
  | "authentication-failed"
  | "connection-expired"
  | "connection-limit-exceeded"
  | "document-size-limit-exceeded"
  | "protocol-mismatch"
  | "unknown-error";

interface WPSConnectionError {
  code: WPSConnectionErrorCode;
  message: string;
}

/** Full connection state delivered to `onStateChange` handlers. */
interface WPSConnectionState {
  connected: boolean;
  transport: WPSTransportName | null;
  /** Present while disconnected because of an error. */
  error?: WPSConnectionError;
  /** Present while an automatic retry is scheduled: milliseconds until it fires. */
  retryInMs?: number;
  /** Consecutive failed attempts since the last successful open. */
  failures: number;
}

/** Options for `WPS.presence.track()`. */
interface WPSTrackOptions {
  /** The plugin's own fields, carried in presence state and in every report (ShopSocket's cart id). */
  state?: Record<string, unknown>;
  /**
   * Whether to report visits and leaves to WordPress. Default true; false for a live-only board; a
   * function is read before each report (0.31), so a plugin holds reports until they are worth
   * storing. Presence is announced either way.
   */
  report?: boolean | (() => boolean);
}

/** What `WPS.presence.track()` returns. */
interface WPSPresenceTracker {
  /** This browser's visitor id, the same `WPS.visitorId()` gives. */
  readonly visitor: string;
  /** This visit's journey id, a v4 UUID; a new one after 30 minutes without an arrival. */
  journeyId(): string;
  /** The journey so far: `kind:id:ms` steps joined by `>`, the open step's time included. */
  journey(): string;
  /** Replace the plugin's fields; presence is announced again at once. */
  update(state: Record<string, unknown>): void;
  /** Called after every change to the journey (a step, away, back, a new visit). Returns the unsubscribe. */
  onChange(handler: (journey: string, journeyId: string) => void): () => void;
  /**
   * Called with what WordPress answered each visit report (0.31): `ok` plus the fields plugins add
   * through `wpsignal_visitor_visit_response`, each under its own key. The latest answer is replayed
   * to a late subscriber; null means none is coming (no reporting, or the report failed), so fetch
   * your own. Returns the unsubscribe.
   */
  onVisit(
    handler: (answer: Record<string, unknown> | null) => void,
  ): () => void;
  /** Leave presence and stop listening. The journey in storage is kept. */
  stop(): void;
}

interface WPSPresenceApi {
  /**
   * Track this visitor on a channel the token may write presence to (0.30): presence as `{ v, n, j, ...state }`,
   * the journey kept across pages, visits and leaves reported to the `wpsignal_visitor_visit` and `wpsignal_visitor_leave` actions.
   */
  track(channel: string, options?: WPSTrackOptions): WPSPresenceTracker;
}

/** Where the visitor's attention is: visible and focused, visible in an unfocused window (desktop only), or a hidden tab. */
type WPSAttentionState = "page" | "window" | "hidden";

interface WPSAttentionApi {
  readonly state: WPSAttentionState;
  /** When the tab became hidden (ms since the epoch), null while it is visible. */
  readonly hiddenAt: number | null;
  /** Called on every change with the new and previous state. Returns the unsubscribe. */
  on(
    handler: (state: WPSAttentionState, previous: WPSAttentionState) => void,
  ): () => void;
}

/** What a prompt shows: text with `{key.path}` placeholders, a node of the caller's, or a synced pattern id with the text as fallback. */
interface WPSPromptContent {
  text?: string;
  node?: Node;
  pattern?: number;
}

/** A presentation: given the layer and a close callback, mounts and unmounts a prompt's node. */
type WPSPresentationMount = (
  root: HTMLElement,
  close: () => void,
) => { open(node: Node): void; close(): void };

interface WPSShowOptions {
  /** The rule showing this prompt, as `id:rev`; a re-fire or a take-back closes it by this key. */
  rule?: string;
  /** Values for the content's placeholders. */
  context?: Record<string, unknown>;
  /** Rendered pattern markup, when the caller fetched one. */
  pattern?: Node | null;
}

interface WPSRecoveryApi {
  /** Show content as `modal`, `banner`, `bar`, `toast`, `panel` or a registered key, alongside whatever is open. */
  show(
    content: WPSPromptContent,
    presentation: string,
    options?: WPSShowOptions,
  ): boolean;
  /** Register a presentation for extensions to show prompts in. */
  presentation(key: string, mount: WPSPresentationMount): void;
  /** Alternate the tab title with `text` while the tab is hidden; restored on return. */
  flashTitle(text: string): { stop(): void };
  /** Put a dot on the favicon; false when the page has none or it is cross-origin. */
  badge(): Promise<boolean>;
  clearBadge(): void;
  /** Play the chime once per visit, only after the visitor has touched the page. */
  sound(): boolean;
  /** Called when attention comes back to the page from a hidden tab or another window. Returns the unsubscribe. */
  onReturn(handler: () => void): () => void;
  onClose(handler: () => void): () => void;
  /** Called each time a prompt opens, with the moment (`id:rev`) that showed it, if any. */
  onShow(handler: (rule?: string) => void): () => void;
  readonly open: boolean;
  /** The moments (`id:rev`) with a prompt on screen. */
  readonly shownBy: string[];
  /** Close every prompt, or only those a moment (`id:rev`) showed. */
  close(rule?: string): void;
}

/** Public API exposed by the WordSocket client on window.WPS */
interface WPSApi {
  /** Subscribe to additional channels on the shared connection. */
  subscribe(channels: string[]): void;
  /** Unsubscribe from channels. */
  unsubscribe(channels: string[]): void;
  /** Publish a JSON message through the WebSocket. No-ops on SSE (one-way transport). */
  publish(channel: string, event: string, data?: Record<string, unknown>): void;
  /**
   * Send a raw binary frame to the server over the WebSocket.
   * Frame format: 2-byte BE channel name length + channel bytes + payload.
   * No-ops on SSE (one-way transport) or when not connected.
   */
  publishBinary(channel: string, data: Uint8Array): void;
  /**
   * Enter or update connection-scoped presence on a channel. The relay drops
   * the membership the instant this socket closes, and the client re-sends it
   * on reconnect; pass null to leave, which is announced at once. Subscribers
   * of the channel receive `wps.presence` join/leave/sync events (`channel` is
   * the site-relative name, `woo:carts:live`). Requires WebSocket; no-op on SSE.
   */
  setPresence(channel: string, state: Record<string, unknown> | null): void;
  /** Register a handler for a specific event name. Returns unsubscribe fn. */
  on(event: string, handler: WPSEventHandler): () => void;
  /** Register a catch-all handler for incoming JSON messages. Returns unsubscribe fn. */
  onMessage(handler: WPSMessageHandler): () => void;
  /** Register a handler for incoming binary frames. Returns unsubscribe fn. */
  onBinaryMessage(handler: WPSBinaryHandler): () => void;
  /** Whether the connection is currently open. */
  readonly connected: boolean;
  /** Current transport layer, or null while still connecting. */
  readonly transport: WPSTransportName | null;
  /** Current transport state and capabilities. */
  readonly status: WPSStatus;
  /** Register a callback for connection state changes. Returns unsubscribe fn. */
  onConnectionChange(handler: (connected: boolean) => void): () => void;
  /** Register a callback receiving the full connection state (error, retry countdown, failure count). Returns unsubscribe fn. */
  onStateChange(handler: (state: WPSConnectionState) => void): () => void;
  /** The current connection state, as delivered to onStateChange. */
  readonly state: WPSConnectionState;
  /**
   * A version-4 UUID. Works on plain HTTP pages too, where `crypto.randomUUID`
   * does not exist (it needs a secure context); use it instead of calling
   * `crypto.randomUUID()` directly. Needs no connection.
   */
  uuid(): string;
  /**
   * This browser's stable id, kept in localStorage and shared by every tab
   * and every extension on the site, for counting people rather than sockets
   * (pass it in presence state). It names a browser, not a person; when
   * storage is blocked it lasts for the page load only.
   */
  visitorId(): string;
  /**
   * Whether an event's `channel` is the `expected` one, given by its
   * site-relative name (`woo:stock`); the qualified `site:{id}:woo:stock`
   * matches too. Any tokened browser may publish on a public channel, so
   * check this in a handler before trusting the event's data.
   */
  onChannel(channel: string, expected: string): boolean;
  /** Visitor tracking over presence: `WPS.presence.track( channel, options )`. */
  readonly presence: WPSPresenceApi;
  /** Where the visitor's attention is (0.31). */
  readonly attention: WPSAttentionApi;
  /** The surfaces a prompt reaches the visitor through (0.31). */
  readonly recovery: WPSRecoveryApi;
  /** The rules engine and the registration API (0.31). */
  readonly rules: WPSRulesApi;
}

// ---------------------------------------------------------------------------
// Ambient module declarations for WordPress externals used by the Yjs provider.
// Runtime values are provided by WordPress core (wp.sync, wp.hooks).
// ---------------------------------------------------------------------------

declare module "@wordpress/sync" {
  /** Yjs library re-exported by @wordpress/sync. Import from here, not from 'yjs', to avoid duplicate instances. */
  export const Y: {
    /** v1 — kept for reference; WordPress uses v2 internally. */
    applyUpdate(doc: unknown, update: Uint8Array, origin?: unknown): void;
    /** @param encodedTargetStateVector — if provided, encodes only the updates the target is missing. */
    encodeStateAsUpdate(
      doc: unknown,
      encodedTargetStateVector?: Uint8Array,
    ): Uint8Array;
    encodeStateVector(doc: unknown): Uint8Array;
    /** v2 — used by WordPress 7.0 sync observers. Always prefer these. */
    applyUpdateV2(doc: unknown, update: Uint8Array, origin?: unknown): void;
    encodeStateAsUpdateV2(
      doc: unknown,
      encodedTargetStateVector?: Uint8Array,
    ): Uint8Array;
    encodeStateVectorFromUpdateV2(update: Uint8Array): Uint8Array;
  };
}

declare module "@wordpress/hooks" {
  export function addFilter(
    hookName: string,
    namespace: string,
    callback: (...args: unknown[]) => unknown,
    priority?: number,
  ): void;
}
