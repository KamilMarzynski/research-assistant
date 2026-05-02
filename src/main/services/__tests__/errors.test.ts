import { describe, expect, it } from "vitest";
import { NotFoundError, NotImplementedError } from "../errors";

describe("NotFoundError", () => {
  it("sets message and name", () => {
    const err = new NotFoundError("Project", "123");
    expect(err.message).toBe('Project with id "123" not found');
    expect(err.name).toBe("NotFoundError");
  });
});

describe("NotImplementedError", () => {
  it("sets message and name", () => {
    const err = new NotImplementedError("foo", "Run 8");
    expect(err.message).toBe("foo is not implemented yet — available in Run 8");
    expect(err.name).toBe("NotImplementedError");
  });
});
