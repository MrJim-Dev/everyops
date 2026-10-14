import type { Playbook } from "./playbooks";

/**
 * Kinds of business: what a business like this runs on, the public pages its customers use, and the questions that
 * change the build. Written for the model: plain and specific.
 */
export const BUSINESS_PLAYBOOKS: Playbook[] = [
  {
    id: "courts",
    kind: "business",
    name: "Sports courts and venues (pickleball, badminton, basketball, tennis, padel, futsal, volleyball)",
    match:
      /pickle|badminton|basketball|tennis|padel|futsal|volleyball|\bcourts?\b|sports? (center|venue|hub)|gym rental|open play/i,
    needs: `- Courts as bookable resources with opening hours and slot length; bookings with court, time slot (double
  bookings refused), customer name and phone, status pending payment → confirmed → checked in → completed, plus
  cancelled and no-show.
- Rates as records that change by time or day (day/night, peak/off-peak, weekend): an hourly rate per court and a
  formula for the court fee, e.g. hours × (night ? night rate : day rate).
- Equipment rentals (paddles, rackets) and items for sale (balls, grips, drinks) as add-ons with quantities on the
  booking and on the public booking form; stock for items sold.
- Public booking page in steps: court and time → add-ons → your details → payment (methods with QR, reference no.).
- Schedule (day by court) and calendar; players or members with visits and total spent; open play or coaching
  sessions if they run them; Overview with bookings today, revenue, utilization and unpaid bookings.`,
    ask: "Number of courts and hours, rates (and when they change), what they rent or sell, how customers pay.",
    references: ["court-bookings"],
  },
  {
    id: "spaces",
    kind: "business",
    name: "Coworking spaces, meeting rooms and studios rented by the hour",
    match:
      /co-?working|shared office|hot desks?|meeting rooms?|conference rooms?|function rooms?|rehearsal studio|recording studio|podcast studio|studio rental|by the hour/i,
    needs: `- Spaces (desks, rooms, studios) as bookable resources with capacity, hours and hourly rate; bookings with
  time range, guest details, pax, status requested → confirmed → checked in → completed, plus cancelled and no-show.
- Passes or plans as records (day pass, 10-day pass, monthly desk) with members and remaining uses; add-ons
  (projector, coffee, printing, extra hour) as line items.
- Public booking page in steps: space and time → add-ons → details → payment. Overview: occupancy today, bookings
  this week, revenue, busy hours heatmap.`,
    ask: "Spaces and capacity, hourly or daily rates, passes or memberships, add-ons.",
    references: ["court-bookings"],
  },
  {
    id: "salon",
    kind: "business",
    name: "Salons, barbers, spas, nail and lash studios",
    match: /salon|barber|\bspa\b|massage|\bnails?\b|lash|brows?\b|beauty|waxing|facials?|(?<!pet )grooming/i,
    needs: `- Services as records (name, category record, price, duration, active); staff with specialties as bookable
  resources; appointments with service, staff, time range (no double booking per staff), customer name and phone,
  status requested → confirmed → in service → completed, plus cancelled and no-show.
- Add-ons (hair treatment, nail art, upgrades) and retail products sold at the counter, on the appointment.
- Public booking page in steps: service → staff and time → add-ons → your details → payment.
- Customers with visits, last visit and spending; commissions per staff (rate per service category) if they
  mention them; a register for walk-ins; Overview with today's appointments, revenue and top services.`,
    ask: "Main services and prices, how many staff and whether customers pick one, opening hours, payments.",
    references: [],
  },
  {
    id: "clinic",
    kind: "business",
    name: "Clinics (dental, derma, medical, veterinary, physical therapy, laboratories)",
    match:
      /clinic|dental|dentist|derma|doctors?\b|medical|veterinar|\bvets?\b|therap|physio|optical|laborator/i,
    needs: `- Patients (name, birthday, contact, allergies, notes; for vets the owner and the pet), appointments with doctor
  or room as bookable resources, service, time range, status requested → confirmed → arrived → in consultation →
  done, plus cancelled and no-show; visit or treatment records under each patient.
- Services and procedures as records with prices; billing per visit with line items (procedures, medicines) and
  payments; HMO as records (name, approval code per visit) if mentioned.
- Public appointment request page (requested → confirmed by staff), never showing patient records.
- Overview with today's appointments, collections and pending bills.`,
    ask: "Services and prices, doctors or rooms, clinic hours, how patients pay (cash, GCash, HMO).",
    references: [],
  },
  {
    id: "stays",
    kind: "business",
    name: "Resorts, private pools, staycations, hotels, rooms and vacation rentals",
    match:
      /resort|private pool|staycation|airbnb|\brooms?\b|condo|villa|cabin|cottage|chalet|bungalow|homestay|glamping|hostel|\binn\b|hotel|lodg|transient|beach house/i,
    needs: `- Units or rooms as bookable resources by date range (check-in to check-out; nights from the range), room
  types as records (capacity, rate per night, weekend and peak rates), guests; stays with status inquiry → reserved
  (down payment) → fully paid → checked in → checked out, plus cancelled and no-show; down payment and balance.
- Extra pax fees; add-ons (extra bed, towels, cottages, grill, early check-in) as line items.
- Public booking page in steps: dates and unit → guests and add-ons → your details → down payment.
- Calendar of stays, arrivals and departures today, housekeeping status per unit (dirty → cleaning → ready);
  Overview with occupancy, revenue and balances due.`,
    ask: "Units and capacity, nightly rates and when they change, down payment rule, add-ons offered.",
    references: ["rental-operations"],
  },
  {
    id: "food",
    kind: "business",
    name: "Restaurants, cafés, food stalls, canteens, bakeries and catering",
    match:
      /restaurant|\bcafe\b|café|coffee|\bfood\b|canteen|carinderia|bakery|bakeshop|milk ?tea|kitchen|catering|\bresto\b|eatery|\bgrill\b|samgyup|\bbar\b/i,
    needs: `- Menu items with a category record (meals, drinks, desserts), price and availability; a register that takes
  orders with line items (qty, price) and payment method; order status new → preparing → ready → served or
  delivered, plus cancelled; dine-in, takeout or delivery.
- Ingredients or stock that go down with each sale, with low-stock alerts; suppliers and purchases if mentioned.
- Online orders or reservations if they take them: a public order page in steps (items with quantities → pickup or
  delivery → payment), or a reservation page for tables (tables as bookable resources).
- Overview with sales today, best sellers and low stock; daily expenses if they track them.`,
    ask: "Menu with prices (a photo of the menu helps), dine-in/takeout/delivery, whether customers order online.",
    references: ["canteen-pos"],
  },
  {
    id: "retail",
    kind: "business",
    name: "Retail stores, sari-sari stores, pharmacies, hardware and online shops",
    match:
      /\bstores?\b|sari-?sari|retail|boutique|ukay|\bmerch|hardware|grocery|pharmacy|drugstore|mini ?mart|e-?commerce/i,
    needs: `- Products with a category record, price, cost, barcode and stock; a register for sales with line items; stock
  that goes down on each sale and up on deliveries, with low-stock alerts; suppliers and restocks.
- Online orders if they sell online: customers, orders with items, shipping or pickup, status to pay → to ship →
  shipped → delivered, plus returned and cancelled, and a public order page with items and quantities.
- Utang (credit) per customer if mentioned; Overview with sales, profit, top products and low stock.`,
    ask: "What they sell and roughly how many products, whether they sell online, delivery or pickup, credit.",
    references: ["canteen-pos"],
  },
  {
    id: "laundry",
    kind: "business",
    name: "Laundry shops",
    match: /laundry|\blaba\b|dry ?clean|wash and fold|washing/i,
    needs: `- Services as records priced per kilo or per load (wash-dry-fold, dry clean, comforters); job orders with
  customer, weight or loads, services and add-ons (fabric conditioner, extra rinse) as line items, status received →
  washing → drying → folding → ready → claimed, plus cancelled; pickup or delivery and payment.
- Customers with phone; a public pickup-request page; Overview with loads today, ready to claim and unpaid.`,
    ask: "Services and prices (per kilo or per load), add-ons, pickup and delivery, payments.",
    references: [],
  },
  {
    id: "vehicles",
    kind: "business",
    name: "Car, van, motorcycle and scooter rentals",
    match:
      /car rental|rent a car|motorcycles?|motor rental|van rental|vehicles?\b|scooters?|bike rental|self-?drive/i,
    needs: `- Vehicles as bookable resources by date range, with plate number, type (record type with daily rate and
  deposit), status available → reserved → out → in maintenance; rentals with customer, pickup and return dates and
  places, days, deposit, license and ID checked, status reserved → out → returned → closed, plus cancelled.
- Add-ons (driver, child seat, insurance, delivery) as line items; mileage and fuel out and in; damage and late
  charges against the deposit.
- Maintenance records per vehicle; public booking page in steps: vehicle and dates → add-ons → your details and ID →
  payment; Overview with units out today, returns due and revenue.`,
    ask: "Units and daily rates, with or without driver, deposit and requirements, delivery.",
    references: ["rental-operations"],
  },
  {
    id: "fitness",
    kind: "business",
    name: "Gyms, fitness, yoga, dance and martial arts studios",
    match:
      /\bgyms?\b|fitness|yoga|pilates|crossfit|dance studio|martial|boxing|muay|zumba|personal trainers?/i,
    needs: `- Membership plans as records (price, length); members with plan, start and end dates, status active →
  expiring → expired, plus frozen; payments per member; check-ins.
- Classes with schedule, coach and capacity; class bookings (booked → attended or no-show); coaches; personal
  training packages with sessions left.
- Public sign-up or class booking page; Overview with active members, expiring this week, check-ins and revenue.`,
    ask: "Membership plans and prices, classes and schedule, walk-in rates, coaches.",
    references: [],
  },
  {
    id: "education",
    kind: "business",
    name: "Tutorial centers, schools, review centers, daycare, music, art, swimming and driving lessons",
    match:
      /tutor|school|review center|lessons?\b|students?|enrol|music|piano|swim(ming)? lessons?|learning center|daycare|preschool|driving school/i,
    needs: `- Students with guardian and contact; programs or courses as records (fee, sessions, schedule); enrollments
  with status inquiry → enrolled → active → completed, plus dropped; attendance per session; teachers and their
  schedules.
- Tuition: fees and installments as line items, payments, balance per enrollment; grades or progress notes if they
  give them.
- Public inquiry or enrollment page in steps; Overview with active students, collections and balances due.`,
    ask: "Programs and fees, how sessions are scheduled, how tuition is paid (full or installments).",
    references: [],
  },
  {
    id: "events",
    kind: "business",
    name: "Event venues, photo and video studios, catering and event services",
    match:
      /events? (venues?|places?|services?|business|coordinat\w*|management|planning|styling)|event planners?|venue|wedding|debut|photo|video|studio|catering|part(y|ies) (venues?|places?|packages?)|function hall|coordinator|lights and sound/i,
    needs: `- Packages as records with inclusions and price; inquiries → quotes → bookings with event date, venue, pax,
  package, add-ons as line items, down payment and balance, status inquiry → quoted → reserved → paid → done, plus
  cancelled.
- Payments per booking; a calendar of events (one event per date or room as bookable resources); suppliers or crew
  assigned per event; an event-day checklist.
- Public inquiry page in steps: date and package → add-ons → details → payment; Overview with upcoming events,
  collections and balances.`,
    ask: "Packages and prices, how many events per day, down payment rule, add-ons.",
    references: [],
  },
  {
    id: "repairs",
    kind: "business",
    name: "Repair shops (auto, motorcycle, gadgets, computers, appliances, aircon)",
    match:
      /repair|mechanic|auto shop|service center|\baircon\b|gadgets?|cellphones?|computers?|appliances?|plumb|electrician/i,
    needs: `- Job orders with customer, item or vehicle, problem, technician, status received → diagnosing → waiting for
  approval → waiting for parts → in progress → ready → released, plus cancelled; labor and parts as line items, total
  and payments; warranty until.
- Parts inventory that goes down when used; service types as records with labor price; customers and their items;
  on-site service appointments; a public service-request page; Overview with open jobs, ready for release and revenue.`,
    ask: "What they repair or service, labor pricing, parts stock, on-site visits.",
    references: [],
  },
  {
    id: "cleaning",
    kind: "business",
    name: "Cleaning, pest control and home services",
    match:
      /cleaning (service|company)|house ?cleaning|janitorial|deep clean|sofa clean|carpet clean|aircon clean|disinfect|pest control|termite|maids?\b|home services?/i,
    needs: `- Services as records (name, category, price per unit: per hour, per sqm, per aircon unit; duration); bookings
  with address, area, schedule as a time range, assigned team or cleaners, status requested → confirmed → assigned →
  on the way → done, plus cancelled and rescheduled; add-ons as line items.
- Teams or staff as bookable resources so jobs don't overlap; a checklist and before/after photos per job;
  recurring clients as records staff book again.
- Public booking page in steps: service and size → schedule → address and details → payment. Overview: jobs today
  by team, revenue, repeat clients.`,
    ask: "Services and how they price them, service areas, teams, recurring clients.",
    references: [],
  },
  {
    id: "water",
    kind: "business",
    name: "Water refilling stations, LPG and delivery businesses",
    match: /water refill|refilling|purified water|gallons?|\blpg\b|ice plant|\bice\b/i,
    needs: `- Products as records (round gallon, slim, LPG tank sizes) with prices; customers with address and area;
  orders with items, delivery or pickup, rider, status new → out for delivery → delivered → paid, plus cancelled;
  containers lent per customer (out and returned); daily production or stock.
- Public order page; Overview with deliveries today, gallons sold, unpaid and containers out.`,
    ask: "Products and prices, delivery areas and fees, riders, containers lent out.",
    references: [],
  },
  {
    id: "contractors",
    kind: "business",
    name: "Contractors, construction, renovation and interior fit-out",
    match:
      /contractors?|construction|renovat|interior|architect|builders?|fit-?out|electrical works|plumbing works|welding|steel works/i,
    needs: `- Clients; projects or job sites with address, contract amount, start and target dates, status for quotation
  → contract signed → mobilizing → ongoing → punch list → turned over, plus on hold and cancelled.
- Estimates or bill of quantities (materials and labor as line items with qty, unit cost and totals); progress
  billing per milestone (percent complete, amount, status billed → paid); payments.
- Materials as records; material requests and deliveries per site; manpower and daily attendance per site;
  daily site reports with photos; subcontractors and their payments.
- Overview: active projects, collections vs contract amount, costs vs budget per project, pending billings.`,
    ask: "Kinds of projects, how they estimate and bill (milestones, percent complete), crews and subcontractors.",
    references: ["small-business-finances"],
  },
  {
    id: "agency",
    kind: "business",
    name: "Agencies, freelancers, consultants and creative studios",
    match:
      /agency|freelanc|consult(ant|ing|ancy)|creative studio|design studio|marketing agency|virtual assistants?|\bva\b|outsourc|web develop|software house/i,
    needs: `- Clients with retainers or packages as records (monthly fee, inclusions); projects with deliverables, owner,
  due dates and status brief → in progress → for client review → revisions → approved → delivered.
- Tasks per team member, time logs (billable hours × rate) and revision rounds; client approvals as an approval
  queue.
- Proposals and invoices with payments; Overview with active clients, deliverables due this week, hours this month
  and unpaid invoices.`,
    ask: "Services and how they charge (retainer, per project, per hour), team size, how clients approve work.",
    references: ["content-calendar"],
  },
  {
    id: "print",
    kind: "business",
    name: "Print shops (tarpaulin, signage, t-shirt printing, photocopy, stickers)",
    match:
      /\bprint(ing)?\b|tarpaulin|\btarps?\b|sublimation|t-?shirt print|photocopy|xerox|signage|stickers?|large format|mug print|\bid printing/i,
    needs: `- Products and services as records (tarpaulin per sq ft, shirts per piece, photocopy per page) with price and
  unit; job orders: customer, items as line items (size, qty, unit price, total), layout file or picture, rush fee,
  due date, status for quotation → for layout → for approval → printing → ready → claimed, plus cancelled.
- Down payment and balance; a public order form (item, size, qty, upload notes, due date); materials stock (ink,
  tarp rolls, shirts) going down per job.
- Overview: jobs due today, ready to claim, unpaid balances, sales this week.`,
    ask: "What they print and how they price it, rush jobs, down payment rule, whether customers order online.",
    references: [],
  },
  {
    id: "boarding",
    kind: "business",
    name: "Apartments, boarding houses, dorms and commercial spaces (monthly rent)",
    match:
      /\bboarding|\bdorms?\b|apartments?|bedspace|tenants?|landlord|monthly rent|room for rent|commercial spaces?|stall rent|\bleases?\b|property management/i,
    needs: `- Properties and units or beds as records (monthly rent, deposit, status vacant → reserved → occupied → under
  repair); tenants with unit, move-in date, lease end, deposit and advance, status applicant → active → moving out
  → moved out.
- Monthly bills per tenant (period, rent, water and electricity from meter readings: previous, current, rate per
  unit, amount), due date, paid (rollup of payments), status unpaid → partially paid → paid, plus overdue; bills
  are records staff add each month.
- Payments with reference no. and proof; maintenance requests from tenants (status reported → scheduled → done).
- Public inquiry page for vacancies; Overview with occupancy, rent due this month and overdue tenants.`,
    ask: "Units or beds and rent, how utilities are billed, deposit and advance rules.",
    references: ["rental-operations"],
  },
  {
    id: "realestate",
    kind: "business",
    name: "Real estate brokers, agents and developers",
    match:
      /real estate|realty|brokers?\b|property (agents?|listings?)|house and lot|lots? for sale|pre-?selling|condo units? for sale|developers?\b/i,
    needs: `- Listings: property type (record type: house and lot, condo, lot, commercial), location, price, lot and floor
  area, bedrooms, photos, status available → reserved → sold, plus off-market.
- Buyers or leads with budget, preferred area and source; viewings scheduled (agenda); deals with stage inquiry →
  viewing → reservation → documents → financing → sold, plus lost; reservation fee, down payment and payment terms.
- Agents with commission rate and commissions per sale (status pending → released); a public listings page and
  inquiry form.
- Overview: available listings, viewings this week, reservations and sales this month, commissions due.`,
    ask: "What they sell or lease, agents and commission rules, the buying steps, payment terms.",
    references: [],
  },
  {
    id: "coop",
    kind: "business",
    name: "Cooperatives and lending businesses",
    match:
      /cooperative|\bco-?op\b|share capital|savings and loans?|mutual aid|microfinance|lending (business|company)/i,
    needs: `- Members with member no., membership date, status applicant → active → inactive → withdrawn; share capital
  and savings deposits as transactions with balances per member.
- Loan products as records (rate, term, fees); loan applications with co-maker, approval queue, releases,
  amortization and payments, balance and status current → past due → paid.
- Dividends or patronage refunds per year; meetings and announcements as document pages.
- Overview: members, share capital, loans released and outstanding, collections this month.`,
    ask: "Members and services (savings, loans), loan products and terms, collection frequency.",
    references: [],
  },
  {
    id: "organizations",
    kind: "business",
    name: "Churches, non-profits, foundations, clubs and associations",
    match:
      /church|ministry|parish|non-?profit|\bngo\b|foundation|charity|donations?|donors?|alumni|organi[sz]ation|\bclub\b|fraternity|sorority|volunteers?|youth group/i,
    needs: `- Members with group or chapter (records), role, contact, status active → inactive; dues or contributions per
  period (records staff add, status unpaid → paid).
- Donations: donor, date, amount, fund or campaign (records with target), method, acknowledged; campaigns with
  progress toward target.
- Events and activities with attendance; volunteers and their assignments; announcements as document pages.
- Public pages: donation form with payment QR, event sign-ups. Overview: members, donations this month by fund,
  campaign progress, upcoming events.`,
    ask: "Members or chapters, dues, how donations come in and which funds, events they run.",
    references: [],
  },
  {
    id: "hoa",
    kind: "business",
    name: "Homeowners' and condo associations, subdivisions and property management offices",
    match:
      /homeowners?|\bhoa\b|subdivision|\bvillage\b|condo(minium)? (corporation|association|admin)|\bpmo\b|association dues|monthly dues|gate pass|amenit(y|ies)|clubhouse/i,
    needs: `- Units or lots with owner and residents, status occupied → vacant → for lease; monthly dues per unit
  (period, amount, penalties, paid, status unpaid → paid → overdue) added each month.
- Amenity bookings (clubhouse, pool, court as bookable resources) with fees; gate passes and visitor logs;
  vehicle stickers.
- Work orders and complaints from residents (status reported → in progress → resolved); announcements; officers.
- Public pages: amenity booking and request forms. Overview: collection rate, unpaid units, open requests, bookings.`,
    ask: "Number of units, dues and penalties, amenities, how residents report concerns.",
    references: [],
  },
  {
    id: "pets",
    kind: "business",
    name: "Pet grooming, pet hotels and boarding",
    match: /pet grooming|pet hotel|pet boarding|\bpets?\b|\bdogs?\b|\bcats?\b|kennel|groomers?/i,
    needs: `- Owners and pets (name, breed, size, birthday, vaccinations, notes); services as records priced by pet size.
- Grooming appointments with groomer as bookable resources and status booked → checked in → grooming → ready →
  picked up, plus cancelled; boarding stays by date range with feeding notes and daily updates.
- Public booking page in steps: pet and service → time → details → payment. Overview: today's pets, revenue,
  vaccinations due.`,
    ask: "Services and prices by size, grooming or boarding or both, vaccination requirements.",
    references: [],
  },
  {
    id: "farm",
    kind: "business",
    name: "Farms, poultry, piggeries, fishponds and agribusiness",
    match:
      /\bfarms?\b|farming|poultry|piggery|\bhogs?\b|livestock|\bcrops?\b|harvests?|agri|fishpond|aquaculture|layers|broilers?|plantation/i,
    needs: `- Plots, pens or ponds as records; batches or crops (start date, count or area, breed or variety, status
  started → growing → harvested or sold, plus lost); daily logs (feed, water, mortality, notes).
- Inputs as inventory (feeds, fertilizer, medicine) with purchases and usage per batch; harvests and sales with
  buyer, quantity, price and payment.
- Costs per batch vs sales (profit per batch); workers and their daily pay.
- Overview: active batches, mortality this week, feed used, sales and profit per batch.`,
    ask: "What they raise or grow, batch sizes, inputs tracked, who they sell to.",
    references: [],
  },
  {
    id: "production",
    kind: "business",
    name: "Small manufacturers and makers (food processing, garments, furniture, soap, made-to-order)",
    match:
      /manufactur|factory|production|recipes?|\bbatch(es)?\b|bill of materials|\bbom\b|food processing|garments?|sewing|tailor|dressmak|furniture|woodwork|soap|candles?/i,
    needs: `- Products with recipes or bill of materials (raw material, qty per unit) as line items; raw materials as
  inventory with cost and reorder level.
- Production batches or job orders: product, qty, start and due dates, status planned → in production → quality
  check → finished, plus scrapped; materials used and output as stock movements; cost per unit from materials.
- Customer orders that feed production; finished goods stock and sales.
- Overview: batches in production, finished this week, low raw materials, production cost vs selling price.`,
    ask: "What they make, recipes or materials per product, batch sizes, who they sell to.",
    references: ["canteen-pos"],
  },
  {
    id: "carwash",
    kind: "business",
    name: "Car wash, auto detailing and motor shops",
    match: /car ?wash|auto detail|detailing|ceramic coating|motor ?wash|window tint/i,
    needs: `- Services as records priced by vehicle size (sedan, SUV, van, motorcycle); job tickets with plate number,
  vehicle size, services as line items, washer or detailer, status queued → washing → drying → done → released,
  plus cancelled; payment.
- Packages and loyalty cards (every 10th wash free) as memberships; supplies stock; commissions per washer.
- A queue board for today (kanban), appointments for detailing; Overview with cars today, revenue, busy hours.`,
    ask: "Services and prices by vehicle size, washers and commissions, appointments or walk-in only.",
    references: [],
  },
  {
    id: "tours",
    kind: "business",
    name: "Travel agencies, tours and island hopping",
    match:
      /\btours?\b|travel|island hopping|\btrips?\b|itinerar|\bboats?\b|dive|diving|excursion|ticketing (agent|office)/i,
    needs: `- Tours as records with date, capacity and price per person; bookings with pax, guests, add-ons (lunch, gear,
  transfers) as line items, down payment and balance, status inquiry → reserved → fully paid → completed, plus
  cancelled; guides or boats assigned.
- Public booking page in steps: tour and date → pax and add-ons → guest details → payment; Overview with trips this
  week, seats left and collections.`,
    ask: "Tours and prices, capacity, add-ons, payment rules.",
    references: [],
  },
];
