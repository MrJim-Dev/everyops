// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { itemsOf, sitePageItems, siteValues } from "./bindings";
import { frameDocument } from "./html-page";
import type { Cell } from "./resolve";

/**
 * The real bridge script in a DOM, with a parent that answers its calls the way HtmlPageFrame does (through the same
 * itemsOf/siteValues), so the bindings are tested end to end inside the frame.
 */
const cell = (fieldId: string, name: string, kind: Cell["kind"], text: string): Cell => ({
  fieldId,
  name,
  kind,
  text,
});
const menu = (names: [string, string][]) => ({
  ok: true,
  type: "table",
  total: names.length,
  truncated: false,
  items: names.map(([name, price], i) => ({
    id: `dish_${i + 1}`,
    cells: [
      cell("name", "Name", "text", name),
      cell("price", "Price", "text", price),
      cell("mins", "Prep Mins", "number", "15"),
    ],
  })),
});

async function run(body: string, sources: Record<string, unknown>, route = { id: "", query: {} }) {
  document.body.innerHTML = body;
  const script = frameDocument("<p></p>").match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  let listener: (e: { source: unknown; data: unknown }) => void = () => {};
  const frame = {
    addEventListener: (type: string, fn: typeof listener) => {
      if (type === "message") listener = fn;
      else window.addEventListener(type, fn as never);
    },
  } as unknown as Window & { EveryOps: Record<string, (...a: unknown[]) => Promise<unknown>> };
  const site = {
    name: "Kusina ni Lola",
    phone: "0917 555 0101",
    pages: [
      { id: "home", name: "Home" },
      { id: "menu", name: "Menu" },
    ],
  };
  const answer = (m: { method: string; form: string; args: Record<string, string> }) => {
    if (m.method === "site") return { ok: true, site: siteValues(site, "kusina") };
    if (m.method === "route") return { ok: true, page: "menu", ...route };
    if (m.method === "data") return sources[m.form] ?? { ok: false, message: "Missing." };
    if (m.method === "items" && m.form === "site.pages") return sitePageItems(site, "kusina", "menu");
    if (m.method === "items")
      return itemsOf(
        sources[m.form] ?? { ok: false, message: "This data source isn't shared." },
        m.args.block,
      );
    if (m.method === "record") {
      const list = itemsOf(sources[m.form]);
      const item = list.ok && list.items.find((x) => x.id === m.args.id);
      return item ? { ok: true, item } : { ok: false, missing: true, message: "Not found." };
    }
    return { ok: false };
  };
  const parent = {
    postMessage: (m: {
      everyops: string;
      id: number;
      method: string;
      form: string;
      args: Record<string, string>;
    }) =>
      queueMicrotask(() => {
        if (m.everyops === "connect") listener({ source: parent, data: { everyops: "ready" } });
        if (m.everyops === "call")
          listener({ source: parent, data: { everyops: "result", id: m.id, result: answer(m) } });
      }),
  };
  const bound = new Promise((done) => document.addEventListener("everyops:bound", done, { once: true }));
  new Function("window", "parent", script)(frame, parent);
  await bound;
  return frame.EveryOps;
}

const LIST =
  '<ul id="menu"><li data-everyops-state="loading">Loading</li><li data-everyops-state="empty" hidden>None</li><li data-everyops-state="error" hidden></li><template data-everyops-each="dishes" data-everyops-limit="2"><li class="dish"><a data-href="/s/kusina/menu/{@id}"><b data-field="@title"></b></a> <i data-field="price"></i><span data-everyops-if="@about" class="about"></span><dl><template data-everyops-each="@rows"><dt data-field="@name"></dt></template></dl></li></template></ul>';

