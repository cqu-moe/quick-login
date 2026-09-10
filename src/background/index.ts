import { configureTrustedStorage, readLocalState } from "./storage";
import { SYNC_ALARM, SYNC_PERIOD_MINUTES } from "../shared/config";

export async function ensureSyncAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(SYNC_ALARM);
  if (!existing) {
    chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  }
}

async function start(): Promise<void> {
  await configureTrustedStorage();
  await readLocalState();
  await ensureSyncAlarm();
}

chrome.runtime.onInstalled.addListener(() => { void start(); });
chrome.runtime.onStartup.addListener(() => { void start(); });
void start();
