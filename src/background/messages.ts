import { requestConnection } from "./connection";
import {
  enterManualMode,
  retryAutomaticNow,
  resumeAutomaticMode,
  setEnabled,
  switchToManagedOnce,
  prepareAutomaticMode,
  sync,
} from "./sync";
import { readLocalState } from "./storage";
import type { ContentMessage, LoginRecoveryResult } from "../shared/messages";
import { config } from "../shared/config";
import { localCookieState } from "./api-v3";
import { recordFailure } from "./sync";
import { derivePopupView, type PopupInput } from "../popup/view-model";
import type { LocalState } from "../shared/contracts";
import { navigateRecoveredPage, observeSchoolLogin } from "./school-recovery";
import { derivePresentation } from "../shared/protocol-v3.generated";
import {
  captureQuickloginOperation,
  durationFrom,
  telemetryErrorCode,
  type QuickLoginOperation,
} from "../shared/posthog";

export type BackgroundMessage =
  | { type: "SYNC" }
  | { type: "CHECK_STATE" }
  | { type: "RETRY_LOCAL" }
  | { type: "OPEN_EXTENSION_SETTINGS" }
  | { type: "OPEN_SCHOOL_MANUAL" }
  | { type: "LOGIN" }
  | { type: "SET_ENABLED"; enabled: boolean }
  | { type: "ENTER_MANUAL" }
  | { type: "RESUME" }
  | { type: "SWITCH_TO_MANAGED" }
  | { type: "OPEN_SETTINGS" }
  | { type: "GET_UI_STATE" };

const loginFormFlights = new Map<string, Promise<LoginRecoveryResult>>();

function popupInput(state: LocalState): PopupInput {
  return { deviceId:state.deviceId,snapshot:state.snapshot,
    local:{ authorization:state.authorization,observation:state.observation,protocolSupport:state.protocolSupport,
      ...(state.deviceId ? {enabledIntent:state.enabledIntent} : {}),mode:state.manualOverride ? "manual" : "automatic",
      cookieState:localCookieState(state),receipt:state.receipt,pendingAck:state.pendingAck,schoolAccess:state.schoolAccess },
    recoveryFailed:state.loginRecovery?.failed ?? false,
    lastError:state.localError,lastConfirmedAt:state.lastConfirmedAt,nextAttemptAt:state.nextAttemptAt };
}

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
  const page = {tabId:sender.tab.id,documentId:sender.documentId ?? null};
  if (message.type === "RETRY_AUTOMATIC") {
    await prepareAutomaticMode();
  }
  const isObservation = message.type === "LOGIN_FORM_VISIBLE" || message.type === "RETRY_AUTOMATIC";
  if (isObservation) await observeSchoolLogin(page);
  let after = await readLocalState();
  if (after.loginRecovery?.failed || after.manualOverride) {
    return {kind:"manual_required",message:"快捷登录未成功，请在学校页面手动登录，或重试快捷登录。"};
  }
  if (!after.enabledIntent || !after.deviceId) return {kind:"idle"};
  if (await navigateRecoveredPage(page,sender.url)) {
    return { kind: "navigating" };
  }
  if (message.type !== "GET_UI_STATE") {
    // UI requests never wait on school/network work. Safe notifications carry progress.
    void sync(message.type === "RETRY_AUTOMATIC" ? "user_retry" : isObservation ? "login_form" : "popup").catch(recordFailure);
  }
  after = await readLocalState();
  const view = derivePopupView(popupInput(after));
  return {kind:"recovering",message:[view.heading,view.description].filter(Boolean).join("。")};
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
  const flight = processContentMessage(message, sender).finally(() => {
    if (loginFormFlights.get(key) === flight) loginFormFlights.delete(key);
  });
  loginFormFlights.set(key, flight);
  return flight;
}

export async function handleMessage(message: BackgroundMessage) {
  const tracked = async (
    name: QuickLoginOperation,
    operation: () => Promise<unknown>,
    noOp?: (result: unknown) => boolean
  ) => {
    const startedAt = Date.now();
    try {
      const result = await operation();
      captureQuickloginOperation(name, {
        outcome: "success",
        trigger: "user",
        durationMs: durationFrom(startedAt),
        ...(noOp?.(result) ? { noOp: true } : {}),
      });
      return result;
    } catch (error) {
      captureQuickloginOperation(name, {
        outcome: "failure",
        trigger: "user",
        durationMs: durationFrom(startedAt),
        errorCode: telemetryErrorCode(error),
      });
      throw error;
    }
  };
  const launch = (
    name: QuickLoginOperation,
    operation: () => Promise<unknown>,
    noOp?: (result: unknown) => boolean
  ) => {
    void tracked(name, operation, noOp).catch(recordFailure);
    return { accepted:true };
  };
  switch (message.type) {
    case "LOGIN": return requestConnection();
    case "SET_ENABLED":
      if (typeof message.enabled !== "boolean") throw new Error("INVALID_REQUEST");
      return launch(
        message.enabled ? "enable" : "disable",
        () => setEnabled(message.enabled),
        result => result === false
      );
    case "ENTER_MANUAL": await enterManualMode(); return { ok: true };
    case "RESUME": await tracked("resume", resumeAutomaticMode, result => result === false); return { ok: true };
    case "SWITCH_TO_MANAGED":
      await tracked("switch_managed", switchToManagedOnce, result => result === false);
      return { ok: true };
    case "OPEN_SETTINGS": {
      const state = await readLocalState();
      const url = new URL("/settings", config.authOrigin);
      if (state.deviceId) url.searchParams.set("quickloginDevice", state.deviceId);
      if (state.deviceId && state.authorization === "reconnect_required") url.searchParams.set("quickloginReconnect","1");
      const presentation=derivePresentation(state.snapshot,{authorization:state.authorization,observation:state.observation});
      if (presentation.actionTarget) {
        const target=new URL(presentation.actionTarget,config.authOrigin);
        for (const [key,value] of target.searchParams) url.searchParams.set(key,value);
      }
      await chrome.tabs.create({ url: url.toString() });
      return { ok: true };
    }
    case "OPEN_EXTENSION_SETTINGS":
      await chrome.tabs.create({url:`chrome://extensions/?id=${chrome.runtime.id}`}); return {ok:true};
    case "OPEN_SCHOOL_MANUAL":
      await enterManualMode();
      await chrome.tabs.create({url:"https://sso.cqu.edu.cn/login"}); return {ok:true};
    case "SYNC": {
      const startedAt = Date.now();
      void retryAutomaticNow().then(started => {
        if (!started) {
          captureQuickloginOperation("sync", {
            outcome: "success",
            trigger: "user",
            durationMs: durationFrom(startedAt),
            noOp: true,
          });
        }
      }).catch(recordFailure);
      return { accepted: true };
    }
    case "CHECK_STATE": { void sync("popup").catch(recordFailure); return { accepted:true }; }
    case "RETRY_LOCAL": void sync("popup").catch(recordFailure); return { accepted: true };
    case "GET_UI_STATE": {
      const state = await readLocalState();
      return popupInput(state);
    }
  }
}
