import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  loadDownloadState,
  mountCopyButtons,
  mountDownloads,
} from "./download";
const record = {
  version: "0.4.0",
  filename: "cqu-quicklogin-0.4.0-canary.zip",
  size: 128000,
  sha256: "a".repeat(64),
  publishedAt: "2026-09-28T00:00:00Z",
  notes: ["测试版本"],
};
let cleanup: (() => void) | undefined;
beforeEach(() => {
  document.body.innerHTML =
    "<div data-download><a data-download-link></a><p data-download-message></p><button data-download-retry hidden>重试</button></div><dl data-release hidden><dd data-release-version></dd><dd data-release-size></dd><dd data-release-sha256></dd></dl>";
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function respond(state: "signedOut" | "eligible" | "ineligible") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/release")
        ? Response.json({ data: record })
        : state === "signedOut"
          ? new Response("", { status: 401 })
          : Response.json({ data: { eligible: state === "eligible" } }),
    ),
  );
}

function deferredVoid() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

it("restores the idle copy label after a repeated copy click", async () => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<button data-copy="chrome://extensions" type="button">复制扩展管理页地址</button>';
  const firstWrite = deferredVoid();
  const secondWrite = deferredVoid();
  const writeText = vi
    .fn()
    .mockReturnValueOnce(firstWrite.promise)
    .mockReturnValueOnce(secondWrite.promise);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  cleanup = mountCopyButtons(document);
  const button = document.querySelector<HTMLButtonElement>("[data-copy]")!;

  button.click();
  firstWrite.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(button.textContent).toBe("已复制");

  await vi.advanceTimersByTimeAsync(1000);
  button.click();
  secondWrite.resolve();
  await Promise.resolve();
  await Promise.resolve();

  await vi.advanceTimersByTimeAsync(1000);
  expect(button.textContent).toBe("已复制");
  await vi.advanceTimersByTimeAsync(1000);
  expect(button.textContent).toBe("复制扩展管理页地址");
});

it("shows an error when download checks never settle", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  cleanup = mountDownloads(document);

  await vi.advanceTimersByTimeAsync(10_000);
  expect(
    document.querySelector<HTMLButtonElement>("[data-download-retry]")!.hidden,
  ).toBe(false);
  expect(document.querySelector("[data-download-link]")?.textContent).toBe(
    "暂时无法下载",
  );
});

it("cancels download deadlines and listeners when unmounted", async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      return new Promise<Response>(() => {});
    }),
  );
  const dispose = mountDownloads(document);
  expect(vi.getTimerCount()).toBe(1);

  dispose();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  window.dispatchEvent(new Event("focus"));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("times out a clipboard write that never settles", async () => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<button data-copy="chrome://extensions" type="button">复制扩展管理页地址</button>';
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn(() => new Promise<void>(() => {})) },
  });
  const dispose = mountCopyButtons(document);
  const button = document.querySelector<HTMLButtonElement>("[data-copy]")!;

  button.click();
  await vi.advanceTimersByTimeAsync(4_999);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.textContent).toBe("复制中…");

  await vi.advanceTimersByTimeAsync(1);
  expect(button.getAttribute("aria-busy")).toBe("false");
  expect(button.textContent).toBe("复制失败，请手动选择");

  await vi.advanceTimersByTimeAsync(2_000);
  expect(button.textContent).toBe("复制扩展管理页地址");
  dispose();
});

it("ignores a clipboard result that settles after unmount", async () => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<button data-copy="chrome://extensions" type="button">复制扩展管理页地址</button>';
  const write = deferredVoid();
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => write.promise) } });
  const dispose = mountCopyButtons(document);
  const button = document.querySelector<HTMLButtonElement>("[data-copy]")!;

  button.click();
  expect(button.getAttribute("aria-busy")).toBe("true");
  dispose();
  expect(button.getAttribute("aria-busy")).toBe(null);
  expect(button.textContent).toBe("复制扩展管理页地址");

  write.resolve();
  await vi.advanceTimersByTimeAsync(7_000);
  expect(button.textContent).toBe("复制扩展管理页地址");
  expect(button.getAttribute("aria-busy")).toBe(null);
});

it.each([
  ["signedOut", "请登录后下载"],
  ["eligible", "下载"],
  ["ineligible", "内测中，暂未开放"],
] as const)(
  "renders %s without automatically downloading",
  async (state, label) => {
    respond(state);
    cleanup = mountDownloads(document);
    await vi.waitFor(() =>
      expect(document.querySelector("[data-download-link]")?.textContent).toBe(
        label,
      ),
    );
    const link = document.querySelector<HTMLAnchorElement>(
      "[data-download-link]",
    )!;
    if (state === "eligible")
      expect(new URL(link.href).searchParams.get("version")).toBe("0.4.0");
    if (state === "signedOut")
      expect(new URL(link.href).searchParams.get("redirect")).toBe(
        "https://quicklogin.cqu.moe/download/",
      );
    if (state === "ineligible") expect(link.hasAttribute("href")).toBe(false);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).includes("/download")),
    ).toBe(false);
  },
);
it("does not confuse failed or malformed eligibility queries with ineligibility", async () => {
  for (const response of [
    new Response("", { status: 503 }),
    Response.json({ data: {} }),
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response.clone()),
    );
    await expect(
      loadDownloadState(new AbortController().signal),
    ).rejects.toThrow();
  }
  cleanup = mountDownloads(document);
  await vi.waitFor(() =>
    expect(
      document.querySelector<HTMLButtonElement>("[data-download-retry]")!
        .hidden,
    ).toBe(false),
  );
  expect(document.body.textContent).not.toContain("内测中，暂未开放");
});
it("refreshes on focus and ignores responses from an earlier query", async () => {
  let finish!: (value: Response) => void;
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/release")) return Response.json({ data: record });
      if (calls++ === 0)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return Response.json({ data: { eligible: false } });
    }),
  );
  cleanup = mountDownloads(document);
  expect(fetch).toHaveBeenCalledTimes(2);
  for (let index = 0; index < 3; index += 1)
    window.dispatchEvent(new Event("focus"));
  expect(fetch).toHaveBeenCalledTimes(2);

  finish(Response.json({ data: { eligible: false } }));
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("内测中，暂未开放"),
  );
  expect(fetch).toHaveBeenCalledTimes(4);

  finish(Response.json({ data: { eligible: true } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    document.querySelector("[data-download-link]")!.hasAttribute("href"),
  ).toBe(false);
});

it("keeps published metadata visible while refreshing eligibility", async () => {
  respond("eligible");
  cleanup = mountDownloads(document);
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>("[data-release]")!.hidden).toBe(
      false,
    ),
  );
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))),
  );
  window.dispatchEvent(new Event("focus"));
  expect(document.querySelector<HTMLElement>("[data-release]")!.hidden).toBe(
    false,
  );
  for (const finish of pending) finish(Response.json({ data: {} }));
});
