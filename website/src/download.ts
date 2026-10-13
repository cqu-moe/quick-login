export type DownloadState = "signedOut" | "eligible" | "ineligible";
interface PublicRelease {
  version: string;
  filename: string;
  size: number;
  sha256: string;
  publishedAt: string;
  notes: string[];
}
const auth = "https://auth.cqu.moe";
const api =
  import.meta.env.DEV && import.meta.env.VITE_PREVIEW_API
    ? import.meta.env.VITE_PREVIEW_API
    : `${auth}/api/v1/cqu/quicklogin`;
const versionPattern =
  /^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$/;
const REQUEST_TIMEOUT_MS = 10_000;
const COPY_TIMEOUT_MS = 5_000;
const COPY_FEEDBACK_MS = 2_000;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export async function loadDownloadState(
  signal: AbortSignal,
): Promise<DownloadState> {
  const response = await fetch(api, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (response.status === 401) return "signedOut";
  if (!response.ok) throw new Error("暂时无法确认下载资格，请重试。");
  const body: unknown = await response.json();
  if (
    !isObject(body) ||
    !isObject(body.data) ||
    typeof body.data.eligible !== "boolean"
  )
    throw new Error("资格信息暂不可用，请重试。");
  return body.data.eligible ? "eligible" : "ineligible";
}

async function loadRelease(signal: AbortSignal): Promise<PublicRelease> {
  const versions = new URL(location.href).searchParams.getAll("version");
  if (
    versions.length > 1 ||
    (versions.length === 1 && !versionPattern.test(versions[0]))
  )
    throw new Error("版本号无效，请返回下载页。");
  const url = new URL(`${api}/release`);
  if (versions.length) url.searchParams.set("version", versions[0]);
  const response = await fetch(url.toString(), {
    credentials: "omit",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("安装包暂不可用，请稍后重试。");
  const body: unknown = await response.json();
  const data = isObject(body) && body.data;
  if (
    !isObject(data) ||
    typeof data.version !== "string" ||
    !versionPattern.test(data.version) ||
    data.filename !== `cqu-quicklogin-${data.version}-canary.zip` ||
    typeof data.size !== "number" ||
    !Number.isSafeInteger(data.size) ||
    data.size <= 0 ||
    typeof data.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.sha256) ||
    typeof data.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(data.publishedAt)) ||
    !Array.isArray(data.notes) ||
    !data.notes.every((note) => typeof note === "string")
  )
    throw new Error("版本信息暂不可用，请重试。");
  if (versions.length && data.version !== versions[0])
    throw new Error("版本信息不一致，请重试。");
  return {
    version: data.version,
    filename: `cqu-quicklogin-${data.version}-canary.zip`,
    size: data.size,
    sha256: data.sha256,
    publishedAt: data.publishedAt,
    notes: data.notes,
  };
}

export function mountDownloads(root: ParentNode): () => void {
  const widgets = Array.from(
    root.querySelectorAll<HTMLElement>("[data-download]"),
  );
  if (!widgets.length) return () => {};
  let controller: AbortController | undefined;
  let generation = 0;
  let lastRelease: PublicRelease | undefined;
  let refreshQueued = false;
  let refreshing = false;
  let disposed = false;
  let cancelRequestDeadline: (() => void) | undefined;
  const display = (
    state: DownloadState | "loading" | "error",
    release?: PublicRelease,
    message = "",
  ) => {
    for (const widget of widgets) {
      const link = widget.querySelector<HTMLAnchorElement>(
        "[data-download-link]",
      )!;
      const hint = widget.querySelector<HTMLElement>(
        "[data-download-message]",
      )!;
      const retry = widget.querySelector<HTMLButtonElement>(
        "[data-download-retry]",
      )!;
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
      widget.setAttribute("aria-busy", String(state === "loading"));
      link.textContent = {
        signedOut: "请登录后下载",
        eligible: "下载",
        ineligible: "内测中，暂未开放",
        loading: "正在检查…",
        error: "暂时无法下载",
      }[state];
      hint.textContent = message;
      retry.hidden = !message;
      if (state === "signedOut") {
        const login = new URL("/login", auth);
        const target = new URL("https://quicklogin.cqu.moe/download/");
        if (release && new URL(location.href).searchParams.has("version"))
          target.searchParams.set("version", release.version);
        login.searchParams.set("redirect", target.toString());
        link.href = login.toString();
        link.removeAttribute("aria-disabled");
      } else if (state === "eligible" && release) {
        const url = new URL(`${api}/download`);
        url.searchParams.set("version", release.version);
        link.href = url.toString();
        link.removeAttribute("aria-disabled");
      }
    }
    if (release) lastRelease = release;
    const visibleRelease = release ?? lastRelease;
    for (const status of root.querySelectorAll<HTMLElement>(
      "[data-release-status]",
    )) {
      status.hidden = Boolean(visibleRelease);
      status.textContent =
        state === "loading"
          ? "正在读取版本信息…"
          : "版本信息暂不可用，请稍后重试。";
    }
    for (const details of root.querySelectorAll<HTMLElement>("[data-release]"))
      details.hidden = !visibleRelease;
    if (visibleRelease) {
      const fields: Record<string, string> = {
        version: `v${visibleRelease.version}`,
        size: `${(visibleRelease.size / 1024).toFixed(1)} KB`,
        sha256: visibleRelease.sha256,
        date: new Date(visibleRelease.publishedAt).toLocaleDateString("zh-CN"),
        filename: visibleRelease.filename,
      };
      for (const [key, value] of Object.entries(fields)) {
        for (const element of root.querySelectorAll(`[data-release-${key}]`))
          element.textContent = value;
      }
    }
  };
  const refresh = async () => {
    if (refreshing) {
      refreshQueued = true;
      return;
    }
    refreshing = true;
    const current = ++generation;
    const request = new AbortController();
    controller = request;
    let timeoutId: number | undefined;
    let rejectDeadline!: (reason: Error) => void;
    const requestDeadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
      timeoutId = window.setTimeout(() => {
        request.abort();
        reject(new Error("Download checks timed out."));
      }, REQUEST_TIMEOUT_MS);
    });
    cancelRequestDeadline = () => {
      window.clearTimeout(timeoutId);
      rejectDeadline(new Error("Download checks canceled."));
    };
    display("loading");
    try {
      const [state, release] = await Promise.allSettled([
        Promise.race([loadDownloadState(request.signal), requestDeadline]),
        Promise.race([loadRelease(request.signal), requestDeadline]),
      ]);
      if (current !== generation) return;
      if (state.status === "rejected") {
        display("error", undefined, "暂时无法确认下载资格，请重试。");
        return;
      }
      const metadata = release.status === "fulfilled" ? release.value : undefined;
      display(
        state.value,
        metadata,
        state.value === "eligible" && !metadata
          ? "安装包暂不可用，请稍后重试。"
          : "",
      );
    } finally {
      cancelRequestDeadline();
      cancelRequestDeadline = undefined;
      refreshing = false;
      if (refreshQueued && !disposed) {
        refreshQueued = false;
        void refresh();
      }
    }
  };
  const onRefresh = () => {
    void refresh();
  };
  const retries = widgets.map(
    (widget) =>
      widget.querySelector<HTMLButtonElement>("[data-download-retry]")!,
  );
  retries.forEach((button) => button.addEventListener("click", onRefresh));
  window.addEventListener("focus", onRefresh);
  onRefresh();
  return () => {
    if (disposed) return;
    disposed = true;
    refreshQueued = false;
    generation++;
    controller?.abort();
    cancelRequestDeadline?.();
    retries.forEach((button) => button.removeEventListener("click", onRefresh));
    window.removeEventListener("focus", onRefresh);
  };
}

