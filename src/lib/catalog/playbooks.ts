import { BUSINESS_PLAYBOOKS } from "./playbooks-business";
import { SYSTEM_PLAYBOOKS } from "./playbooks-systems";

/**
 * What kinds of businesses usually need, and what common systems (POS, HRIS, CRM, projects…) are made of, so setup
 * can think ahead instead of only asking. Each playbook names the record types, statuses, screens and public pages
 * such a business or system runs on, and the few questions that change the build. The interview proposes from these;
 * the designer builds from them. Written for the model: plain and specific.
 */
export type Playbook = {
  id: string;
  /** business: a kind of business (salon, resort). system: something any business may run (POS, HRIS, CRM). */
  kind: "business" | "system";
  name: string;
  /** Words in the owner's description that point to this kind of business or system. */
  match: RegExp;
  /** The record types, statuses, screens and public pages it needs, and why. */
  needs: string;
  /** The few answers that change what gets built. */
  ask: string;
  /** Community systems that are a good starting point. */
  references: string[];
  /** Systems only: skip this one when one of these playbooks (a business, or a better-matching system) already covers it. */
  unless?: string[];
};

/** Every business that takes bookings or orders from customers also gets these. */
export const COMMON_NEEDS = `- Payment methods (GCash, Maya, bank transfer, cash): name, type, account name, account number, QR code picture,
  instructions, active. Active ones show on public forms so customers know where to pay; customers type their
  payment reference number, and a status (pending payment → paid/confirmed) lets staff verify before confirming.
- A public page customers use without an account when they book, order or inquire themselves, plus FAQs if they ask
  the same questions often. Public forms with more than 5 questions, or with add-ons, are forms in steps.
- An Overview dashboard: today's bookings or orders, revenue this week and month, unpaid or pending items, and a chart.
- Anything sold or rented on top of the main service (rentals, extras, items for sale) is an add-on: a record type of
  items with a price, line items under the booking or order (item link, quantity, line total = price × quantity),
  and the booking's total = its own fee + the sum of its add-ons. Public forms let customers pick add-ons with
  quantities.`;

/**
 * How to build so the owner can run and grow the workspace without asking for a redesign: lists they'll add to are
 * data, every workflow has a full set of statuses, and amounts come from the records they depend on.
 */
export const BUILD_PRINCIPLES = `- Lists the business will add to, rename or retire are their own record types, linked by relation, not fixed
  options: categories (of services, products, expenses, tickets, tasks), plans and packages, rates, room or unit
  types, leave types, departments and positions, branches, suppliers, channels and sources. Give each a name (the
  primary field), an active checkbox (pickers and public forms show active == true), an order number when order
  matters, and the values it carries (price, rate, duration, budget, credits) so amounts read them through the link
  (service.price) instead of being typed again. Formulas reach up to three links (position.rate,
  position.department.name, delivery.supplier.lead_days).
- Short fixed choices that only change with the design are select fields: payment type, priority, unit of measure,
  channel of a ticket, yes/no style choices.
- Everything that moves through work has a status field with its whole lifecycle in order: the first option is
  where new records start (new, draft, requested, pending payment), then the working stages, then every way it can
  end (done, paid, closed, cancelled, declined, no-show, archived). Each workflow gets a kanban board or an approval
  queue, lists filter on it, and status_changed rules do what follows (stock back on cancel, balance deducted on
  approval).
- Compute what can be computed: line totals, totals as rollups, balance = total − paid, days or nights from a time
  range, scores and rates as formulas. Numbers set outside the business (government contribution brackets, tax
  rates, commission rates) are fields or rate records people edit, never constants hidden in a formula.
- Work done per period (monthly bills, payroll runs, stock counts, dues) is a record with a period that staff add
  each time, with its own line items; nothing runs on a schedule.
- Records people look up carry what they search and sort by: a reference number or code, dates, who is
  responsible (a relation to staff or team members) and notes.
- Sample records make the first day look real: every list type gets its actual entries (3 to 6 departments,
  categories, leave types, plans), and every main record type 3 to 5 records spread across its statuses (some
  pending or waiting for approval, some in progress, some done or paid), with their line items (a payroll run with
  its payslips, an order with its lines), so boards, approval queues and dashboards aren't empty.`;

export const PLAYBOOKS: Playbook[] = [...BUSINESS_PLAYBOOKS, ...SYSTEM_PLAYBOOKS];

/** Where a playbook's words appear in the text, as [start, end) spans. */
function spans(p: Playbook, text: string): [number, number][] {
  return [...text.matchAll(new RegExp(p.match.source, "gi"))].map((m) => [m.index, m.index + m[0].length]);
}

const ranked = (kind: Playbook["kind"], text: string) =>
  PLAYBOOKS.filter((p) => p.kind === kind)
    .map((p) => ({ p, at: spans(p, text) }))
    .filter((x) => x.at.length > 0)
    .sort((a, b) => b.at.length - a.at.length);

/**
 * The playbooks that fit a description: the best kind of business (and a second one when the owner clearly runs
 * both, e.g. courts with a café), then up to two systems ("a salon that needs payroll" gets salon and HRIS).
 * A second business only counts words the first didn't already match ("pet grooming" is pets, not also a salon),
 * and needs at least half as many; a system is skipped when a matched business already covers it.
 */
export function matchPlaybooks(text: string): Playbook[] {
  const [first, ...others] = ranked("business", text);
  const businesses = first ? [first.p] : [];
  for (const o of others) {
    const own = o.at.filter(([s, e]) => !first.at.some(([fs, fe]) => s < fe && e > fs)).length;
    if (own > 0 && own * 2 >= first.at.length) {
      businesses.push(o.p);
      break;
    }
  }
  const chosen = [...businesses];
  for (const { p } of ranked("system", text)) {
    if (chosen.length - businesses.length === 2) break;
    if (!p.unless?.some((id) => chosen.some((c) => c.id === id))) chosen.push(p);
  }
  return chosen;
}

/**
 * What a request for a whole area usually involves ("add stock management" is items with stock, receiving, stock
 * movements and the automations between them), from the same playbooks setup builds from, so an edit gets the same
 * judgment as a new workspace instead of building only the words. Empty when nothing matches.
 */
export function requestGuide(request: string): string {
  // Only requests for something new; renaming, moving or tweaking what exists needs no checklist.
  const wantsNew =
    /\b(add|create|set ?up|build|make|track|manage|need|want|start|include|enable|implement|introduce|integrate)\b/i.test(
      request,
    ) &&
    !/^\s*(please\s+)?(rename|move|reorder|change|edit|update|fix|delete|remove|hide|show|sort|filter)\b/i.test(
      request,
    );
  if (!wantsNew) return "";
  const playbooks = matchPlaybooks(request).slice(0, 2);
  if (!playbooks.length) return "";
  return `

What this request usually involves (build the parts this workspace needs, connected to what it already has):
${playbooks.map((p) => `${p.name}:\n${p.needs}`).join("\n\n")}`;
}
