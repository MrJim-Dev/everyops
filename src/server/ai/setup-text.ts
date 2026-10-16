import type { AskQuestion, SetupQuestion } from "@/lib/store/workspace-model";

/**
 * The interview may name the community system it built on by id ("built on our canteen-pos system"). Owners know
 * those systems by name, so ids are swapped for names before a reply is shown.
 */
export function withSystemNames(text: string, systems: { id: string; name: string }[]): string {
  let out = text;
  for (const s of systems) {
    const id = s.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${id}\\b`, "gi"), s.name);
  }
  return out;
}

/** A reply that announces questions ("I have 3 quick questions:") but stops before asking them. */
export function questionsMissing(message: string): boolean {
  return /:\s*$/.test(message.trim()) && !/\?/.test(message);
}

const keyOf = (q: { id: string }) => q.id.trim().toLowerCase();

/**
 * This turn's checklist on top of the last one. Gemini rewrites the list every turn and now and then drops a
 * question or forgets an answer it already had: a question it left out comes back, an answer it blanked keeps the
 * owner's earlier one, and a question once required stays required until it's answered.
 */
export function mergeQuestions(previous: SetupQuestion[], next: SetupQuestion[]): SetupQuestion[] {
  const before = new Map(previous.map((q) => [keyOf(q), q]));
  const seen = new Set<string>();
  const merged: SetupQuestion[] = [];
  for (const q of next) {
    const key = keyOf(q);
    if (!key || seen.has(key) || !q.question.trim()) continue;
    seen.add(key);
    const old = before.get(key);
    merged.push({
      id: q.id.trim(),
      question: q.question.trim(),
      required: q.required || (!!old?.required && !old.answer.trim()),
      answer: q.answer.trim() || old?.answer.trim() || "",
      ...(q.options?.length ? { options: q.options } : old?.options?.length ? { options: old.options } : {}),
      ...(q.neutral || old?.neutral ? { neutral: true } : {}),
    });
  }
  // Kept in their old place among the rest would reorder the list the owner sees; they go at the end instead.
  for (const q of previous) if (!seen.has(keyOf(q))) merged.push(q);
  return merged.slice(0, 24);
}

/** Required questions the owner hasn't answered yet. */
export function openRequired(questions: SetupQuestion[]): SetupQuestion[] {
  return questions.filter((q) => q.required && !q.answer.trim());
}

/** A reply for when Gemini wanted to design without required answers: the questions follow on cards. */
export function askAgainMessage(open: SetupQuestion[]): string {
  return `Almost there. I still need ${open.length === 1 ? "one answer" : "a few answers"} before I build it, so the workspace uses your real details. ${open.length === 1 ? "It's" : "They're"} below.`;
}

/**
 * The cards to show this turn: the questions Gemini asked, then any required one still unanswered that it moved on
 * from (required questions are asked until answered), at most four, required first.
 */
export function askList(questions: SetupQuestion[], askedIds: string[]): AskQuestion[] {
  const key = (id: string) => id.trim().toLowerCase();
  const asked = new Set(askedIds.map(key));
  const open = questions.filter((q) => !q.answer.trim());
  const picked = [
    ...open.filter((q) => asked.has(key(q.id))),
    ...open.filter((q) => q.required && !asked.has(key(q.id))),
  ];
  return picked
    .sort((a, b) => Number(b.required) - Number(a.required))
    .slice(0, 4)
    .map((q) => ({
      id: q.id,
      question: q.question,
      required: q.required,
      options: q.options ?? [],
      ...(q.neutral ? { neutral: true } : {}),
    }));
}

/**
 * What an ERP must know before it's built, each with the words that show Gemini already asked it its own way. Left
 * to Gemini, "I need an ERP" twice got two different checklists (one asked about payroll, the other about
 * warehouses), and a bakery's recommended "finished goods only" quietly dropped its ingredients and production.
 */
const ERP_TOPICS: { id: string; question: string; options: string[]; required: boolean; topic: RegExp }[] = [
  {
    id: "erp_kind",
    question: "What does the business mainly do?",
    options: ["Make products from materials", "Buy and resell products", "Provide services"],
    required: true,
    topic:
      /resell|trading|distribut|manufactur|kind of business|type of business|business model|what (does|do) (the|your) business/i,
  },
  {
    id: "erp_stock",
    question: "What do you keep in stock?",
    options: ["Raw materials and finished goods", "Finished goods only", "Raw materials only"],
    required: true,
    topic: /raw materials?|finished goods|keep in stock|track (your )?(stock|inventory)|what .*stock/i,
  },
  {
    id: "erp_purchasing",
    question: "Do you buy supplies or stock from suppliers?",
    options: ["Yes, with purchase orders", "Yes, without formal orders", "No, we don't buy from suppliers"],
    required: true,
    topic: /suppliers?|purchase orders?|purchasing/i,
  },
  {
    id: "erp_production",
    question: "Do you make your products in-house?",
    options: [
      "Yes, from a recipe or bill of materials",
      "Yes, each one made to order",
      "No, we don't make products",
    ],
    required: true,
    topic: /in-?house|bill of materials|\bbom\b|recipes?|production|make (your|the|these|our) products/i,
  },
  {
    id: "erp_payment_terms",
    question: "How do customers pay for their orders?",
    options: ["Deposit first, balance on delivery", "Full payment upfront", "On credit, paid within 30 days"],
    required: true,
    topic: /deposit|down ?payment|payment terms|\bterms\b|on credit|upfront|balance/i,
  },
  {
    id: "erp_locations",
    question: "How many branches or warehouses do you have?",
    options: ["One location", "2 or 3 locations", "4 or more"],
    required: false,
    topic: /branch|warehouse|locations?/i,
  },
];

const TRADES = /resell|trading|wholesale|distribut|retail|servic/i;
// Whole words: "buy and resell products" isn't production.
const MAKES =
  /\bmak(e|es|ing|ers?)\b|manufactur|\bproduc(e|es|ing|tion)\b|fabricat|\bbak(e|es|ing|ery|eries|ers?)\b|\bcook|\bsew|\bprint|assembl/i;
/** Answers that leave part of an ERP out: "finished goods only", "no, we don't make products". */
const DROPS = /\bonly\b|^no\b|\bnone\b|don'?t|do not|\bnot\b|without|\bskip\b/i;

/** The options with one that keeps the part first, so a click-through never builds less than an ERP. */
export function keepPartsFirst(options: string[]): string[] {
  if (!options.length || !DROPS.test(options[0])) return options;
  const keep = options.findIndex((o) => !DROPS.test(o));
  return keep > 0 ? [options[keep], ...options.filter((_, i) => i !== keep)] : options;
}

/**
 * An ERP's checklist: every topic in ERP_TOPICS asked once (Gemini's own question when it asked it, else ours),
 * required ones held open until answered. described is what the owner said the business is (their words and the
 * business playbooks they matched), or "" when they haven't: then what the business does is asked first (kindFirst),
 * alone and with nothing recommended, before the rest depend on it. A maker's recommended answers keep stock,
 * purchasing and production in; a business that buys and resells or sells services isn't asked to make anything;
 * for anything else the stock and production questions recommend nothing.
 */
export function erpChecklist(
  questions: SetupQuestion[],
  described = "",
): { questions: SetupQuestion[]; kindFirst?: string } {
  const claimed = new Set<string>();
  const found = new Map<string, string>();
  for (const t of ERP_TOPICS) {
    const q = questions.find(
      (x) =>
        !claimed.has(x.id) && (x.id === t.id || t.topic.test(`${x.question} ${(x.options ?? []).join(" ")}`)),
    );
    if (q) {
      claimed.add(q.id);
      found.set(t.id, q.id);
    }
  }
  const kindQuestion = questions.find((q) => q.id === found.get("erp_kind"));
  const kind = kindQuestion?.answer.trim() || described;
  const makes = MAKES.test(kind);
  const trades = !makes && TRADES.test(kind);
  const keeps = new Set(
    [makes ? ["erp_stock", "erp_production"] : [], ["erp_purchasing"]].flat().map((t) => found.get(t)),
  );
  const out: SetupQuestion[] = questions.map((q) => {
    if (q.id === kindQuestion?.id && !q.answer.trim()) return { ...q, required: true, neutral: true };
    if (keeps.has(q.id) && !q.answer.trim() && q.options?.length)
      return { ...q, options: keepPartsFirst(q.options) };
    return q;
  });
  for (const t of ERP_TOPICS) {
    // A business the owner already described isn't asked what it does.
    if (found.has(t.id) || (t.id === "erp_kind" && described)) continue;
    const notMade = t.id === "erp_production" && trades;
    out.push({
      id: t.id,
      question: t.question,
      required: t.required && !notMade,
      answer: notMade ? "No, the business buys and resells or provides services" : "",
      options: t.options,
      // What the business does is the owner's to say; stock and production are only clear for a maker.
      ...(t.id === "erp_kind" || (!makes && (t.id === "erp_stock" || t.id === "erp_production"))
        ? { neutral: true }
        : {}),
    });
  }
  const kindId = described ? undefined : (kindQuestion?.id ?? "erp_kind");
  const open = kindId ? out.find((q) => q.id === kindId && !q.answer.trim()) : undefined;
  return { questions: out, ...(open ? { kindFirst: open.id } : {}) };
}
