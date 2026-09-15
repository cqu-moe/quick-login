import { loginInteractive } from "./auth";
import { readLocalState, updateLocalState } from "./storage";
import { recordFailure, setEnabled } from "./sync";

export async function requestConnection(resume?: Parameters<typeof loginInteractive>[0]) {
  const id=crypto.randomUUID();
  await updateLocalState((state)=>({...state,connectIntentId:id,authorization:"authorizing",localError:null}));
  void loginInteractive(resume).then(async()=>{
    await setEnabled(true,id);
  }).catch(async(error)=>{
    if ((await readLocalState()).connectIntentId === id) await recordFailure(error);
  });
  return {accepted:true};
}