describe("data bindings in the frame", () => {
  it("repeats a template per row with its values, links and nested details, up to the limit", async () => {
    await run(LIST, {
      dishes: menu([
        ["Adobo", "₱180"],
        ["Sinigang", "₱220"],
        ["Lechon", "₱350"],
      ]),
    });
    const dishes = [...document.querySelectorAll(".dish")];
    expect(dishes.map((d) => d.querySelector("b")?.textContent)).toEqual(["Adobo", "Sinigang"]);
    expect(dishes[0].querySelector("i")?.textContent).toBe("₱180");
    expect(dishes[0].querySelector("a")?.getAttribute("href")).toBe("/s/kusina/menu/dish_1");
    expect(dishes[0].querySelector(".about")).toBeNull();
    expect([...dishes[0].querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Price", "Prep"]);
    expect(document.getElementById("menu")?.getAttribute("data-everyops-status")).toBe("ready");
    expect((document.querySelector('[data-everyops-state="loading"]') as HTMLElement).hidden).toBe(true);
  });

  it("binds markup a page script adds later when it calls EveryOps.bind()", async () => {
    const sources: Record<string, unknown> = { dishes: menu([["Adobo", "₱180"]]) };
    const sdk = await run(LIST.replace('class="dish"', 'class="dish fancy"'), sources);
    sources.dishes = menu([["Kare-kare", "₱260"]]);
    const again = new Promise((done) => document.addEventListener("everyops:bound", done, { once: true }));
    document.querySelector("template")?.removeAttribute("data-everyops-each");
    // A fresh bind of a new template, as a page script adding markup would do.
    document
      .getElementById("menu")
      ?.insertAdjacentHTML(
        "beforeend",
        '<template data-everyops-each="dishes"><li class="dish fancy" data-field="@title"></li></template>',
      );
    await sdk.bind();
    await again;
    const shown = [...document.querySelectorAll(".dish.fancy")].map((d) => d.textContent?.trim());
    expect(shown).toContain("Kare-kare");
  });

  it("shows the empty and error states, and hides a section that has nothing", async () => {
    await run(
      '<section id="s" data-everyops-hide-empty><div><p data-everyops-state="empty" hidden>Nothing yet</p><template data-everyops-each="dishes"><p class="x"></p></template></div></section><div id="e"><p data-everyops-state="error" hidden></p><template data-everyops-each="stock"><p></p></template></div>',
      { dishes: menu([]) },
    );
    expect((document.querySelector('[data-everyops-state="empty"]') as HTMLElement).hidden).toBe(false);
    expect((document.getElementById("s") as HTMLElement).hidden).toBe(true);
    const error = document.querySelector('#e [data-everyops-state="error"]') as HTMLElement;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe("This data source isn't shared.");
  });

  it("fills site values, keeps text when a value is missing, and drops script URLs", async () => {
    await run(
      '<strong data-everyops-text="site.name">Old name</strong><span id="mail" data-everyops-text="site.email">hello@old.test</span><a id="tel" data-everyops-bind data-href="tel:{site.phone}">Call</a><p id="no" data-everyops-if="site.email">Email us</p><template data-everyops-each="site.pages"><a class="page" data-href="{href}" aria-current="{current}" data-field="name"></a></template><template data-everyops-each="dishes"><a class="bad" data-href="{name}">x</a></template>',
      { dishes: menu([["javascript:alert(1)", "₱1"]]) },
    );
    expect(document.querySelector("strong")?.textContent).toBe("Kusina ni Lola");
    expect(document.getElementById("mail")?.textContent).toBe("hello@old.test");
    expect(document.getElementById("tel")?.getAttribute("href")).toBe("tel:0917 555 0101");
    expect(document.getElementById("no")).toBeNull();
    expect(
      [...document.querySelectorAll(".page")].map((a) => [
        a.textContent,
        a.getAttribute("href"),
        a.getAttribute("aria-current"),
      ]),
    ).toEqual([
      ["Home", "/s/kusina", ""],
      ["Menu", "/s/kusina/menu", "true"],
    ]);
    expect(document.querySelector(".bad")?.getAttribute("href")).toBe("#");
  });

  it("writes values as text, never as HTML", async () => {
    await run('<template data-everyops-each="dishes"><p class="t" data-field="@title"></p></template>', {
      dishes: menu([['<img src=x onerror="alert(1)">', "₱1"]]),
    });
    expect(document.querySelector(".t img")).toBeNull();
    expect(document.querySelector(".t")?.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it("fills one record from the page's address, and says when it's missing", async () => {
    await run(
      '<article data-everyops-record="dishes"><p data-everyops-state="empty" hidden>Not found</p><h1 data-field="@title"></h1><p class="p" data-field="price"></p></article>',
      {
        dishes: menu([
          ["Adobo", "₱180"],
          ["Sinigang", "₱220"],
        ]),
      },
      { id: "dish_2", query: {} },
    );
    expect(document.querySelector("h1")?.textContent).toBe("Sinigang");
    expect(document.querySelector(".p")?.textContent).toBe("₱220");
    await run(
      '<article data-everyops-record="dishes"><p data-everyops-state="empty" hidden>Not found</p><h1 data-field="@title"></h1></article>',
      { dishes: menu([["Adobo", "₱180"]]) },
      { id: "dish_9", query: {} },
    );
    expect((document.querySelector('[data-everyops-state="empty"]') as HTMLElement).hidden).toBe(false);
  });
});
