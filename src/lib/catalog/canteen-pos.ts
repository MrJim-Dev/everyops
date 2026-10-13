import type { Blueprint, DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import { computeAll } from "@/lib/engine/compute";
import { addDays, at, hhmm, todayKey } from "@/lib/time";
import { f, recordFactory, seeded } from "./define";

export function posBlueprint(workspaceName = "Canteen POS"): Blueprint {
  return {
    version: 1,
    workspaceName,
    systems: [
      { id: "register", name: "Register", icon: "storefront", viewIds: ["checkout"], widgetIds: [] },
      { id: "orders", name: "Orders", icon: "receipt", viewIds: ["order_table"], widgetIds: [] },
      { id: "products", name: "Products", icon: "package", viewIds: ["product_table"], widgetIds: [] },
      {
        id: "overview",
        name: "Overview",
        icon: "gauge",
        viewIds: [],
        widgetIds: ["sales_today", "orders_today", "avg_order", "sales_month", "low_stock"],
      },
    ],
    entities: [
      {
        id: "product",
        name: "Product",
        pluralName: "Products",
        primaryFieldId: "name",
        fields: [
          f.text("name", "Name", { required: true }),
          f.select(
            "category",
            "Category",
            [
              ["meals", "Meals"],
              ["snacks", "Snacks"],
              ["drinks", "Drinks"],
            ],
            { required: true },
          ),
          f.money("price", "Price", { required: true }),
          f.number("stock", "Stock", { required: true }),
          f.formula("low_stock", "Low stock", "stock <= 5", "checkbox"),
        ],
      },
      {
        id: "order",
        name: "Order",
        pluralName: "Orders",
        primaryFieldId: "code",
        fields: [
          f.text("code", "Order", { required: true }),
          f.datetime("placed_at", "Time", { required: true }),
          f.select(
            "payment",
            "Payment",
            [
              ["cash", "Cash"],
              ["gcash", "GCash"],
              ["maya", "Maya"],
            ],
            { required: true },
          ),
          f.status(
            "status",
            "Status",
            [
              ["completed", "Completed", "success"],
              ["held", "Held", "warning"],
            ],
            { required: true },
          ),
          f.rollup("items", "Items", {
            childEntityId: "order_line",
            viaFieldId: "order",
            op: "sum",
            fieldId: "qty",
          }),
          f.rollup("total", "Total", {
            childEntityId: "order_line",
            viaFieldId: "order",
            op: "sum",
            fieldId: "line_total",
          }),
          f.money("cash_received", "Cash received"),
          f.formula(
            "change_due",
            "Change",
            "payment == 'cash' && cash_received > 0 ? cash_received - total : 0",
            "money",
          ),
        ],
      },
      {
        id: "order_line",
        name: "Order line",
        pluralName: "Order lines",
        primaryFieldId: "product_name",
        parent: { entityId: "order", fieldId: "order" },
        fields: [
          f.relation("order", "Order", "order", { required: true }),
          f.relation("product", "Product", "product", { required: true }),
          f.formula("product_name", "Item", "product.name", "text"),
          f.number("qty", "Qty", { required: true }),
          f.money("price", "Price", { required: true }),
          f.formula("line_total", "Line total", "qty * price", "money"),
        ],
      },
    ],
    views: [
      {
        id: "checkout",
        entityId: "order",
        name: "Checkout",
        type: "checkout",
        productEntityId: "product",
        lineEntityId: "order_line",
        paymentFieldId: "payment",
      },
      {
        id: "order_table",
        entityId: "order",
        name: "Today",
        type: "table",
        fieldIds: ["code", "placed_at", "items", "payment", "status", "total"],
        filter: "is_today(placed_at)",
        sort: [{ fieldId: "placed_at", dir: "desc" }],
      },
      {
        id: "product_table",
        entityId: "product",
        name: "All products",
        type: "table",
        fieldIds: ["name", "category", "price", "stock", "low_stock"],
      },
    ],
    widgets: [
      {
        id: "sales_today",
        title: "Sales today",
        entityId: "order",
        type: "stat",
        filter: "is_today(placed_at) && status == 'completed'",
        metric: { op: "sum", fieldId: "total" },
      },
      {
        id: "orders_today",
        title: "Orders today",
        entityId: "order",
        type: "stat",
        filter: "is_today(placed_at) && status == 'completed'",
        metric: { op: "count" },
      },
      {
        id: "avg_order",
        title: "Average order",
        entityId: "order",
        type: "stat",
        filter: "is_today(placed_at) && status == 'completed'",
        metric: { op: "avg", fieldId: "total" },
      },
      {
        id: "sales_month",
        title: "Sales this month",
        entityId: "order",
        type: "chart",
        filter: "status == 'completed'",
        metric: { op: "sum", fieldId: "total" },
        chart: { kind: "bar", dateFieldId: "placed_at", bucket: "day" },
      },
      {
        id: "low_stock",
        title: "Running low",
        entityId: "product",
        type: "list",
        filter: "low_stock",
        metric: { op: "count" },
        list: { fieldIds: ["stock", "price"], limit: 5, viewId: "product_table" },
      },
    ],
    rules: [
      {
        id: "deduct_stock",
        name: "Deduct stock on sale",
        trigger: { entityId: "order_line", event: "created" },
        actions: [
          {
            type: "adjust_number",
            target: { kind: "relation", fieldId: "product" },
            fieldId: "stock",
            delta: "-qty",
          },
        ],
      },
    ],
  };
}

const MENU: [string, string, number, number][] = [
  ["Chicken adobo rice", "meals", 85, 28],
  ["Pork sinigang rice", "meals", 95, 18],
  ["Pancit canton", "meals", 60, 16],
  ["Lumpiang shanghai", "snacks", 15, 51],
  ["Turon", "snacks", 20, 4],
  ["Banana cue", "snacks", 20, 24],
  ["Ginataang bilo-bilo", "snacks", 35, 12],
  ["Puto", "snacks", 10, 3],
  ["Iced tea", "drinks", 25, 32],
  ["Buko juice", "drinks", 35, 14],
  ["Sago't gulaman", "drinks", 30, 20],
  ["Bottled water", "drinks", 15, 40],
];

export function posSample(now: Date, workspaceName?: string): WorkspaceData {
  const blueprint = posBlueprint(workspaceName);
  const rec = recordFactory(now);
  const rng = seeded(2207);
  const today = todayKey(now);
  const products = MENU.map(([name, category, price, stock], i) =>
    rec("product", `product_${i + 1}`, { name, category, price, stock }),
  );
  const records: DataRecord[] = [...products];
  let code = 1000;
  let line = 0;
  const days = Number(today.slice(8));
  for (let back = days - 1; back >= 0; back--) {
    const day = addDays(today, -back);
    const count = back === 0 ? 9 : rng.int(14, 26);
    for (let i = 0; i < count; i++) {
      code++;
      const id = `order_${code}`;
      const minutes = rng.int(7 * 60, back === 0 ? 11 * 60 : 18 * 60);
      records.push(
        rec("order", id, {
          code: `#${code}`,
          placed_at: at(day, hhmm(minutes)),
          payment: rng.pick(["cash", "cash", "gcash", "maya"]),
          status: "completed",
        }),
      );
      const items = rng.int(1, 3);
      for (let k = 0; k < items; k++) {
        const product = rng.pick(products);
        records.push(
          rec("order_line", `line_${++line}`, {
            order: id,
            product: product.id,
            qty: rng.int(1, 2),
            price: product.data.price,
          }),
        );
      }
    }
  }
  return { blueprint, records: computeAll(blueprint, records, now) };
}
