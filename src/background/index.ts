import { configureTrustedStorage, LOCAL_STATE_KEY, readLocalState } from "./storage";
import { forgetSchoolPage, notifySchoolPages, onSchoolTabUpdated } from "./school-recovery";
import type { LocalState } from "../shared/contracts";
import { SYNC_ALARM, SYNC_PERIOD_MINUTES } from "../shared/config";
import { handleContentMessage, handleMessage, type BackgroundMessage } from "./messages";
import type { ContentMessage } from "../shared/messages";
import { sync } from "./sync";
import { applyEnvelope, recoverInterruptedWrite } from "./cookie-store";
import { setEnvelopeWriter } from "./sync";
import { handleExternalMessage } from "./external";
import { recoverInterruptedConnection } from "./connection";
import { applyAvailableUpdate, checkForExtensionUpdate, withUpdateGuard } from "./updates";

setEnvelopeWriter(applyEnvelope);

export async function ensureSyncAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(SYNC_ALARM);
  if (!existing) {
    chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  }
}

function start(): Promise<void> {
  return withUpdateGuard(async () => {
    await configureTrustedStorage();
    const state = await readLocalState();
    if (state.protocolSupport === "client_update_required") void checkForExtensionUpdate();
    await recoverInterruptedConnection();
    await recoverInterruptedWrite();
    await ensureSyncAlarm();
    await sync("startup");
  });
}

chrome.runtime.onInstalled.addListener(() => { void start(); });
chrome.runtime.onStartup.addListener(() => { void start(); });
chrome.runtime.onUpdateAvailable.addListener(applyAvailableUpdate);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM || alarm.name === `${SYNC_ALARM}-retry`) {
    void sync("alarm");
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[LOCAL_STATE_KEY]) {
    const change = changes[LOCAL_STATE_KEY] as {oldValue?:LocalState;newValue?:LocalState};
    notifySchoolPages(change.oldValue, change.newValue);
    if (change.newValue?.protocolSupport === "client_update_required" &&
        change.oldValue?.protocolSupport !== "client_update_required") void checkForExtensionUpdate();
  }
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => { void withUpdateGuard(() => onSchoolTabUpdated(tabId,change,tab)); });
chrome.tabs.onRemoved.addListener(tabId => { void withUpdateGuard(() => forgetSchoolPage(tabId)); });
chrome.runtime.onMessage.addListener((message: BackgroundMessage | ContentMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const senderUrl = sender.url ? new URL(sender.url) : null;
  if (senderUrl?.protocol === "chrome-extension:" &&
      senderUrl.hostname === chrome.runtime.id && senderUrl.pathname === "/popup.html") {
    void withUpdateGuard(() => handleMessage(message as BackgroundMessage).then(sendResponse,()=>sendResponse({accepted:false})));
    return true;
  }
  if (sender.tab && senderUrl?.protocol === "https:" && senderUrl.hostname === "sso.cqu.edu.cn") {
    void withUpdateGuard(() => handleContentMessage(message as ContentMessage,sender).then(sendResponse,()=>sendResponse({kind:"idle"})));
    return true;
  }
  return false;
});
chrome.runtime.onMessageExternal.addListener((message,sender,sendResponse) => {
  void withUpdateGuard(() => handleExternalMessage(message,sender).then(sendResponse,()=>sendResponse({accepted:false})));
  return true;
});
void start();
