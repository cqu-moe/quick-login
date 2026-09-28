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
    controller?.abort();
    const current = ++generation;
    controller = new AbortController();
    const request = controller;
    const timeout = window.setTimeout(() => request.abort(), 10_000);
    display("loading");
    const [state, release] = await Promise.allSettled([
      loadDownloadState(request.signal),
      loadRelease(request.signal),
    ]);
    window.clearTimeout(timeout);
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
  window.addEventListener("pageshow", onRefresh);
  onRefresh();
  return () => {
    generation++;
    controller?.abort();
    retries.forEach((button) => button.removeEventListener("click", onRefresh));
    window.removeEventListener("focus", onRefresh);
    window.removeEventListener("pageshow", onRefresh);
  };
}
