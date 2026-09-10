import type { CookieEnvelope, DeviceStatus } from "../shared/contracts";
import { authorizedFetch } from "./auth";
import { readLocalState } from "./storage";

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw response;
  return response.json() as Promise<T>;
}

async function deviceId(): Promise<string> {
  const id = (await readLocalState()).deviceId;
  if (!id) throw new Error("UNAUTHORIZED");
  return id;
}

export function register(metadata: {
  deviceName: string;
  browserFamily: "chrome";
  browserVersion: string;
}): Promise<DeviceStatus> {
  return authorizedFetch("/api/cqu/quicklogin/devices", {
    method: "POST",
    body: JSON.stringify(metadata),
  }).then(json<DeviceStatus>);
}

export async function status(input: {
  protocolVersion: 1;
  generation: number;
  appliedVersion: number | null;
  browserVersion: string;
}): Promise<DeviceStatus> {
  const id = await deviceId();
  return authorizedFetch(`/api/cqu/quicklogin/devices/${encodeURIComponent(id)}/status`, {
    method: "POST",
    body: JSON.stringify(input),
  }).then(json<DeviceStatus>);
}

export async function setDeviceEnabled(enabled: boolean): Promise<DeviceStatus> {
  const id = await deviceId();
  return authorizedFetch(`/api/cqu/quicklogin/devices/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  }).then(json<DeviceStatus>);
}

export async function refresh(generation: number): Promise<DeviceStatus> {
  const id = await deviceId();
  return authorizedFetch(`/api/cqu/quicklogin/devices/${encodeURIComponent(id)}/refresh`, {
    method: "POST",
    body: JSON.stringify({ protocolVersion: 1, generation }),
  }).then(json<DeviceStatus>);
}

export async function exportCookies(
  generation: number,
  sessionVersion: number
): Promise<CookieEnvelope> {
  const id = await deviceId();
  return authorizedFetch(`/api/cqu/quicklogin/devices/${encodeURIComponent(id)}/export`, {
    method: "POST",
    body: JSON.stringify({ protocolVersion: 1, generation, sessionVersion }),
  }).then(json<CookieEnvelope>);
}
