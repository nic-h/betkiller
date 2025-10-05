import { describe, expect, it } from "vitest";

import { resolveName, shortAddr } from "@/lib/identity";

describe("identity resolver", () => {
  it("prefers display name", () => {
    expect(resolveName({ displayName: "Alice" }, "0xabc")).toBe("Alice");
  });

  it("falls back to handle with @", () => {
    expect(resolveName({ xHandle: "alice" }, "0xabc")).toBe("@alice");
    expect(resolveName({ xHandle: "@alice" }, "0xabc")).toBe("@alice");
  });

  it("uses address when nothing else available", () => {
    const address = "0x1234567890abcdef";
    expect(resolveName(undefined, address)).toBe(shortAddr(address));
  });

  it("resolves names from profile snapshot", () => {
    expect(resolveName({ displayName: "Creator" }, "0xabc")).toBe("Creator");
    expect(resolveName({ xHandle: "builder" }, "0xabc")).toBe("@builder");
    const address = "0x456789abcdef1234";
    expect(resolveName(undefined, address)).toBe(shortAddr(address));
  });
});
