/**
 * Story 11.1 / AD-23 amendment: the `/api` rewrite reaches the backend through
 * Vercel → Cloudflare → Caddy, so Cloudflare only sees Vercel's egress IP.
 * The proxy forwards the real client (Vercel's `x-real-ip`) plus a shared
 * edge key; Caddy trusts the client IP only when the key matches.
 */
export const EDGE_KEY_HEADER = "x-rescom-edge-key";
export const CLIENT_IP_HEADER = "x-rescom-client-ip";

/**
 * Request headers for an `/api` call, or `null` to pass it through untouched
 * (no `RESCOM_EDGE_KEY`: local dev). Incoming `x-rescom-*` are always dropped
 * so a browser cannot forge them.
 */
export function edgeRequestHeaders(incoming: Headers, edgeKey: string | undefined): Headers | null {
  const key = edgeKey?.trim();
  if (!key) return null;
  const headers = new Headers(incoming);
  for (const name of Array.from(headers.keys())) {
    if (name.toLowerCase().startsWith("x-rescom-")) {
      headers.delete(name);
    }
  }
  headers.set(EDGE_KEY_HEADER, key);
  const clientIp = incoming.get("x-real-ip")?.trim();
  if (clientIp) headers.set(CLIENT_IP_HEADER, clientIp);
  return headers;
}
