/**
 * What kinds of businesses usually need, so setup can think ahead instead of only asking. Each playbook names the
 * systems a business like it runs, the public pages its customers use, and the few questions that change the build.
 * The interview proposes from these; the designer builds from them. Written for the model: plain and specific.
 */
export type Playbook = {
  id: string;
  name: string;
  /** Words in the owner's description that point to this kind of business. */
  match: RegExp;
  /** The systems such a business needs, and why. */
  needs: string;
  /** The few answers that change what gets built. */
  ask: string;
  /** Community systems that are a good starting point. */
  references: string[];
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

export const PLAYBOOKS: Playbook[] = [
  {
    id: "courts",
    name: "Sports courts and venues (pickleball, badminton, basketball, tennis, padel, futsal, volleyball)",
    match:
      /pickle|badminton|basketball|tennis|padel|futsal|volleyball|court|sports? (center|venue|hub)|gym rental/i,
    needs: `- Courts as bookable resources with opening hours and slot length; bookings with court, time slot (double
  bookings refused), customer name and phone, status (pending payment, confirmed, cancelled, no-show).
- Rates that change by time or day (day/night, peak/off-peak, weekend): an hourly rate per court and a formula for
  the court fee, e.g. hours × (night ? night rate : day rate).
- Equipment rentals (paddles, rackets) and items for sale (balls, grips, drinks) as add-ons with quantities on the
  booking and on the public booking form. Optionally stock for items sold.
- Public booking page in steps: court and time → add-ons → your details → payment (methods with QR, reference no.).
- Schedule (day by court) and calendar; players or members with visits and total spent; open play or coaching
  sessions if they run them; Overview with bookings today, revenue, utilization and unpaid bookings.`,
    ask: "Number of courts and hours, rates (and when they change), what they rent or sell, how customers pay.",
    references: ["court-bookings"],
  },
  {
    id: "salon",
    name: "Salons, barbers, spas, nail and lash studios",
    match: /salon|barber|spa\b|massage|nail|lash|brow|beauty|wax|facial|grooming/i,
    needs: `- Services (name, category, price, duration); staff with specialties; appointments with service, staff, date and
  time (no double booking per staff), customer name and phone, status (requested, confirmed, completed, cancelled).
- Add-ons (hair treatment, nail art, upgrades) and retail products sold at the counter, on the appointment.
- Public booking page in steps: service → staff and time → add-ons → your details → payment.
- Customers with visits, last visit and spending; commissions per staff if they mention them; a register for
  walk-ins; Overview with today's appointments, revenue and top services.`,
    ask: "Main services and prices, how many staff and whether customers pick one, opening hours, payments.",
    references: [],
  },
  {
    id: "clinic",
    name: "Clinics (dental, derma, medical, veterinary, physical therapy)",
    match: /clinic|dental|dentist|derma|doctor|medical|veterinar|vet\b|therap|physio|optical|laborator/i,
    needs: `- Patients (name, birthday, contact, notes; for vets the owner and the pet), appointments with doctor or room,
  service, date and time, status, and treatment or visit records under each patient.
- Services with prices; billing per visit with line items (procedures, medicines) and payments; HMO if mentioned.
- Public appointment request page (requested → confirmed by staff), never showing patient records.
- Overview with today's appointments, collections and pending bills.`,
    ask: "Services and prices, doctors or rooms, clinic hours, how patients pay (cash, GCash, HMO).",
    references: [],
  },
  {
    id: "stays",
    name: "Resorts, private pools, staycations, rooms, condos and vacation rentals",
    match:
      /resort|private pool|staycation|airbnb|room|condo|villa|cabin|cottage|chalet|bungalow|homestay|glamping|hostel|inn\b|hotel|lodg|transient|rental unit|beach house/i,
    needs: `- Units or rooms as bookable resources by date range (check-in to check-out, nights), guests, stays with status
  (inquiry, reserved with down payment, fully paid, checked in, checked out, cancelled), down payment and balance.
- Rates by night that change on weekends or peak season; extra pax fees; add-ons (extra bed, towels, cottages,
  grill, early check-in) as line items.
- Public booking page in steps: dates and unit → guests and add-ons → your details → payment of the down payment.
- Calendar of stays, arrivals and departures today, housekeeping or cleaning status per unit; Overview with
  occupancy, revenue and balances due.`,
    ask: "Units and capacity, nightly rates and when they change, down payment rule, add-ons offered.",
    references: ["rental-operations"],
  },
  {
    id: "food",
    name: "Restaurants, cafés, food stalls, canteens, bakeries and catering",
    match:
      /restaurant|cafe|café|coffee|food|canteen|carinderia|bakery|bakeshop|milk ?tea|kitchen|catering|resto|eatery|grill/i,
    needs: `- Menu items with category, price and availability; a register that takes orders with line items (quantity,
  price) and payment method; order status (new, preparing, ready, served or delivered).
- Stock or ingredients that go down with each sale, with low-stock alerts; suppliers and purchases if mentioned.
- Online orders or reservations if they take them: a public order page in steps (items with quantities → pickup or
  delivery details → payment), or a reservation page for tables.
- Overview with sales today, best sellers and low stock; daily expenses if they track them.`,
    ask: "Menu with prices (a photo of the menu helps), dine-in/takeout/delivery, whether customers order online.",
    references: ["canteen-pos"],
  },
  {
    id: "retail",
    name: "Retail stores, sari-sari stores, online sellers and resellers",
    match:
      /store|shop\b|sari|retail|reseller|online sell|boutique|ukay|merch|hardware|grocery|pharmacy|e-?commerce/i,
    needs: `- Products with category, price, cost and stock; a register for sales with line items; stock that goes down on
  each sale and up on deliveries, with low-stock alerts; suppliers and restocks.
- Online orders if they sell online: customers, orders with items, shipping or pickup, status (to pay, to ship,
  shipped, delivered, returned), and a public order page with items and quantities.
- Utang (credit) per customer if mentioned; Overview with sales, profit, top products and low stock.`,
    ask: "What they sell and roughly how many products, whether they sell online, delivery or pickup, credit.",
    references: ["canteen-pos"],
  },
  {
    id: "laundry",
    name: "Laundry shops",
    match: /laundry|laba|dry ?clean|wash and fold|washing/i,
    needs: `- Services priced per kilo or per load (wash-dry-fold, dry clean, comforters), job orders with customer, weight or
  loads, services, add-ons (fabric conditioner, extra rinse) as line items, status (received, washing, ready,
  claimed), pickup/delivery and payment.
- Customers with phone; a public pickup-request page; Overview with loads today, ready to claim and unpaid.`,
    ask: "Services and prices (per kilo or per load), add-ons, pickup and delivery, payments.",
    references: [],
  },
  {
    id: "vehicles",
    name: "Car, motorcycle, van and equipment rentals",
    match:
      /car rental|rent a car|motorcycle|motor rental|van rental|vehicle|scooter|bike rental|equipment rental/i,
    needs: `- Vehicles or units as bookable resources by date range, with plate number, type, daily rate and status
  (available, rented, maintenance); rentals with customer, pickup and return dates and places, days, deposit,
  ID checked, status; add-ons (driver, child seat, insurance, delivery) as line items.
- Maintenance records per vehicle; public booking page in steps: vehicle and dates → add-ons → your details and ID →
  payment; Overview with units out today, returns due and revenue.`,
    ask: "Units and daily rates, with or without driver, deposit and requirements, delivery.",
    references: ["rental-operations"],
  },
  {
    id: "fitness",
    name: "Gyms, fitness, yoga, dance and martial arts studios",
    match: /gym|fitness|yoga|pilates|crossfit|dance studio|martial|boxing|muay|zumba|trainer|membership/i,
    needs: `- Members with membership plan, start and end dates, status (active, expiring, expired); plans with price and
  length; payments per member; check-ins or attendance.
- Classes with schedule, coach and capacity; class bookings; coaches; personal training sessions if they offer them.
- Public sign-up or class booking page; Overview with active members, expiring this week, check-ins and revenue.`,
    ask: "Membership plans and prices, classes and schedule, walk-in rates, coaches.",
    references: [],
  },
  {
    id: "education",
    name: "Tutorial centers, schools, review centers, music and art lessons",
    match:
      /tutor|school|review center|lesson|class(es)?\b|student|enrol|music|piano|swim(ming)? lesson|learning center|daycare/i,
    needs: `- Students with guardian and contact; courses or programs with fee and schedule; enrollments with status; sessions
  or attendance; tuition payments and balances per student; teachers and their schedules.
- Public inquiry or enrollment page in steps; Overview with active students, collections and balances due.`,
    ask: "Programs and fees, how sessions are scheduled, how tuition is paid (full or installments).",
    references: [],
  },
  {
    id: "events",
    name: "Event venues, photo and video studios, catering and event services",
    match:
      /event|venue|wedding|debut|photo|video|studio|catering|party|function hall|coordinator|rental of chairs/i,
    needs: `- Packages with inclusions and price; inquiries → quotes → bookings with event date, venue, pax, package, add-ons
  as line items, down payment and balance, status (inquiry, quoted, reserved, paid, done, cancelled).
- Payments per booking; a calendar of events (one event per date or room); suppliers or crew if mentioned.
- Public inquiry page in steps: date and package → add-ons → details → payment; Overview with upcoming events,
  collections and balances.`,
    ask: "Packages and prices, how many events per day, down payment rule, add-ons.",
    references: [],
  },
  {
    id: "repairs",
    name: "Repair shops and services (auto, motorcycle, gadgets, appliances, aircon, home services)",
    match:
      /repair|mechanic|auto shop|service center|aircon|gadget|cellphone|computer|appliance|plumb|electrician|cleaning service|pest/i,
    needs: `- Job orders with customer, item or vehicle, problem, technician, status (received, diagnosing, waiting for parts,
  in progress, ready, released), labor and parts as line items, total and payments.
- Parts inventory that goes down when used; customers and their items; service appointments if they go on site;
  a public service-request page; Overview with open jobs, ready for release and revenue.`,
    ask: "What they repair or service, labor pricing, parts stock, on-site visits.",
    references: [],
  },
  {
    id: "water",
    name: "Water refilling stations and delivery businesses",
    match: /water refill|refilling|purified water|gallon|lpg|delivery business|ice\b/i,
    needs: `- Customers with address; orders with gallons or items, delivery or pickup, rider, status (new, out for delivery,
  delivered, paid); containers borrowed per customer; daily production or stock.
- Public order page; Overview with deliveries today, gallons sold, unpaid and containers out.`,
    ask: "Products and prices, delivery areas and fees, riders, containers lent out.",
    references: [],
  },
  {
    id: "projects",
    name: "Contractors, interior design, agencies and freelancers",
    match:
      /contractor|construction|interior|renovat|architect|agency|freelanc|marketing agency|design studio|consult/i,
    needs: `- Clients; projects with status board, start and due dates, budget; tasks with assignee and due date; quotations
  and billing milestones with payments; materials or expenses per project.
- Public inquiry page; Overview with active projects, due this week, collections and project profitability.`,
    ask: "Kinds of projects, how they quote and bill, team members.",
    references: ["content-calendar", "small-business-finances"],
  },
  {
    id: "boarding",
    name: "Boarding houses, dorms, apartments and space rentals (monthly)",
    match:
      /boarding|dorm|apartment|bedspace|tenant|landlord|monthly rent|room for rent|commercial space|stall rent/i,
    needs: `- Units or beds with monthly rent and status; tenants with move-in date, deposit and advance; monthly bills
  (rent, water, electricity) with due date and status; payments; maintenance requests.
- Public inquiry page for vacancies; Overview with occupancy, rent due this month and overdue tenants.`,
    ask: "Units or beds and rent, how utilities are billed, deposit and advance rules.",
    references: ["rental-operations"],
  },
  {
    id: "tours",
    name: "Travel agencies, tours and island hopping",
    match: /tour|travel|island hopping|trip|itinerar|boat|dive|diving|excursion/i,
    needs: `- Tours with date, capacity and price per person; bookings with pax, guests, add-ons (lunch, gear, transfers) as
  line items, down payment and balance, status; guides or boats assigned.
- Public booking page in steps: tour and date → pax and add-ons → guest details → payment; Overview with trips this
  week, seats left and collections.`,
    ask: "Tours and prices, capacity, add-ons, payment rules.",
    references: [],
  },
  {
    id: "staff",
    name: "Team and HR (any business with employees)",
    match: /employee|staff|leave|payroll|attendance|hr\b|human resource|shift|timekeeping/i,
    needs: `- Employees with position and rate; leave requests with an approval queue and balances that update on approval;
  shifts or attendance; cash advances; Overview with who is off today and pending requests.`,
    ask: "Number of staff, leave types and credits, how attendance is tracked.",
    references: ["employee-leave"],
  },
  {
    id: "money",
    name: "Business finances (any business)",
    match: /expense|income|finance|budget|accounting|bookkeep|cash ?flow|profit/i,
    needs: `- Transactions (income and expense) with category, account (cash, GCash, bank) and date; a budget per category;
  Overview with cash flow, spending by category and profit this month.`,
    ask: "Where money comes in and goes out, accounts used.",
    references: ["small-business-finances"],
  },
];

/** The playbooks that fit a description, best match first. */
export function matchPlaybooks(text: string, limit = 2): Playbook[] {
  return PLAYBOOKS.map((p) => ({ p, hits: text.match(new RegExp(p.match.source, "gi"))?.length ?? 0 }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.p);
}
