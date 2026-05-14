import { describe, expect, it } from "vitest";
import { wrapIpc } from "../wrap-ipc";

describe("wrapIpc", () => {
  it("returns ok:true with data on success", async () => {
    const result = await wrapIpc(async () => [1, 2, 3]);
    expect(result).toEqual({ ok: true, data: [1, 2, 3] });
  });

  it("returns ok:false with error message on throw", async () => {
    const result = await wrapIpc(async () => {
      throw new Error("Something failed");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Something failed");
      expect(result.code).toBe("UNKNOWN");
    }
  });

  it("uses err.code if present", async () => {
    const result = await wrapIpc(async () => {
      const err = new Error("Not found") as NodeJS.ErrnoException;
      err.code = "NOT_FOUND";
      throw err;
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("handles non-Error throws", async () => {
    const result = await wrapIpc(async () => {
      throw "string error";
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
      expect(result.code).toBe("UNKNOWN");
    }
  });
});
