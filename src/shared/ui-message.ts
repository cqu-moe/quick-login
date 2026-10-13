/** Bound the UI wait only; a timeout does not cancel a background operation. */
export function sendUiMessage<T>(message: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const cleanup = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => { cleanup(); reject(signal.reason); };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("UI_MESSAGE_TIMEOUT"));
    }, 10_000);
    signal.addEventListener("abort", abort, { once: true });
    // Catch synchronous failures too (e.g. an invalidated extension context).
    Promise.resolve().then(() => chrome.runtime.sendMessage(message)).then(
      value => { cleanup(); resolve(value as T); },
      error => { cleanup(); reject(error); },
    );
  });
}
