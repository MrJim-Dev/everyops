import type { Blueprint, DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import { computeAll } from "@/lib/engine/compute";
import { addDays, todayKey } from "@/lib/time";
import { f, recordFactory, seeded } from "./define";

export function financesBlueprint(workspaceName = "Small business finances"): Blueprint {
  return {
    version: 1,
    workspaceName,
    systems: [
      {
        id: "overview",
        name: "Overview",
        icon: "gauge",
        viewIds: [],
        widgetIds: ["revenue", "expenses", "net", "cashflow", "budget", "recent"],
      },
      {
        id: "transactions",
        name: "Transactions",
        icon: "receipt",
        viewIds: ["transaction_table"],
        widgetIds: [],
      },
      { id: "budget", name: "Budget", icon: "wallet", viewIds: ["budget_table"], widgetIds: [] },
    ],
    entities: [
      {
        id: "transaction",
        name: "Transaction",
        pluralName: "Transactions",
        primaryFieldId: "description",
        fields: [
          f.text("description", "Description", { required: true }),
          f.date("date", "Date", { required: true }),
          f.select(
            "type",
            "Type",
            [
              ["income", "Income", "success"],
              ["expense", "Expense", "neutral"],
            ],
            { required: true },
          ),
          f.relation("category", "Budget category", "budget_category"),
          f.select("account", "Account", [
            ["bdo", "BDO"],
            ["gcash", "GCash"],
            ["cash", "Cash"],
          ]),
          f.money("amount", "Amount", { required: true }),
          f.formula("signed", "Net effect", "type == 'income' ? amount : -amount", "money"),
        ],
      },
      {
        id: "budget_category",
        name: "Budget category",
        pluralName: "Budget categories",
        primaryFieldId: "name",
        fields: [
          f.text("name", "Category", { required: true }),
          f.money("budget", "Monthly budget", { required: true }),
          f.rollup("spent", "Spent", {
            childEntityId: "transaction",
            viaFieldId: "category",
            op: "sum",
            fieldId: "amount",
          }),
          f.formula("used", "Used", "budget > 0 ? round(spent / budget * 100, 1) : 0", "number"),
        ],
      },
    ],
    views: [
      {
        id: "transaction_table",
        entityId: "transaction",
        name: "All transactions",
        type: "table",
        fieldIds: ["date", "description", "type", "category", "account", "signed"],
        sort: [{ fieldId: "date", dir: "desc" }],
      },
      {
        id: "budget_table",
        entityId: "budget_category",
        name: "This month",
        type: "table",
        fieldIds: ["name", "budget", "spent", "used"],
      },
    ],
    widgets: [
      {
        id: "revenue",
        title: "Revenue",
        entityId: "transaction",
        type: "stat",
        filter: "type == 'income' && is_this_month(date)",
        metric: { op: "sum", fieldId: "amount" },
      },
      {
        id: "expenses",
        title: "Expenses",
        entityId: "transaction",
        type: "stat",
        filter: "type == 'expense' && is_this_month(date)",
        metric: { op: "sum", fieldId: "amount" },
      },
      {
        id: "net",
        title: "Net income",
        entityId: "transaction",
        type: "stat",
        filter: "is_this_month(date)",
        metric: { op: "sum", fieldId: "signed" },
      },
      {
        id: "cashflow",
        title: "Revenue & expenses",
        entityId: "transaction",
        type: "chart",
        metric: { op: "sum", fieldId: "amount" },
        chart: { kind: "line", dateFieldId: "date", bucket: "day", splitByFieldId: "type" },
      },
      {
        id: "budget",
        title: "Monthly budget",
        entityId: "transaction",
        type: "progress",
        filter: "type == 'expense' && is_this_month(date)",
        metric: { op: "sum", fieldId: "amount" },
        target: 140000,
      },
      {
        id: "recent",
        title: "Recent transactions",
        entityId: "transaction",
        type: "list",
        span: "main",
        metric: { op: "count" },
        list: {
          fieldIds: ["date", "account", "signed"],
          limit: 5,
          viewId: "transaction_table",
          sort: [{ fieldId: "date", dir: "desc" }],
        },
      },
    ],
    rules: [],
  };
}

export function financesSample(now: Date, workspaceName?: string): WorkspaceData {
  const blueprint = financesBlueprint(workspaceName);
  const rec = recordFactory(now);
  const rng = seeded(9031);
  const today = todayKey(now);
  const categories = [
    ["ingredients", "Ingredients", 40000],
    ["salaries", "Salaries", 40000],
    ["rent", "Rent & facilities", 20000],
    ["utilities", "Utilities", 15000],
    ["marketing", "Marketing", 25000],
  ].map(([id, name, budget]) => rec("budget_category", `cat_${id}`, { name, budget }));
  const records: DataRecord[] = [...categories];
  let n = 0;
  const tx = (
    date: string,
    description: string,
    type: string,
    amount: number,
    account: string,
    category?: string,
  ) =>
    records.push(
      rec("transaction", `tx_${++n}`, {
        description,
        date,
        type,
        amount,
        account,
        category: category ? `cat_${category}` : null,
      }),
    );

  const days = Number(today.slice(8));
  const monthStart = addDays(today, -(days - 1));
  for (let i = 0; i < days; i++) {
    const date = addDays(monthStart, i);
    tx(
      date,
      rng.pick(["Walk-in sales", "Counter sales", "Daily sales"]),
      "income",
      rng.int(3800, 7600),
      rng.pick(["cash", "gcash"]),
    );
    if (rng.chance(0.35))
      tx(
        date,
        rng.pick(["Custom cake order", "Bulk pastry order", "Ensaymada bulk order"]),
        "income",
        rng.int(4500, 12500),
        rng.pick(["bdo", "gcash"]),
      );
    if (rng.chance(0.4))
      tx(
        date,
        rng.pick(["Flour 25kg", "Butter and eggs", "Sugar and cocoa"]),
        "expense",
        rng.int(1800, 5200),
        "cash",
        "ingredients",
      );
  }
  tx(addDays(monthStart, 0), "Rent — Mabolo branch", "expense", 18000, "bdo", "rent");
  tx(addDays(monthStart, Math.min(14, days - 1)), "Payroll, first half", "expense", 16000, "bdo", "salaries");
  tx(addDays(monthStart, Math.min(4, days - 1)), "VECO electricity", "expense", 5855, "gcash", "utilities");
  tx(addDays(monthStart, Math.min(9, days - 1)), "Facebook ads", "expense", 3500, "gcash", "marketing");

  return { blueprint, records: computeAll(blueprint, records, now) };
}
