import { describe, expect, it } from "vitest";
import {
  caaBlocks,
  diagnose,
  isApex,
  parseHostname,
  publicHref,
  recordsFor,
  routeCustomHost,
} from "./domains";

const targets = { cname: "domains.everyops.app", ipv4: ["34.120.10.20"], ipv6: [] };
const empty = { cname: [], a: [], aaaa: [], caa: [] };

describe("parseHostname", () => {
  it("canonicalises what owners type", () => {
    expect(parseHostname("https://Book.MyResort.com/rooms")).toEqual({ ok: true, host: "book.myresort.com" });
    expect(parseHostname("myresort.com.")).toEqual({ ok: true, host: "myresort.com" });
  });
  it.each([
    ["", /Enter/],
    ["10.0.0.1", /IP address/],
    ["everyops.app", /domain you own/],
    ["x.everyops.app", /domain you own/],
    ["bad_host.com", /valid/],
    ["localhost", /valid/],
  ])("refuses %s", (input, why) => {
    const r = parseHostname(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(why);
  });
});

describe("DNS records and diagnosis", () => {
  it("asks subdomains for a CNAME and apex domains for A records", () => {
    expect(isApex("myresort.com")).toBe(true);
    expect(isApex("myresort.com.ph")).toBe(true);
    expect(isApex("book.myresort.com")).toBe(false);
    expect(
      recordsFor("book.myresort.com", targets, { acme: "abc.authorize.certificatemanager.goog." }).map(
        (r) => r.type,
      ),
    ).toEqual(["CNAME", "CNAME"]);
    expect(recordsFor("myresort.com", targets)[0]).toMatchObject({ type: "A", value: "34.120.10.20" });
  });

  it("explains wrong DNS plainly", () => {
    expect(diagnose("book.myresort.com", empty, targets).state).toBe("waiting");
    expect(diagnose("book.myresort.com", { ...empty, cname: ["domains.everyops.app."] }, targets).state).toBe(
      "ok",
    );
    expect(
      diagnose("book.myresort.com", { ...empty, cname: ["ghs.googlehosted.com."] }, targets).message,
    ).toBe(
      "CNAME points to ghs.googlehosted.com (that's Google Sites / App Engine). Change it to domains.everyops.app.",
    );
    expect(diagnose("book.myresort.com", { ...empty, a: ["1.2.3.4"] }, targets).message).toMatch(
      /Replace it with a CNAME/,
    );
    expect(diagnose("myresort.com", { ...empty, a: ["34.120.10.20", "5.6.7.8"] }, targets).message).toMatch(
      /5\.6\.7\.8/,
    );
    expect(diagnose("myresort.com", { ...empty, a: ["34.120.10.20"] }, targets).state).toBe("ok");
  });

  it("spots CAA records that block Google", () => {
    expect(caaBlocks([{ tag: "issue", value: "digicert.com" }])).toBe(true);
    expect(
      caaBlocks([
        { tag: "issue", value: "digicert.com" },
        { tag: "issue", value: "pki.goog" },
      ]),
    ).toBe(false);
    expect(caaBlocks([{ tag: "iodef", value: "mailto:a@b.c" }])).toBe(false);
    expect(
      diagnose(
        "book.myresort.com",
        { ...empty, cname: ["domains.everyops.app"], caa: [{ tag: "issue", value: "sectigo.com" }] },
        targets,
      ).message,
    ).toMatch(/CAA record .* blocks Google/);
  });

  it("asks for a TXT record when the domain was claimed elsewhere", () => {
    const ok = { ...empty, cname: ["domains.everyops.app"] };
    expect(diagnose("book.myresort.com", ok, targets, "everyops-verify=abc").state).toBe("waiting");
    expect(
      diagnose("book.myresort.com", { ...ok, txt: ["everyops-verify=abc"] }, targets, "everyops-verify=abc")
        .state,
    ).toBe("ok");
  });
});

describe("routeCustomHost", () => {
  const home = { workspaceId: "cebu-smash", target: "home" };
  const book = { workspaceId: "cebu-smash", target: "public_booking_page" };
  it("serves the home or the chosen page at the root, and pages by their id", () => {
    expect(routeCustomHost("/", home)).toEqual({ kind: "rewrite", to: "/s/cebu-smash" });
    expect(routeCustomHost("/", book)).toEqual({ kind: "rewrite", to: "/s/cebu-smash/public_booking_page" });
    expect(routeCustomHost("/rooms", home)).toEqual({ kind: "rewrite", to: "/s/cebu-smash/rooms" });
    expect(routeCustomHost("/rooms/record_1", home)).toEqual({
      kind: "rewrite",
      to: "/s/cebu-smash/rooms/record_1",
    });
  });
  it("cleans up its own /s/ links and never shows anything else", () => {
    expect(routeCustomHost("/s/cebu-smash/rooms", home)).toEqual({ kind: "redirect", to: "/rooms" });
    expect(routeCustomHost("/s/cebu-smash", home)).toEqual({ kind: "redirect", to: "/" });
    expect(routeCustomHost("/s/other-workspace", home)).toEqual({ kind: "notFound" });
    for (const p of ["/w/cebu-smash", "/account", "/api/workspaces", "/sign-in", "/a/b/c", "/developers"])
      expect(routeCustomHost(p, home), p).toEqual({ kind: "notFound" });
  });
  it("hands assets and the public API through", () => {
    expect(routeCustomHost("/_next/static/chunk.js", home)).toEqual({ kind: "pass" });
    expect(routeCustomHost("/api/public/cebu-smash/form/slots", home)).toEqual({ kind: "pass" });
    expect(routeCustomHost("/api/public/booking/token123", home)).toEqual({ kind: "pass" });
  });
  it("refuses public API calls for another workspace", () => {
    expect(routeCustomHost("/api/public/someone-else/form", home)).toEqual({ kind: "notFound" });
  });
  it("writes links for the domain it's on", () => {
    expect(publicHref("cebu-smash", "rooms", true)).toBe("/rooms");
    expect(publicHref("cebu-smash", undefined, true)).toBe("/");
    expect(publicHref("cebu-smash", "rooms", false)).toBe("/s/cebu-smash/rooms");
  });
});
