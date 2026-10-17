import type { Playbook } from "./playbooks";

/**
 * Systems any business may run, whatever it sells: point of sale, inventory, HRIS, CRM, projects, content and more.
 * A description can match one business playbook and one or two of these ("a salon that needs payroll").
 */
export const SYSTEM_PLAYBOOKS: Playbook[] = [
  {
    id: "erp",
    kind: "system",
    name: "ERP: sales, purchasing, stock, production and money in one system",
    match:
      /\berp\b|enterprise resource|whole[- ]business system|all[- ]in[- ]one (business )?system|back[- ]office system|run (my|our|the) whole business/i,
    needs: `- An ERP is the loop the business runs every day, connected: customers order, the business buys or makes what
  they ordered, stock moves, and money comes in. What the owner answers decides which parts it has: a trader buys
  and resells, a maker also produces from materials, a service business sells time and materials.
- Sales: customers; products (category as a record type, price, cost, unit, stock on hand, reorder level, low-stock
  formula); quotations and sales orders with line items (product, qty, unit price taken from the product when left
  blank, line total); order status quotation → confirmed → in production or for delivery → delivered → closed,
  plus cancelled. Totals are rollups; deposit required and balance are formulas.
- Payments as records against the order (amount, method, reference no., status pending → verified / rejected),
  rolled up into paid amount; balance = total − paid; payment status is a formula (paid when the balance is 0,
  partially paid when something is paid, else unpaid), never an automation that sets it.
- Purchasing: suppliers; purchase orders with line items (item, qty ordered, qty received, unit cost from the item),
  status draft → ordered → partially received → received, plus cancelled; receiving adds the received qty to stock
  (the ordered qty when nobody typed one).
- Stock: raw materials and finished goods as items (separate record types when the business makes things); stock
  movements as records (item, type: stock in, stock out, production in, production out, adjustment, scrap; qty;
  reason; date) that move stock in the right direction for every type.
- Production, for makers: bill of materials lines under each product (material, qty per unit); production or job
  orders (product, qty to make, linked sales order, status planned → in progress → done, plus cancelled); finishing
  one logs production in for the product and production out for its materials.
- Expenses with categories (record type) for money going out. Overview: sales this month, unpaid balances,
  orders due this week, low stock, purchases waiting to be received, jobs in production.`,
    ask: "What the business does (buys and resells, makes, or provides services), what it stocks (finished goods, raw materials or both), whether it buys from suppliers with purchase orders, whether it makes products in-house from materials, how customers pay (upfront, deposit then balance, or on credit), and how many branches or warehouses.",
    references: ["canteen-pos"],
  },
  {
    id: "pos",
    kind: "system",
    name: "Point of sale and cash register",
    match:
      /\bpos\b|point[- ]of[- ]sale|cash ?register|cashiers?\b|cash drawer|\btill\b|over the counter|counter sales|walk-?in sales|\bresibo\b|senior (citizen )?discount/i,
    needs: `- Products with a category (its own record type), price, cost, SKU or barcode, unit and stock; a checkout
  register (checkout view) that creates orders with line items (product, qty, price read from the product, line
  total), payment method, amount received, change due, cashier, and a discount (amount or percent with a reason;
  senior citizen and PWD 20% with the ID number).
- Order status completed, held (parked), voided, refunded; rules take stock off on completed and put it back on
  voided or refunded. Voids and refunds go through an approval queue (requested → approved / declined).
- Cash shifts: cashier, opened and closed times, opening cash, cash in and cash out entries with reasons, expected
  cash, counted cash, over/short (counted − expected), status open → closed → checked.
- Overview: sales today vs yesterday, orders, average sale, best sellers by product, sales by payment method, low
  stock, busy hours heatmap.`,
    ask: "What they sell and how many items, payment methods, discounts given, how many cashiers or branches.",
    references: ["canteen-pos"],
  },
  {
    id: "inventory",
    kind: "system",
    unless: ["erp"],
    name: "Inventory, suppliers and purchasing",
    match:
      /inventor(y|ies)|\bstocks?\b|stock ?(level|count|card)|warehouse|bodega|suppliers?\b|purchase orders?|reorder|restock|raw materials?|spoilage/i,
    needs: `- Items with a category (record type), unit (pc, kg, box, pack), cost, price, stock on hand, reorder level
  and a low-stock formula (stock <= reorder_level); locations or branches as records when stock sits in more than one.
- Suppliers (contact, payment terms, what they supply); purchase orders with line items (item, qty, unit cost, line
  total) and status draft → ordered → partially received → received, plus cancelled; a rule adds the quantity to
  stock when a line is received.
- Stock movements as records (item, type: in, out, adjustment, transfer, spoilage; qty; reason; date; by whom) with
  rules that adjust stock, so every change has a trail. Stock counts per period: counted vs system qty and variance.
- Overview: low-stock list, stock value (stock × cost), purchases this month, fast-moving items.`,
    ask: "What they stock and roughly how many items, units, suppliers, one or more storage locations.",
    references: ["canteen-pos"],
  },
  {
    id: "hris",
    kind: "system",
    name: "HRIS and payroll (employees, attendance, leave, payroll)",
    match:
      /\bhris\b|\bhr\b|human resources?|payroll|payslips?|sweldo|salar(y|ies)|(employee|staff) attendance|attendance(,| and| &) (leave|payroll)|timekeeping|\bdtr\b|time ?in|biometric|\bleaves\b|leave (requests?|credits?|balances?|types?)|(sick|vacation) leave|overtime|13th month|\b201 file|employee (records|list|database|management|files?)|\bsss\b|philhealth|pag-?ibig|(shift|staff|work) schedul|manage (my |our )?(staff|employees|team)/i,
    needs: `- Employees (201 file): employee no., department and position (record types), employment type (regular,
  probationary, contractual, part-time), date hired, rate type (monthly, daily, hourly) and rate, SSS, PhilHealth,
  Pag-IBIG and TIN numbers, contact and emergency contact, status active → on leave → resigned / terminated.
- Attendance (daily time records): employee, date, time in and out as a time range, hours worked, late and undertime
  minutes, overtime hours, status present, absent, half day, on leave, rest day, holiday. Holidays as records (date,
  regular or special) and shift schedules as records when they rotate.
- Leave types as records (vacation, sick, service incentive leave, maternity, paternity, solo parent) with yearly
  credits; leave requests (type, dates as a time range, days, reason, status requested → approved / declined /
  cancelled) in an approval queue; balances per employee that a rule deducts on approval.
- Payroll runs per cut-off (period, pay date, status draft → for approval → approved → paid) with a payslip line per
  employee: days or hours worked, basic pay, overtime, holiday pay, night differential, allowances, gross, SSS,
  PhilHealth and Pag-IBIG employee shares, withholding tax, loans and cash advances, total deductions and net pay as
  formulas. Contribution and tax amounts are fields HR fills or reads from a contribution table they keep up to date
  (the brackets change); never hard-code them in a formula.
- Cash advances and loans per employee with balances. Overview: headcount, on leave today, pending requests,
  payroll cost this month.`,
    ask: "How many employees and branches, how they're paid (monthly, daily, hourly) and the cut-offs, how attendance is recorded, leave types and credits.",
    references: ["employee-leave"],
  },
  {
    id: "rentals",
    kind: "system",
    unless: ["stays", "boarding", "vehicles", "spaces", "courts"],
    name: "Rentals of equipment, gear and items (check-out, return, deposits)",
    match:
      /\brentals?\b|for rent\b|\brent (out|our|my)\b|equipment rental|party supplies|\bgowns?\b|costumes?|sound system|lights and sound|\btents?\b|projectors?|camera rental|tool rental|chairs and tables|tables and chairs/i,
    needs: `- Rental items: each unique piece (name, category record, serial or tag no., daily rate, deposit, condition,
  photo, status available → reserved → out → returned for checking → under repair → retired), or item types with a
  quantity on hand when pieces are identical (chairs, tables) and a quantity on each rental line.
- Rentals: customer, rental period as a time range with range "dates" (days(period) gives the days), line items per
  item (rate × days × qty), delivery and pickup fees, deposit, discount, total, paid and balance formulas; status
  inquiry → reserved → out → returned → closed, plus overdue and cancelled.
- Check-out and return on the rental: ID presented, released by, condition out; returned on, condition in, missing
  or damaged notes, damage and late charges, deposit refund (deposit − charges).
- When each rental is one unique unit (a camera kit, a gown), the rental links to it as its bookable resource with
  the period as the booking time range, so the same unit can't be rented twice; with several items per rental, a
  calendar of rentals by period and each item's status show what's taken. Rentals by the day use calendars, never a
  slot_grid schedule (that's for hourly bookings).
- Public reservation page in steps: items and dates → delivery or pickup → your details and ID → deposit payment.
  Overview: out today, due back today, overdue, utilization and revenue.`,
    ask: "What they rent (unique pieces or quantities), daily or per-event rates, deposit and ID rules, delivery, late and damage charges.",
    references: ["rental-operations"],
  },
  {
    id: "crm",
    kind: "system",
    name: "CRM and sales pipeline (leads, deals, follow-ups)",
    match:
      /\bcrm\b|customer relationship|\bleads?\b|prospects?|sales pipeline|pipeline|\bdeals?\b|follow[- ]?ups?|sales (team|agents?|reps?)|client list|customer list|accounts? management/i,
    needs: `- Contacts and companies (accounts) with source (record type: Facebook, referral, walk-in, website, event),
  owner (assigned sales person), tags and notes.
- Deals or leads: contact, what they want, estimated value, expected close date, stage new → contacted → qualified →
  proposal sent → negotiation → won / lost (with a lost reason), on a kanban pipeline; probability per stage when
  they forecast.
- Activities and follow-ups under each deal (call, message, meeting, email; due date; status to do → done), with an
  agenda of today's follow-ups and a table of overdue ones.
- Quotes with line items when they send proposals; a public inquiry form that creates a new lead.
- Overview: pipeline value by stage, won this month, win rate (won / closed as a calc), leads by source, follow-ups
  due today.`,
    ask: "Where leads come from, the stages a deal goes through, who handles them, whether they send quotes.",
    references: [],
  },
  {
    id: "invoicing",
    kind: "system",
    unless: ["boarding", "hoa", "erp"],
    name: "Quotes, invoices, billing and collections",
    match:
      /invoic(e|es|ing)|billing|statement of accounts?|\bsoa\b|quotations?|\bquotes?\b|receivables?|official receipts?|\bpayment terms\b|progress billing|\bbill (my |our )?clients\b/i,
    needs: `- Clients with billing details (TIN when receipts need it); products or services as records (name, category,
  unit, unit price).
- Quotations: number, client, date, valid until, line items (item, description, qty, unit price, line total),
  discount, VAT 12% only if VAT-registered, total, status draft → sent → accepted / declined / expired.
- Invoices: number, client, issue and due dates, line items, subtotal, discount, VAT, total, paid (rollup of
  payments), balance formula, status draft → sent → partially paid → paid, plus overdue and void.
- Payments: invoice, date, amount, method, reference no., official receipt no.
- Overview: billed this month, collected, outstanding balance, overdue invoices sorted by due date, collections over
  time.`,
    ask: "What they bill for, VAT-registered or not, payment terms, partial payments or installments.",
    references: ["small-business-finances"],
  },
  {
    id: "projects",
    kind: "system",
    name: "Project and task management",
    match:
      /projects?\b|\btasks?\b|to-?dos?\b|kanban|milestones?|deliverables?|deadlines?|gantt|sprints?|time ?track|timesheets?|work orders?/i,
    needs: `- Projects: client, type (record type), owner, start and due dates, budget, status planning → in progress →
  on hold → for review → done, plus cancelled; milestones or phases under each.
- Tasks: project, title, assignee, priority (low, medium, high, urgent), due date, estimate hours, status to do →
  in progress → blocked → for review → done; a kanban board, a calendar or agenda of due dates, and a table people
  filter by assignee.
- Team members as records (role, hourly rate if they bill time); time logs (date, hours, billable, amount) that roll
  up into each project's hours and cost; project expenses.
- Client approvals or change requests (status requested → approved / declined) when clients sign off; meeting
  notes as a notes view.
- Overview: active projects, tasks due this week, blocked tasks, hours this month, budget vs spent per project.`,
    ask: "Kinds of projects, team size, the stages work goes through, whether they track time or bill clients.",
    references: ["content-calendar"],
  },
  {
    id: "content",
    kind: "system",
    name: "Content and social media management",
    match:
      /\bcontent\b|social media|facebook page|instagram|tiktok|youtube|\bposts?\b|captions?|editorial|\bblogs?\b|newsletters?|marketing calendar|campaigns?|\bcms\b|influencers?/i,
    needs: `- Posts: title, channel (record type: Facebook, Instagram, TikTok, YouTube, website, newsletter), format (image,
  carousel, reel or video, story, article), campaign or content pillar (records), caption, picture, owner, publish
  date-time, status idea → drafting → for review → approved → scheduled → published, plus rejected and archived.
- A content calendar by publish date, a kanban board by status, and an approval queue for review.
- Campaigns with goal, dates and budget; results per published post typed in later (reach, engagement, clicks,
  sales) with an engagement rate formula.
- An ideas bank as a notes view; brand guide and caption templates as document pages.
- Overview: posts this week (agenda), published this month vs target, engagement by channel.`,
    ask: "Channels and how often they post, who writes and who approves, campaigns or content pillars.",
    references: ["content-calendar"],
  },
  {
    id: "helpdesk",
    kind: "system",
    name: "Help desk, customer requests and complaints",
    match:
      /help ?desk|support tickets?|ticketing|customer (support|service|concerns?)|complaints?|service requests?|warranty claims?|issue track|feedback/i,
    needs: `- Tickets: number, requester (name, phone, email as text for public submissions), channel (walk-in, phone,
  Messenger, email, form), category (record type with a default priority and response target), priority (low,
  normal, high, urgent), description, picture, assigned to, status new → open → in progress → waiting on customer →
  resolved → closed, plus reopened and cancelled; resolution and resolved date.
- A public request or complaint form that creates new tickets; a kanban board by status, unassigned tickets first;
  updates or replies as line items under each ticket.
- Saved replies and how-to answers as FAQ records.
- Overview: open tickets by priority, new and resolved this week, tickets by category, oldest open tickets.`,
    ask: "What people contact them about, the channels, who handles tickets, how fast they must respond.",
    references: [],
  },
  {
    id: "memberships",
    kind: "system",
    unless: ["hoa"],
    name: "Memberships, subscriptions and loyalty",
    match:
      /memberships?|\bmembers?\b|subscri(be|bers?|ptions?)|monthly dues|annual dues|loyalty|reward points|renewals?|card holders?/i,
    needs: `- Plans as records (name, price, length in days or months, benefits, active); members (member no., contact,
  plan, start and end dates, status pending → active → expiring → expired, plus frozen and cancelled).
- Payments or renewals per member (period, amount, method, reference no.); a renewal is a new record that sets the
  new end date (nothing renews on a schedule).
- Check-ins or visits when access matters; loyalty points as a number that rules adjust on each purchase or visit.
- Public sign-up form in steps (plan → details → payment). Overview: active members, expiring this week (sorted by
  end date), new and renewed this month, revenue.`,
    ask: "Plans and prices, how long each lasts, how members pay and renew, perks or points.",
    references: [],
  },
  {
    id: "assets",
    kind: "system",
    unless: ["rentals"],
    name: "Asset tracking and maintenance",
    match:
      /\bassets?\b|equipment|machines?|machinery|maintenance|preventive|\bfleet\b|laptops?|computers? inventory|generators?|facilit(y|ies)|calibration/i,
    needs: `- Assets: tag no., name, category (record type with a service interval in days), location or branch (records),
  assigned to, purchase date and cost, supplier, warranty until, condition, status in use → in storage → under
  repair → disposed.
- Work orders: asset, problem, priority, reported by, technician, status reported → scheduled → in progress →
  done, plus cancelled; parts and labor cost. Preventive maintenance as records with a next due date staff update
  after each service.
- Assignments when assets move between people (who has it, from, until, condition out and in).
- Overview: assets by status, open work orders, maintenance due this month, maintenance cost per asset.`,
    ask: "What assets and how many, where they are, who maintains them, whether they're lent to staff.",
    references: [],
  },
  {
    id: "approvals",
    kind: "system",
    name: "Requests and approvals (purchase requests, reimbursements, cash advances)",
    match:
      /approval (workflow|process|requests?)|for approval|purchase requests?|requisitions?|reimburse|liquidat|cash advances?|petty cash|budget requests?|expense claims?/i,
    needs: `- Request types as records (purchase, reimbursement, cash advance, budget, other) with who approves and the
  limit; requests: number, requester, department, type, purpose, amount or line items, needed by, picture of the
  receipt or quote, status draft → submitted → approved / declined → released → liquidated or closed.
- An approval queue for submitted requests; approved by, approval date and notes; a table each requester filters
  to their own.
- Liquidation lines under a cash advance (date, payee, amount, receipt photo) with unliquidated = released −
  liquidated; a petty cash fund with replenishments and spending.
- Overview: waiting for approval, approved this month by type, unliquidated advances.`,
    ask: "What gets requested, who approves and up to what amount, how cash advances are liquidated.",
    references: [],
  },
  {
    id: "lending",
    kind: "system",
    name: "Loans, credit and collections (lending, utang, installments)",
    match:
      /\bloans?\b|lending|lenders?|borrow(ers?)?|\butang\b|on credit|credit (line|limit)|hulugan|paluwagan|\b5-6\b|collectors?|amortization|interest rates?/i,
    needs: `- Borrowers (ID, address, co-maker, credit limit); loan products as records (rate per month, term, fees,
  penalty rate).
- Loans: borrower, product, principal, interest and total payable as formulas, release date, term and frequency
  (daily, weekly, semi-monthly, monthly), amortization, paid (rollup of payments), balance, status application →
  approved → released → current → past due → paid, plus declined and written off.
- Payments: loan, date, amount, collector, method, receipt no.; a collector's list filtered by collector; penalties
  as records.
- Store credit (utang) is simpler: customers with a credit limit, charges and payments, balance = charges − payments.
- Overview: released this month, collected today, outstanding balance, past-due loans, collection rate (calc).`,
    ask: "Loan products, interest and penalties, payment frequency, collectors; or simple store credit.",
    references: [],
  },
  {
    id: "recruitment",
    kind: "system",
    name: "Recruitment and onboarding",
    match:
      /recruit|hiring|\bhire\b|applicants?|job (posts?|openings?|vacanc(y|ies))|candidates?|job interviews?|onboarding|resumes?|\bats\b/i,
    needs: `- Job openings: position, department, slots, location, salary range, status draft → open → on hold → filled
  → closed; a public application form (name, contact, position, expected salary, about them).
- Applicants: opening, source (records: Facebook, JobStreet, referral, walk-in), stage applied → screening →
  interview → assessment → offer → hired, plus rejected and withdrew, on a kanban board; interviews as line items
  (schedule, interviewer, rating, notes).
- Onboarding requirements per new hire (SSS, PhilHealth, Pag-IBIG, TIN, NBI clearance, medical) with status
  pending → submitted → verified.
- Overview: open positions, applicants this week, applicants by stage, hires this month.`,
    ask: "Positions they hire for, where applicants come from, interview steps, pre-employment requirements.",
    references: [],
  },
  {
    id: "delivery",
    kind: "system",
    name: "Deliveries and dispatch (riders, drivers, routes, COD)",
    match:
      /deliver(y|ies)|dispatch|\briders?\b|drivers?\b|couriers?|logistics|shipments?|waybills?|tracking (no|number)|routes?\b|cash on delivery|\bcod\b|lalamove/i,
    needs: `- Deliveries: reference no., customer and address, area (records with a delivery fee), parcel or items, COD
  amount, fee, rider or driver (records with vehicle and plate), schedule (date-time or a time window), status pending
  → assigned → picked up → in transit → delivered, plus failed, returned and cancelled; proof of delivery photo and
  received by.
- Each rider's runs today (table filtered by rider); COD remittances per rider per day (collected, remitted,
  difference).
- Vehicles with fuel and maintenance logs when they own them.
- A public delivery request form. Overview: deliveries today by status, failed or returned, COD to remit,
  deliveries per rider.`,
    ask: "What they deliver, areas and fees, own riders or third-party, COD, proof of delivery.",
    references: [],
  },
  {
    id: "knowledge",
    kind: "system",
    name: "SOPs, policies and a team knowledge base",
    match:
      /\bsops?\b|standard operating|polic(y|ies)|manuals?\b|handbook|knowledge base|\bwiki\b|procedures?|guidelines|training materials?|documentation|memos?\b/i,
    needs: `- Articles or SOPs in a notes view: title, category (record type), owner, version, last reviewed, status draft →
  for review → published → archived, body in markdown.
- Document pages for the employee handbook and onboarding guide; a canvas page for process maps or floor plans.
- Acknowledgements (employee, article, date read) when staff must confirm they read a policy; training records
  (employee, topic, date, trainer, passed).
- Overview: published articles, waiting for review, recently updated.`,
    ask: "What they need written down, who writes and approves, whether staff must acknowledge.",
    references: [],
  },
  {
    id: "inspections",
    kind: "system",
    name: "Checklists, inspections, audits and incident reports",
    match:
      /checklists?|inspections?|audits?\b|compliance|safety|incidents?|quality control|\bqc\b|opening and closing|daily checks?|sanitation|housekeeping/i,
    needs: `- Checklist templates as records (name, area, frequency: daily, weekly, monthly) with their items as line
  items (item, required).
- Inspections: template, branch or area, date, inspector, results as line items (item, result: pass, fail, n/a,
  remarks, photo), passed and total as rollups, score formula, status scheduled → in progress → submitted → reviewed.
  Failed items become corrective actions (owner, due date, status open → in progress → done → verified).
- Incident reports: date-time, location, type (records), severity (low, medium, high, critical), people involved,
  description, photo, action taken, status reported → investigating → resolved → closed; a report form staff use.
- Overview: inspections this week, average score, open corrective actions, incidents by type.`,
    ask: "What they check and how often, who inspects, what happens when something fails.",
    references: [],
  },
  {
    id: "money",
    kind: "system",
    unless: ["erp"],
    name: "Bookkeeping and business finances",
    match:
      /expenses?|\bincome\b|finances?|budgets?|accounting|bookkeep|cash ?flow|\bprofit|gastos|\bkita\b|\bp&l\b|ledger|\bbir\b|receipts?\b/i,
    needs: `- Accounts as records (cash on hand, GCash, Maya, banks) with opening balance and current balance (opening +
  income − expenses, from rollups); categories as records (income or expense, monthly budget).
- Transactions: date, type (income, expense, transfer), category, account, amount, payee or source, reference no.,
  receipt photo, notes, status recorded → reconciled.
- Bills to pay (supplier, due date, amount, status unpaid → paid); recurring bills are records staff add each month.
- Budgets per category with spent and remaining; tax filings (BIR form, period, due date, status) when registered.
- Overview: income vs expenses this month, profit, cash by account, spending by category, budget progress, bills
  due.`,
    ask: "Accounts they use, income and expense categories, budgets, whether they file with BIR.",
    references: ["small-business-finances"],
  },
  {
    id: "appointments",
    kind: "system",
    unless: ["salon", "clinic", "pets", "courts", "spaces"],
    name: "Appointments with staff or rooms",
    match: /appointments?|consultations?|one-on-one|\bsessions? with\b|walk-?ins? and appointments/i,
    needs: `- Services as records (name, category, duration, price, active); staff or rooms as bookable resources with
  working hours; appointments as bookings (resource, time range, service, customer name and phone, status requested →
  confirmed → checked in → completed, plus cancelled and no-show), never two at once for the same staff or room.
- A day schedule by staff (slot grid), a calendar and a list; customers with their visit history.
- Public booking page in steps: service → staff and time → your details → payment. Overview: today's agenda,
  utilization, no-shows and revenue.`,
    ask: "Services and how long they take, who or what gets booked, hours, deposits or no-show rules.",
    references: ["court-bookings"],
  },
  {
    id: "orders",
    kind: "system",
    unless: ["erp"],
    name: "Orders and pre-orders (online sellers, made-to-order, custom products)",
    match:
      /\borders?\b|pre-?orders?|made[- ]to[- ]order|custom orders?|online (sell|shop|store)|shopee|lazada|messenger orders|dropship|resellers?/i,
    needs: `- Products with a category (record type), price, variants (size, flavor) as records or a select, lead time in
  days, active.
- Orders: number, customer, channel (records: Facebook, Instagram, Shopee, walk-in), order date, needed by,
  pickup or delivery with address and fee, line items (product, variant, qty, price, line total), discount, total,
  paid (rollup of payments), balance; status new → confirmed → in production → ready → out for delivery → completed,
  plus cancelled and refunded; payment status unpaid → partially paid → paid.
- Payments with reference no. and proof photo; a production list of what's needed tomorrow (agenda by needed by).
- Public order form in steps (items with quantities → pickup or delivery → details → payment). Overview: orders
  today, due tomorrow, unpaid balances, best sellers.`,
    ask: "What they sell and how customers order, lead time, pickup or delivery, down payment rules.",
    references: ["canteen-pos"],
  },
  {
    id: "registrations",
    kind: "system",
    name: "Event registrations, tickets and attendance",
    match:
      /registrations?|register (for|participants|attendees)|seminars?|workshops?|webinars?|conferences?|fun run|marathon|(?<!support )\btickets?\b|attendees?|participants?|rsvp/i,
    needs: `- Events: title, date and time range, venue, capacity, status draft → open → sold out → done, plus cancelled;
  ticket types as records (name, price, slots) when they sell more than one.
- Registrations: event, attendee name and contact, ticket type, qty, amount, payment reference and proof, status
  pending payment → confirmed → checked in, plus cancelled and refunded; seats left = capacity − confirmed (rollup).
- A public registration form per event; a check-in list for the day (filtered by event, sorted by name); kits or
  certificates claimed as checkboxes.
- Overview: registrations per event, seats left, collections, check-ins today.`,
    ask: "Events and how often, ticket types and prices, capacity, how people pay, check-in on the day.",
    references: [],
  },
];
