/*
 * Relay endpoints and the query each connection carries. PHP builds the
 * endpoints.
 */

/** `endpoint` with `params` as its query string, for `new WebSocket()` or `new EventSource()`. */
export function withQuery(endpoint: string, params: Record<string, string>): URL {
  const url = new URL(endpoint);
  url.search = new URLSearchParams(params).toString();
  return url;
}

/**
 * The endpoints to connect to.
 */
export function relayEndpoints(config: { endpoints?: WpSignalEndpoints; baseUrl: string }): WpSignalEndpoints {
  if (config.endpoints) return config.endpoints;
  const base = config.baseUrl.replace(/\/+$/, "");
  return { ws: `${base.replace(/^http/, "ws")}/ws`, sse: `${base}/sse` };
}
