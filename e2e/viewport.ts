export const viewportName = process.env.QUICKLOGIN_E2E_VIEWPORT || "desktop";
if (viewportName !== "desktop" && viewportName !== "mobile") throw new Error("Unsupported QuickLogin viewport");
export const webViewport = viewportName === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
export const popupViewport = { width: 390, height: 720 };
