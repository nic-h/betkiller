import { describe, expect, it } from "vitest";

import { resolveIdentity, shortenAddress } from "@/lib/identity";

describe("identity resolver", () => {
  it("prefers display name", () => {
    expect(resolveIdentity({ address: "0xabc", displayName: "Alice" })).toBe("Alice");
  });

  it("falls back to handle with @", () => {
    expect(resolveIdentity({ address: "0xabc", xHandle: "alice" })).toBe("@alice");
    expect(resolveIdentity({ address: "0xabc", xHandle: "@alice" })).toBe("@alice");
  });

  it("uses address when nothing else available", () => {
    const address = "0x1234567890abcdef";
    expect(resolveIdentity({ address })).toBe(shortenAddress(address));
  });
});
