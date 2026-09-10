import { loginInteractive } from "./auth";
import { enterManualMode, resumeAutomaticMode, setEnabled, sync } from "./sync";
import { readLocalState } from "./storage";

export type BackgroundMessage =
  | { type: "SYNC" }
  | { type: "LOGIN" }
  | { type: "SET_ENABLED"; enabled: boolean }
  | { type: "ENTER_MANUAL" }
  | { type: "RESUME" }
  | { type: "GET_UI_STATE" };

export async function handleMessage(message: BackgroundMessage) {
  switch (message.type) {
    case "LOGIN": await loginInteractive(); return { ok: true };
    case "SET_ENABLED": await setEnabled(message.enabled); return { ok: true };
    case "ENTER_MANUAL": await enterManualMode(); return { ok: true };
    case "RESUME": await resumeAutomaticMode(); return { ok: true };
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
