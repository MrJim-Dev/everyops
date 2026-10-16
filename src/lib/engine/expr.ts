/**
 * EveryOps's formula language: a tiny, side-effect-free expression interpreter.
 * Blueprints carry short expressions (rates, totals, filters, rule guards);
 * they are parsed into an AST and evaluated against a record. There is no
 * eval, no property access beyond declared fields, and only the functions in
 * FUNCTIONS can be called.
 */
import type { FieldValue, TimeRange } from "@/lib/blueprint/types";
import { isTimeRange } from "@/lib/format";
import { addDays, dateKey, daysBetween, hoursBetween, manilaParts, todayKey } from "@/lib/time";

export type Value = FieldValue;

export type Expr =
  | { kind: "literal"; value: Value }
  | { kind: "ref"; path: string[] }
  | { kind: "call"; name: string; args: Expr[] }
  | { kind: "unary"; op: "!" | "-"; arg: Expr }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { kind: "cond"; test: Expr; then: Expr; otherwise: Expr };

type BinaryOp = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||";

export type ParseResult = { ok: true; ast: Expr; refs: string[] } | { ok: false; error: string };

export type EvalContext = {
  /** Resolves a field reference such as ["rate"] or ["player", "member"]. */
  get: (path: string[]) => Value | undefined;
  now: Date;
};

/* ---------- Tokenizer ---------- */

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

const OPERATORS = [
  "&&",
  "||",
  "==",
  "!=",
  "<=",
  ">=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
  "?",
  ":",
  "(",
  ")",
  ",",
];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i));
      if (!m) throw new Error(`Bad number at ${i}`);
      tokens.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = src.indexOf(ch, i + 1);
      if (end === -1) throw new Error("Unclosed text value");
      tokens.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      // A name, or a path through links: product.price, delivery.supplier.lead_days.
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i));
      if (!m) throw new Error(`Bad name at ${i}`);
      tokens.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`Unexpected "${ch}"`);
    tokens.push({ t: "op", v: op });
    i += op.length;
  }
  return tokens;
}

/* ---------- Parser (recursive descent) ---------- */

const BINARY_LEVELS: BinaryOp[][] = [
  ["||"],
  ["&&"],
  ["==", "!="],
  ["<", "<=", ">", ">="],
  ["+", "-"],
  ["*", "/", "%"],
];