export function mountCopyButtons(root: ParentNode): () => void {
  const cleanups: (() => void)[] = [];
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    let idleLabel = button.textContent ?? "";
    let restoreTimer: number | undefined;
    let copyTimeoutTimer: number | undefined;
    let clickGeneration = 0;
    let disposed = false;
    let cancelCopyDeadline: (() => void) | undefined;
    const onClick = async () => {
      if (button.getAttribute("aria-busy") === "true") return;
      const click = ++clickGeneration;
      const value =
        button.dataset.copy === "checksum"
          ? document.querySelector("[data-release-sha256]")?.textContent?.trim()
          : button.dataset.copy?.trim();
      if (!value) return;
      window.clearTimeout(restoreTimer);
      button.setAttribute("aria-busy", "true");
      button.dataset.copyState = "copying";
      button.textContent = "复制中…";
      let rejectCopyDeadline!: (reason: Error) => void;
      const copyTimeout = new Promise<never>((_, reject) => {
        rejectCopyDeadline = reject;
        copyTimeoutTimer = window.setTimeout(() => {
          reject(new Error("Clipboard write timed out."));
        }, COPY_TIMEOUT_MS);
      });
      cancelCopyDeadline = () => {
        window.clearTimeout(copyTimeoutTimer);
        rejectCopyDeadline(new Error("Clipboard write canceled."));
      };
      try {
        await Promise.race([navigator.clipboard.writeText(value), copyTimeout]);
        if (disposed || click !== clickGeneration) return;
        button.textContent = "已复制";
        button.dataset.copyState = "copied";
      } catch {
        if (disposed || click !== clickGeneration) return;
        button.textContent = "复制失败，请手动选择";
        button.dataset.copyState = "error";
      } finally {
        cancelCopyDeadline();
        cancelCopyDeadline = undefined;
      }
      if (disposed || click !== clickGeneration) return;
      button.setAttribute("aria-busy", "false");
      restoreTimer = window.setTimeout(() => {
        if (disposed || click !== clickGeneration) return;
        button.textContent = idleLabel;
        button.dataset.copyState = "idle";
      }, COPY_FEEDBACK_MS);
    };
    button.addEventListener("click", onClick);
    cleanups.push(() => {
      if (disposed) return;
      disposed = true;
      clickGeneration++;
      window.clearTimeout(restoreTimer);
      cancelCopyDeadline?.();
      button.removeEventListener("click", onClick);
      button.textContent = idleLabel;
      button.dataset.copyState = "idle";
      button.removeAttribute("aria-busy");
    });
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
