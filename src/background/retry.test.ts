import { describe, expect, it, vi } from "vitest";
import { retryBounded, SyncError } from "./retry";

describe("bounded retries", () => {
  it("uses the 1s and 3s budgets and stops after three attempts", async () => {
    vi.useFakeTimers();
    const operation = vi.fn().mockRejectedValue(new SyncError("TEMPORARY_UNAVAILABLE"));
    const waiting = vi.fn().mockResolvedValue(undefined);
    const result = retryBounded(operation, waiting);
    const rejected = expect(result).rejects.toMatchObject({
      code: "TEMPORARY_UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(4_000);
    await rejected;
    expect(operation).toHaveBeenCalledTimes(3);
    expect(waiting).toHaveBeenCalledTimes(2);
  });

  it("honors a longer Retry-After value", async () => {
    vi.useFakeTimers();
    const operation = vi.fn()
      .mockRejectedValueOnce(new SyncError("RATE_LIMITED", 5_000))
      .mockResolvedValue("ok");
    const waiting = vi.fn().mockResolvedValue(undefined);
    const result = retryBounded(operation, waiting);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("ok");
  });
});
