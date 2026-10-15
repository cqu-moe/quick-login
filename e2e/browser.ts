import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { BrowserProvider } from "@e2e-dev/web";
import { chromium } from "playwright-core";

const extensionPath = join(process.cwd(), "dist");
const activeEndpoint = globalThis as typeof globalThis & { __QUICKLOGIN_CDP_ENDPOINT__?: string };

async function stopChromium(child: ChildProcess, profile: string) {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve, reject) => {
      let forceTimer: ReturnType<typeof setTimeout>;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        forceTimer = setTimeout(() => reject(new Error("Chromium did not exit after SIGKILL")), 3000);
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        clearTimeout(forceTimer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
  await rm(profile, { recursive: true, force: true });
}

export const extensionBrowser: BrowserProvider = {
  name: "quicklogin-mv3",
  scope: "attempt",
  async acquire(request) {
    request.signal.throwIfAborted();
    const requestedOutput = process.env.QUICKLOGIN_E2E_ARTIFACTS;
    if (!requestedOutput) throw new Error("Missing isolated browser output directory");
    const output = resolve(requestedOutput);
    if (!output.startsWith(resolve(process.cwd(), ".e2e") + sep)) {
      throw new Error("Browser output must be inside this worktree's .e2e directory");
    }
    const profiles = join(output, "profiles");
    await mkdir(profiles, { recursive: true });
    const profile = await mkdtemp(join(profiles, "chromium-"));
    let child: ChildProcess | undefined;
    let handedOff = false;
    let launchFailure: unknown;
    try {
      const arguments_ = [
        "--headless=new",
        "--password-store=basic",
        "--use-mock-keychain",
        "--user-data-dir=" + profile,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-domain-reliability",
        "--disable-sync",
        "--disable-features=AutofillServerCommunication",
        "--metrics-recording-only",
        "--no-pings",
        "--check-for-update-interval=2147483647",
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
      ];
      if (process.env.QUICKLOGIN_E2E_TLS_SPKI) {
        arguments_.push(`--ignore-certificate-errors-spki-list=${process.env.QUICKLOGIN_E2E_TLS_SPKI}`);
      }
      if (process.env.QUICKLOGIN_E2E_PROXY) {
        const proxy = new URL(process.env.QUICKLOGIN_E2E_PROXY);
        arguments_.push(`--proxy-server=${proxy.hostname}:${proxy.port}`);
      }
      arguments_.push("about:blank");
      request.signal.throwIfAborted();
      child = spawn(chromium.executablePath(), arguments_, { stdio: "ignore" });
      let launchError: Error | undefined;
      child.once("error", error => { launchError = error; });
      let endpoint = "";
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !endpoint && !request.signal.aborted && !launchError && child.exitCode === null && child.signalCode === null) {
        try {
          const port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n", 1)[0]);
          const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(1000)]),
          });
          if (response.ok) endpoint = new URL(response.url).origin;
        } catch {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      if (!endpoint) {
        throw new Error(launchError ? `Chromium launch failed: ${launchError.message}` : "Chromium did not expose a CDP endpoint");
      }
      request.signal.throwIfAborted();
      activeEndpoint.__QUICKLOGIN_CDP_ENDPOINT__ = endpoint;
      handedOff = true;
      return { id: profile, cdpEndpoint: endpoint, child, profile };
    } catch (error) {
      launchFailure = error;
      throw error;
    } finally {
      if (!handedOff) {
        delete activeEndpoint.__QUICKLOGIN_CDP_ENDPOINT__;
        try {
          if (child) await stopChromium(child, profile);
          else await rm(profile, { recursive: true, force: true });
        } catch (cleanupError) {
          if (launchFailure) throw new AggregateError([launchFailure, cleanupError], "Chromium launch and cleanup both failed");
          throw cleanupError;
        }
      }
    }
  },
  async release(lease) {
    const state = lease as { child?: ChildProcess; profile?: string };
    try {
      if (state.child && state.profile) await stopChromium(state.child, state.profile);
    } finally {
      delete activeEndpoint.__QUICKLOGIN_CDP_ENDPOINT__;
    }
  },
};
