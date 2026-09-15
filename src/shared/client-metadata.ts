import type { ClientMetadata } from "./protocol-v3.generated";
import type { LocalState } from "./contracts";

export function clientMetadata(state: LocalState): ClientMetadata {
  return {
    extensionVersion: chrome.runtime.getManifest().version,
    buildId: typeof __QUICKLOGIN_BUILD_ID__ === "string" ? __QUICKLOGIN_BUILD_ID__ : "development",
    browserVersion: navigator.userAgent.match(/Chrome\/(\d+(?:\.\d+)*)/)?.[1] ?? "unknown",
    installationId: state.installationId,
  };
}
