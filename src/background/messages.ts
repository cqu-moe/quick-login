import { loginInteractive } from "./auth";
import {
  enterManualMode,
  resumeAutomaticMode,
  setEnabled,
  switchToManagedOnce,
  sync,
} from "./sync";
import { readLocalState, updateLocalState } from "./storage";
import { markManualRequired } from "./sync";
import type { ContentMessage, LoginRecoveryResult } from "../shared/messages";
import { config } from "../shared/config";

export type BackgroundMessage =
  | { type: "SYNC" }
  | { type: "LOGIN" }
  | { type: "SET_ENABLED"; enabled: boolean }
  | { type: "ENTER_MANUAL" }
  | { type: "RESUME" }
  | { type: "SWITCH_TO_MANAGED" }
  | { type: "OPEN_SETTINGS" }
  | { type: "GET_UI_STATE" };

const loginFormFlights = new Map<string, Promise<LoginRecoveryResult>>();

function validSsoSender(sender: chrome.runtime.MessageSender): sender is chrome.runtime.MessageSender & {
  tab: chrome.tabs.Tab & { id: number };
  url: string;
} {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.tab.id === undefined || !sender.url) return false;
  const url = new URL(sender.url);
  return url.protocol === "https:" && url.hostname === "sso.cqu.edu.cn" &&
    (url.pathname === "/login" || url.pathname === "/authserver/login");
}

async function processContentMessage(
  message: ContentMessage,
  sender: chrome.runtime.MessageSender
): Promise<LoginRecoveryResult> {
  if (!validSsoSender(sender)) throw new Error("FORBIDDEN");
  if (message.type === "ENTER_MANUAL") {
    await enterManualMode();
    return { kind: "manual_required", message: "已切换手动登录。" };
  }
  if (message.type === "RETRY_AUTOMATIC") {
    await resumeAutomaticMode();
  } else if (message.type === "LOGIN_FORM_VISIBLE") {
    const before = await readLocalState();
    if (before.recovery?.phase === "navigated" &&
        before.recovery.navigatedTabId === sender.tab.id) {
      await markManualRequired();
      return {
        kind: "manual_required",
        message: "快捷登录未成功，请在学校页面手动登录。",
      };
    }
    await sync("login_form");
  }
  const after = await readLocalState();
  if (after.recovery?.phase === "finished" && after.localWriteState === "ready") {
    await updateLocalState((state) => ({
      ...state,
      recovery: state.recovery ? {
        ...state.recovery,
        phase: "navigated",
        navigatedTabId: sender.tab.id,
      } : null,
    }));
    await chrome.tabs.update(sender.tab.id, { url: sender.url });
    return { kind: "navigating" };
  }
  if (after.recovery?.phase === "manual_required" || after.manualOverride) {
    return { kind: "manual_required", message: "请继续在学校页面手动登录。" };
  }
  return { kind: "idle" };
}

export function handleContentMessage(
  message: ContentMessage,
  sender: chrome.runtime.MessageSender
): Promise<LoginRecoveryResult> {
  if (message.type !== "LOGIN_FORM_VISIBLE" || !validSsoSender(sender)) {
    return processContentMessage(message, sender);
  }
  const key = `${sender.tab.id}:${sender.documentId ?? sender.url}`;
  const existing = loginFormFlights.get(key);
  if (existing) return existing;
  const flight = processContentMessage(message, sender);
  loginFormFlights.set(key, flight);
  return flight;
}

export async function handleMessage(message: BackgroundMessage) {
  switch (message.type) {
    case "LOGIN": await loginInteractive(); return { ok: true };
    case "SET_ENABLED": await setEnabled(message.enabled); return { ok: true };
    case "ENTER_MANUAL": await enterManualMode(); return { ok: true };
    case "RESUME": await resumeAutomaticMode(); return { ok: true };
    case "SWITCH_TO_MANAGED": await switchToManagedOnce(); return { ok: true };
    case "OPEN_SETTINGS": {
      const state = await readLocalState();
      const url = new URL("/settings", config.authOrigin);
      if (state.deviceId) url.searchParams.set("quickloginDevice", state.deviceId);
      await chrome.tabs.create({ url: url.toString() });
      return { ok: true };
    }
    case "SYNC": await sync("network"); return { ok: true };
    case "GET_UI_STATE": {
      const state = await readLocalState();
      return {
        authorized: state.deviceId !== null,
        status: state.status,
        manualOverride: state.manualOverride,
        localWriteState: state.localWriteState,
        lastError: state.lastError,
      };
    }
  }
}
