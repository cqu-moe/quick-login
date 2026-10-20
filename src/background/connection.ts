import { loginInteractive } from "./auth";
import { readLocalState, updateLocalState } from "./storage";
import { setEnabled } from "./sync";
import { SYNC_ALARM } from "../shared/config";
import { withUpdateGuard } from "./updates";

let activeConnectionId: string | null = null;

async function abandonConnection(id: string | null): Promise<void> {
  let abandoned = false;
  await updateLocalState(state => {
    if ((state.connectIntentId !== id && state.connectIntentId !== null) || state.authorization !== "authorizing") return state;
    abandoned = true;
    return { ...state, connectIntentId: null, authorization: state.deviceId ? "reconnect_required" : "disconnected",
      localError: "AUTH_RECONNECT_REQUIRED", nextAttemptAt: null, observation: "stale" };
  });
  if (abandoned) await chrome.alarms.clear(`${SYNC_ALARM}-retry`);
}

export async function recoverInterruptedConnection(): Promise<void> {
  const state = await readLocalState();
  if (activeConnectionId === null && state.authorization === "authorizing") await abandonConnection(state.connectIntentId);
}

export async function requestConnection(resume?: Parameters<typeof loginInteractive>[0]) {
  if (activeConnectionId !== null) return { accepted: true };
  const id=crypto.randomUUID();
  activeConnectionId = id;
  try {
    await updateLocalState((state)=>({...state,connectIntentId:id,authorization:"authorizing",localError:null}));
  } catch (error) { activeConnectionId = null; throw error; }
  void withUpdateGuard(() => loginInteractive(resume).then(async()=>{
    await setEnabled(true,id);
  }).catch(() => abandonConnection(id)).finally(() => { if (activeConnectionId === id) activeConnectionId = null; }));
  return {accepted:true};
}
