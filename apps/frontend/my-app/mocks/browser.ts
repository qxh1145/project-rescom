import { getResponse } from "msw";
import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);

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

/**
 * Fallback for browsers that refuse to register the Service Worker (embedded
 * webviews, some privacy modes): answer `window.fetch` in-page with the same
 * handlers. Unmatched requests go to the network, like `onUnhandledRequest: "bypass"`.
 * Handlers read a clone, so the pass-through request still has its body;
 * `init.signal` is honoured before and while the handler resolves.
 */
function patchFetch(): void {
  const networkFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const mocked = await unlessAborted(getResponse(handlers, request.clone()), request.signal);
    if (!mocked) return networkFetch(request);
    // `HttpResponse.error()` must surface as a network failure, like a real fetch.
    if (mocked.type === "error") throw new TypeError("Failed to fetch");
    return mocked;
  };
}

export async function startMocking(): Promise<void> {
  try {
    await worker.start({
      onUnhandledRequest: "bypass",
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
  } catch (error) {
    console.warn("[MSW] Service Worker unavailable; mocking window.fetch in-page instead.", error);
    patchFetch();
  }
}
