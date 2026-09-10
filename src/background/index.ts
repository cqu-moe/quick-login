import { configureTrustedStorage, readLocalState } from "./storage";
import { SYNC_ALARM, SYNC_PERIOD_MINUTES } from "../shared/config";
import { handleMessage, type BackgroundMessage } from "./messages";
import { sync } from "./sync";
import { applyEnvelope, recoverInterruptedWrite } from "./cookie-store";
import { setEnvelopeWriter } from "./sync";

setEnvelopeWriter(applyEnvelope);

export async function ensureSyncAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(SYNC_ALARM);
  if (!existing) {
    chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  }
}

async function start(): Promise<void> {
  await configureTrustedStorage();
  await readLocalState();
  await recoverInterruptedWrite();
  await ensureSyncAlarm();
}

chrome.runtime.onInstalled.addListener(() => { void start(); });
chrome.runtime.onStartup.addListener(() => { void start(); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM || alarm.name === `${SYNC_ALARM}-retry`) {
    void sync("alarm");
  }
});
chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender) => {
  if (sender.id !== chrome.runtime.id) return false;
  return handleMessage(message);
});
void start();
