import { beforeEach, expect, it, vi } from "vitest";
import { installChromeFake } from "../../../src/test/chrome-fake";
import { handleExternalMessage } from "../../../src/background/external";
import * as auth from "../../../src/background/auth";
import * as sync from "../../../src/background/sync";

beforeEach(() => {
  installChromeFake();
  vi.spyOn(auth, "loginInteractive").mockResolvedValue();
  vi.spyOn(sync, "setEnabled").mockResolvedValue(true);
});

it.each(["/settings", "/settings/cqu"])("accepts a reconnect from Auth's settings entry %s", async path => {
  await expect(handleExternalMessage({ type: "RESUME_DEVICE", deviceId: "device-a",
    resumeTicket: "synthetic-resume-ticket", expiresAt: Date.now() + 300_000 }, {
    url: `https://auth.cqu.moe${path}?quickloginDevice=device-a&quickloginReconnect=1`, frameId: 0,
  })).resolves.toMatchObject({ accepted: true });
  await vi.waitFor(() => expect(sync.setEnabled).toHaveBeenCalledOnce());
});
