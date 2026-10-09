import { beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { snapshot, readySnapshot, response, receipt } from "../test/protocol-fixtures";
import { initialLocalState, LOCAL_STATE_KEY, readLocalState, updateLocalState } from "./storage";
import * as api from "./api-v3";

beforeEach(async () => {
  installChromeFake();
  vi.stubGlobal("fetch", vi.fn());
  await chrome.storage.local.set({
    [LOCAL_STATE_KEY]: { ...initialLocalState(), deviceId: "device-a" },
    "quicklogin.tokens": { accessToken: "synthetic", refreshToken: "synthetic", expiresAt: Date.now() + 300_000 },
  });
});

it("uses v3 reconcile and validates its response at the network boundary", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json(response({ snapshot: snapshot(), receiptAck: null })));
  const result = await api.reconcile();
  expect(result.snapshot.identity.deviceId).toBe("device-a");
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/devices/device-a/reconcile");
  const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
  expect(request).toMatchObject({ protocolVersion: 3, observed: null, local: { receipt: null } });
});

it("rejects malformed successful payloads instead of storing them as status", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json(response({ snapshot: { state: "ready" }, receiptAck: null })));
  await expect(api.reconcile()).rejects.toMatchObject({ code: "CONTRACT_INVALID" });
});

it("preserves the typed recovery time from an API problem", async () => {
  const retryAt = Date.now() + 60_000;
  vi.mocked(fetch).mockResolvedValue(Response.json({
    type: "about:blank", title: "Wait", status: 429, detail: "Wait", code: "RATE_LIMITED",
    requestId: "request-a", retryAt, action: "reconcile",
  }, { status: 429 }));
  await expect(api.reconcile()).rejects.toMatchObject({ code: "RATE_LIMITED", retryAt });
});

it("rejects an unrelated receipt acknowledgement at the network boundary",async()=>{
  vi.mocked(fetch).mockResolvedValue(Response.json(response({accepted:true,exportId:"wrong-export",
    acceptedTuple:receipt(),reportEpoch:"wrong-report",clientReportSeq:999,receivedAt:Date.now(),reasonCode:null,snapshot:snapshot()})));
  await expect(api.acknowledge(receipt())).rejects.toMatchObject({code:"CONTRACT_INVALID"});
});

it("does not commit epoch recovery over a concurrent disable", async () => {
  const remote = readySnapshot();
  await updateLocalState(state => ({ ...state, installationId: "installation-a", snapshot: remote,
    reportEpoch: "local-epoch", enabledIntent: true }));
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ type: "about:blank", title: "INVALID_REQUEST",
    status: 422, detail: "INVALID_REQUEST", code: "INVALID_REQUEST", requestId: "request-a",
    retryAt: null, action: "reconcile" }, { status: 422 }));
  vi.mocked(fetch).mockImplementationOnce(async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    await updateLocalState(state => ({ ...state, enabledIntent: false, localGeneration: state.localGeneration + 1 }));
    return Response.json(response({ snapshot: { ...remote, reportedLocal: { ...remote.reportedLocal!,
      reportEpoch: request.reportEpoch, clientReportSeq: request.clientReportSeq } }, receiptAck: null }));
  });
  await expect(api.reconcile()).rejects.toMatchObject({ code: "OPERATION_CANCELLED" });
  expect(await readLocalState()).toMatchObject({ enabledIntent: false, reportEpoch: "local-epoch" });
});
