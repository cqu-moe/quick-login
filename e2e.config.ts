import { web } from "@e2e-dev/web";
import { extensionBrowser } from "./e2e/browser.ts";

export default {
  tests: ["e2e/**/*.e2e.ts"],
  workers: 1,
  retries: 0,
  trace: "retain-on-failure",
  targets: [{
    name: "desktop",
    engine: web({ browser: extensionBrowser }),
    app: {
      url: "http://127.0.0.1:0",
      command: {
        executable: process.execPath,
        args: ["e2e/noop-server.mjs", "{port}"],
      },
    },
  }],
};
