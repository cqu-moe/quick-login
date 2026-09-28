import "./style.css";
import { mountDownloads } from "./download";

mountDownloads(document);
for (const link of document.querySelectorAll<HTMLAnchorElement>("nav a")) {
  if (new URL(link.href).pathname === location.pathname)
    link.setAttribute("aria-current", "page");
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-copy]",
)) {
  button.addEventListener("click", async () => {
    const original = button.textContent;
    const value =
      button.dataset.copy === "checksum"
        ? document.querySelector("[data-release-sha256]")?.textContent
        : button.dataset.copy;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = "已复制";
    } catch {
      button.textContent = "复制失败，请手动选择";
    }
    window.setTimeout(() => {
      button.textContent = original;
    }, 2000);
  });
}
