import { web } from "@e2e-dev/web";
import { extensionBrowser } from "./e2e/browser.ts";
import { popupViewport, viewportName } from "./e2e/viewport.ts";

export default {
  tests: ["e2e/**/*.e2e.ts"],
  workers: 1,
  retries: 0,
  trace: "retain-on-failure",
  targets: [{
    name: viewportName,
    engine: web({ browser: extensionBrowser, viewport: popupViewport }),
    app: {
      url: "http://127.0.0.1:0",
      command: {
        executable: process.execPath,
        args: ["e2e/noop-server.mjs", "{port}"],
      },
    },
  }],
};
