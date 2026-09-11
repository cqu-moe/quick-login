import { describe, expect, it, vi } from "vitest";
import { installChromeFake } from "../test/chrome-fake";
import { sync } from "./sync";

vi.mock("./sync", () => ({
  setEnvelopeWriter: vi.fn(),
  sync: vi.fn().mockResolvedValue(undefined),
}));

describe("background startup", () => {
  it("synchronizes immediately when the service worker starts", async () => {
    installChromeFake();

    await import("./index");
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("startup"));
  });
});
