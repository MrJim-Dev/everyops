import { describe, expect, it } from "vitest";
import { SITE_TOKEN, withSiteLinks } from "./custom-site";

const html = `<a href="/s/${SITE_TOKEN}">Home</a> <a href="/s/${SITE_TOKEN}/booking_form">Book now</a>
<a href='/s/${SITE_TOKEN}#rooms'>Rooms</a> <div style="background:url(/s/${SITE_TOKEN}/x.png)"></div>`;

describe("withSiteLinks", () => {
  it("points the page's own links at the workspace on EveryOps", () => {
    const out = withSiteLinks(html, "cebu-smash");
    expect(out).toContain('href="/s/cebu-smash"');
    expect(out).toContain('href="/s/cebu-smash/booking_form"');
  });

  it("keeps them on the custom domain, at its root", () => {
    const out = withSiteLinks(html, "cebu-smash", true);
    expect(out).toContain('href="/"');
    expect(out).toContain('href="/booking_form"');
    expect(out).toContain("href='/#rooms'");
    expect(out).toContain("url(/x.png)");
    expect(out).not.toContain("/s/");
  });
});
