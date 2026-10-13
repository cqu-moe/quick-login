import "./style.css";
import { mountCopyButtons, mountDownloads } from "./download";

let cleanupDownloads = () => {};
let cleanupCopyButtons = () => {};
let websiteControlsMounted = true;
const unmountWebsiteControls = () => {
  if (!websiteControlsMounted) return;
  websiteControlsMounted = false;
  cleanupDownloads();
  cleanupCopyButtons();
};
const mountWebsiteControls = () => {
  if (websiteControlsMounted) return;
  websiteControlsMounted = true;
  cleanupDownloads = mountDownloads(document);
  cleanupCopyButtons = mountCopyButtons(document);
};
cleanupDownloads = mountDownloads(document);
cleanupCopyButtons = mountCopyButtons(document);
window.addEventListener(
  "pagehide",
  () => {
    unmountWebsiteControls();
  },
);
window.addEventListener(
  "pageshow",
  (event) => {
    if (!event.persisted) return;
    mountWebsiteControls();
  },
);
for (const link of document.querySelectorAll<HTMLAnchorElement>("nav a")) {
  if (new URL(link.href).pathname === location.pathname)
    link.setAttribute("aria-current", "page");
}
