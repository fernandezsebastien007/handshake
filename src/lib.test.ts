// @vitest-environment node
import { describe, expect, it } from "vitest";
import { contactHref, friendlyError, normalizeTags, routeToken } from "./lib";

describe("untrusted input boundaries", () => {
  it("accepts only the exact Handshake route and 256-bit hex token", () => {
    const token = "a".repeat(64);
    expect(routeToken(`#/handshake/${token}`)).toBe(token);
    for (const invalid of [
      `#/handshake/${token}?x=y`,
      "#/handshake/short",
      "#access_token=secret",
      `#/handshake/${"z".repeat(64)}`,
    ])
      expect(routeToken(invalid)).toBeNull();
  });
  it("deduplicates and bounds private tags", () => {
    expect(normalizeTags(" friends, friends, ,work ")).toEqual([
      "friends",
      "work",
    ]);
    expect(
      normalizeTags(Array.from({ length: 25 }, (_, i) => `tag${i}`).join(",")),
    ).toHaveLength(20);
  });
  it("does not create active links from unsafe contact values", () => {
    const contact = {
      id: "1",
      owner_id: "2",
      kind: "link" as const,
      label: "Profile",
      value: "javascript:alert(1)",
      share_default: false,
    };
    expect(contactHref(contact)).toBeUndefined();
    expect(
      contactHref({ ...contact, value: "http://example.com" }),
    ).toBeUndefined();
    expect(contactHref({ ...contact, value: "https://example.com" })).toBe(
      "https://example.com/",
    );
    expect(
      contactHref({ ...contact, kind: "phone", value: "+1 (555) 010-1234" }),
    ).toBe("tel:+15550101234");
    expect(
      contactHref({
        ...contact,
        kind: "email",
        value: "a@example.test\nBcc:x",
      }),
    ).toBeUndefined();
  });
  it("encodes email URI delimiters so stored values cannot add mail headers", () => {
    expect(
      contactHref({
        id: "1",
        owner_id: "2",
        kind: "email",
        label: "Email",
        value: "person?subject=injected@example.test",
        share_default: false,
      }),
    ).toBe("mailto:person%3Fsubject%3Dinjected@example.test");
  });
  it("never prints raw backend errors containing personal data", () => {
    expect(
      friendlyError({ message: "private note: sensitive", code: "XX000" }),
    ).not.toContain("sensitive");
    expect(
      friendlyError({ message: "Only the creator can approve this request." }),
    ).toContain("Only the creator");
  });
});
