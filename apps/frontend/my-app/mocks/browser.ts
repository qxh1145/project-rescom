import { getResponse } from "msw";
import { isHybridMocking } from "@/lib/api/config";
import { handlers, hybridHandlers } from "./handlers";

const abortError = () => new DOMException("The operation was aborted.", "AbortError");

/** Rejects with `AbortError` when `signal` aborts first, like a real fetch. */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Same line as the MSW worker prints: `[MSW] 19:11:23 GET /api/demographics (200 OK)`. */
function logMocked(request: Request, response: Response): void {
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const { pathname, search } = new URL(request.url);
  console.log(`[MSW] ${time} ${request.method} ${pathname}${search} (${response.status} ${response.statusText})`);
}

/**
 * Answers `window.fetch` in-page with the MSW handlers. Unmatched requests go
 * to the network, like `onUnhandledRequest: "bypass"`. Handlers read a clone,
 * so the pass-through request still has its body; `init.signal` is honoured
 * before and while the handler resolves.
 *
 * Deliberately no Service Worker: the MSW worker keeps its mocked tabs in
 * memory, and once the browser stops an idle worker (background tab, VS Code
 * webview) or a hard reload skips it, every request silently reaches the
 * `/api` proxy — a 500 when the backend is off. Trade-off: mocked calls show
 * in the console, not in the Network tab.
 */
function patchFetch(active: typeof handlers): void {
  const networkFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const mocked = await unlessAborted(getResponse(active, request.clone()), request.signal);
    if (!mocked) return networkFetch(request);
    logMocked(request, mocked);
    // `HttpResponse.error()` must surface as a network failure, like a real fetch.
    if (mocked.type === "error") throw new TypeError("Failed to fetch");
    return mocked;
  };
}

/** A worker registered by an earlier build would keep answering (or bypassing) behind the patch. */
async function unregisterMockWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) =>
        [registration.active, registration.waiting, registration.installing].some((worker) =>
          worker?.scriptURL.endsWith("/mockServiceWorker.js"),
        ),
      )
      .map((registration) => registration.unregister()),
  );
}

/** `hybrid` (gate G) registers only the deferred routes; every other request reaches the real backend. */
export async function startMocking(): Promise<void> {
  patchFetch(isHybridMocking ? hybridHandlers : handlers);
  await unregisterMockWorkers().catch(() => undefined);
}
