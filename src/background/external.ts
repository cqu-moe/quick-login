import { requestConnection } from "./connection";
import { config } from "../shared/config";

export async function handleExternalMessage(value: unknown, sender: chrome.runtime.MessageSender) {
  let source:URL;
  try { source=new URL(sender.url ?? ""); } catch { throw new Error("FORBIDDEN"); }
  if (source.origin !== config.authOrigin || source.pathname !== "/settings" || sender.frameId !== 0 || sender.id) throw new Error("FORBIDDEN");
  if (!value || typeof value !== "object") throw new Error("INVALID_REQUEST");
  const message=value as Record<string,unknown>;
  if (Object.keys(message).sort().join(",") !== "deviceId,expiresAt,resumeTicket,type" || message.type !== "RESUME_DEVICE" ||
      typeof message.deviceId !== "string" || !message.deviceId || message.deviceId.length>160 ||
      typeof message.resumeTicket !== "string" || !message.resumeTicket || message.resumeTicket.length>4096 ||
      typeof message.expiresAt !== "number" || message.expiresAt<=Date.now() || message.expiresAt>Date.now()+310_000) throw new Error("INVALID_REQUEST");
  const resume={deviceId:message.deviceId,resumeTicket:message.resumeTicket,expiresAt:message.expiresAt};
  return requestConnection(resume);
}