export function parseExpr(src: string): ParseResult {
  try {
    const tokens = tokenize(src);
    let pos = 0;
    const refs = new Set<string>();

    const peek = () => tokens[pos];
    const isOp = (v: string) => {
      const tok = peek();
      return tok?.t === "op" && tok.v === v;
    };
    const expectOp = (v: string) => {
      if (!isOp(v)) throw new Error(`Expected "${v}"`);
      pos++;
    };

    const parseConditional = (): Expr => {
      const test = parseLevel(0);
      if (!isOp("?")) return test;
      pos++;
      const then = parseConditional();
      expectOp(":");
      const otherwise = parseConditional();
      return { kind: "cond", test, then, otherwise };
    };

    const parseLevel = (level: number): Expr => {
      if (level === BINARY_LEVELS.length) return parseUnary();
      let left = parseLevel(level + 1);
      for (;;) {
        const tok = peek();
        if (tok?.t !== "op" || !BINARY_LEVELS[level].includes(tok.v as BinaryOp)) return left;
        pos++;
        const right = parseLevel(level + 1);
        left = { kind: "binary", op: tok.v as BinaryOp, left, right };
      }
    };

    const parseUnary = (): Expr => {
      if (isOp("!") || isOp("-")) {
        const op = (peek() as { v: "!" | "-" }).v;
        pos++;
        return { kind: "unary", op, arg: parseUnary() };
      }
      return parsePrimary();
    };

    const parsePrimary = (): Expr => {
      const tok = peek();
      if (!tok) throw new Error("Unexpected end of formula");
      pos++;
      if (tok.t === "num") return { kind: "literal", value: tok.v };
      if (tok.t === "str") return { kind: "literal", value: tok.v };
      if (tok.t === "op" && tok.v === "(") {
        const inner = parseConditional();
        expectOp(")");
        return inner;
      }
      if (tok.t === "id") {
        if (tok.v === "true" || tok.v === "false") return { kind: "literal", value: tok.v === "true" };
        if (tok.v === "null") return { kind: "literal", value: null };
        if (isOp("(")) {
          pos++;
          if (!(tok.v in FUNCTIONS)) throw new Error(`Unknown function "${tok.v}"`);
          const args: Expr[] = [];
          if (!isOp(")")) {
            args.push(parseConditional());
            while (isOp(",")) {
              pos++;
              args.push(parseConditional());
            }
          }
          expectOp(")");
          return { kind: "call", name: tok.v, args };
        }
        refs.add(tok.v);
        return { kind: "ref", path: tok.v.split(".") };
      }
      throw new Error(`Unexpected "${tok.v}"`);
    };

    const ast = parseConditional();
    if (pos !== tokens.length) throw new Error(`Unexpected "${String(tokens[pos].v)}"`);
    return { ok: true, ast, refs: [...refs] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/* ---------- Evaluation ---------- */

const toNumber = (v: Value | undefined): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return 0;
};

const isNil = (v: Value | undefined) => v === null || v === undefined;

const truthy = (v: Value | undefined): boolean => (Array.isArray(v) ? v.length > 0 : Boolean(v));

const startOf = (v: Value | undefined): string | null => {
  if (isTimeRange(v ?? null)) return (v as TimeRange).start;
  return typeof v === "string" ? v : null;
};

type Fn = (args: (Value | undefined)[], ctx: EvalContext) => Value;

export const FUNCTIONS: Record<string, Fn> = {
  hour: ([v]) => {
    const s = startOf(v);
    return s ? manilaParts(s).hour : null;
  },
  weekday: ([v]) => {
    const s = startOf(v);
    return s ? manilaParts(s).weekday : null;
  },
  duration_hours: ([v]) =>
    isTimeRange(v ?? null) ? hoursBetween((v as TimeRange).start, (v as TimeRange).end) : 0,
  days: ([v]) =>
    isTimeRange(v ?? null)
      ? daysBetween(dateKey((v as TimeRange).start), dateKey((v as TimeRange).end)) + 1
      : 0,
  is_today: ([v], ctx) => {
    const s = startOf(v);
    return s ? dateKey(s) === todayKey(ctx.now) : false;
  },
  /** on_or_after(slot, '2026-10-20'): the record's date (Manila) is that day or later. Prices that change from a date. */
  on_or_after: ([v, day]) => {
    const s = startOf(v);
    return s && typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) ? dateKey(s) >= day : false;
  },
  is_this_month: ([v], ctx) => {
    const s = startOf(v);
    return s ? dateKey(s).slice(0, 7) === todayKey(ctx.now).slice(0, 7) : false;
  },
  /** is_this_week(date): the record's date (Manila) is in this Monday-to-Sunday week, as the weekly charts count it. */
  is_this_week: ([v], ctx) => {
    const s = startOf(v);
    if (!s) return false;
    const monday = addDays(todayKey(ctx.now), -((manilaParts(ctx.now).weekday + 6) % 7));
    const day = dateKey(s);
    return day >= monday && day <= addDays(monday, 6);
  },
  is_upcoming: ([v], ctx) => {
    const s = startOf(v);
    if (!s) return false;
    return s.length === 10 ? s >= todayKey(ctx.now) : Date.parse(s) >= ctx.now.getTime();
  },
  round: ([v, digits]) => {
    const f = 10 ** toNumber(digits);
    return Math.round(toNumber(v) * f) / f;
  },
  min: (args) => Math.min(...args.map(toNumber)),
  max: (args) => Math.max(...args.map(toNumber)),
  abs: ([v]) => Math.abs(toNumber(v)),
  contains: ([list, item]) =>
    Array.isArray(list)
      ? list.includes(String(item))
      : typeof list === "string" && list.toLowerCase().includes(String(item).toLowerCase()),
};

export function evaluate(ast: Expr, ctx: EvalContext): Value {
  switch (ast.kind) {
    case "literal":
      return ast.value;
    case "ref":
      return ctx.get(ast.path) ?? null;
    case "call":
      return FUNCTIONS[ast.name](
        ast.args.map((a) => evaluate(a, ctx)),
        ctx,
      );
    case "unary": {
      const v = evaluate(ast.arg, ctx);
      return ast.op === "!" ? !truthy(v) : -toNumber(v);
    }
    case "cond":
      return truthy(evaluate(ast.test, ctx)) ? evaluate(ast.then, ctx) : evaluate(ast.otherwise, ctx);
    case "binary": {
      if (ast.op === "&&") return truthy(evaluate(ast.left, ctx)) && truthy(evaluate(ast.right, ctx));
      if (ast.op === "||") return truthy(evaluate(ast.left, ctx)) || truthy(evaluate(ast.right, ctx));
      const l = evaluate(ast.left, ctx);
      const r = evaluate(ast.right, ctx);
      switch (ast.op) {
        case "==":
          return l === r || (isNil(l) && isNil(r));
        case "!=":
          return !(l === r || (isNil(l) && isNil(r)));
        case "<":
          return toNumber(l) < toNumber(r);
        case "<=":
          return toNumber(l) <= toNumber(r);
        case ">":
          return toNumber(l) > toNumber(r);
        case ">=":
          return toNumber(l) >= toNumber(r);
        case "+":
          return typeof l === "string" || typeof r === "string"
            ? `${l ?? ""}${r ?? ""}`
            : toNumber(l) + toNumber(r);
        case "-":
          return toNumber(l) - toNumber(r);
        case "*":
          return toNumber(l) * toNumber(r);
        case "/":
          return toNumber(r) === 0 ? null : toNumber(l) / toNumber(r);
        case "%":
          return toNumber(r) === 0 ? null : toNumber(l) % toNumber(r);
      }
    }
  }
}

const cache = new Map<string, ParseResult>();

/** Parse once, evaluate many times. Invalid expressions evaluate to null. */
export function run(src: string, ctx: EvalContext): Value {
  let parsed = cache.get(src);
  if (!parsed) {
    parsed = parseExpr(src);
    cache.set(src, parsed);
  }
  return parsed.ok ? evaluate(parsed.ast, ctx) : null;
}

export { truthy };
