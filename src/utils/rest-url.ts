/*
 * REST URLs the client builds from ones PHP printed: `rest_url()` is a path on a site with pretty
 * permalinks and `?rest_route=/...` without them, so a path or a query parameter is added through
 * the URL API rather than by string concatenation.
 */

/** `base` with `path` appended to its route and `params` set on its query. */
export function restUrl(
  base: string,
  path = "",
  params: Record<string, string> = {},
): string {
  const url = new URL(base, window.location.href);
  const route = url.searchParams.get("rest_route");
  if (route !== null) {
    url.searchParams.set("rest_route", route.replace(/\/$/, "") + path);
  } else {
    url.pathname = url.pathname.replace(/\/$/, "") + path;
  }
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  return url.href;
}
