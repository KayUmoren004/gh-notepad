import { describe, expect, it } from "vitest";
import { isShareId, newShareId } from ".";

describe("share ids", () => {
  it("are 22 characters of the URL-safe alphabet: 16 random bytes, 128 bits", () => {
    for (let i = 0; i < 100; i++) {
      const id = newShareId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(isShareId(id)).toBe(true);
    }
  });

  it("never repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, newShareId));
    expect(ids.size).toBe(1000);
  });

  it("recognise only their own shape, so a route can refuse anything else before looking it up", () => {
    expect(isShareId("")).toBe(false);
    expect(isShareId("short")).toBe(false);
    expect(isShareId("Qm9vGhIjKlMnOpQrStUvWx=")).toBe(false);
    expect(isShareId("Qm9vGhIjKlMnOpQrStUv/x")).toBe(false);
    expect(isShareId("../../etc/passwd...........")).toBe(false);
  });
});
