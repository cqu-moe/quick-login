import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.doUnmock("./telemetry");
  vi.unstubAllGlobals();
});

it.each(["load", "initialize"])("keeps website controls usable while telemetry loads and when it fails to %s", async (failure) => {
  vi.resetModules();
  document.body.innerHTML = `
    <div data-download><a data-download-link></a><p data-download-message></p>
      <button data-download-retry hidden>重试</button></div>
    <button data-copy="chrome://extensions">复制地址</button>`;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const requested = Promise.withResolvers<void>();
  const loaded = Promise.withResolvers<void>();
  const initializeWebsiteTelemetry = vi.fn(() => { throw new Error("Telemetry unavailable"); });
  vi.doMock("./telemetry", async () => {
    requested.resolve();
    await loaded.promise;
    if (failure === "load") throw new Error("Telemetry chunk unavailable");
    return { initializeWebsiteTelemetry };
  });
  const main = import("./main");
  // Settle a rejected static import too, so the pre-fix failure is the blocked UI.
  const settled = main.catch(() => {});
  try {
    await requested.promise;
    await vi.waitFor(() => expect(document.querySelector("[data-download-link]")?.textContent).toBe("请登录后下载"));
    const copy = document.querySelector<HTMLButtonElement>("[data-copy]")!;
    copy.click();
    await vi.waitFor(() => expect(copy.textContent).toBe("已复制"));
    expect(writeText).toHaveBeenCalledWith("chrome://extensions");
    expect(initializeWebsiteTelemetry).not.toHaveBeenCalled();
    loaded.resolve();
    await main;
    await vi.dynamicImportSettled();
    expect(document.querySelector("[data-download-link]")?.getAttribute("aria-disabled")).toBeNull();
    if (failure === "initialize") expect(initializeWebsiteTelemetry).toHaveBeenCalledOnce();
  } finally {
    loaded.resolve();
    await settled;
    await vi.dynamicImportSettled();
  }
});
