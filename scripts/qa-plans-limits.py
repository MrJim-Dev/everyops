
import json, re, subprocess, time, uuid, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3047"
DB = "postgres://postgres@localhost:5547/everyops"
OUT = "/Users/james/AI Builder Club/everyops-billing/docs/pr-screenshots/plans-usage-limits"
LOG = "/tmp/eo-billing-dev.log"
proof = []
import os
os.makedirs(OUT, exist_ok=True)

def sql(q):
    return subprocess.run(["psql", DB, "-Atq", "-c", q], capture_output=True, text=True, check=True).stdout.strip()

def note(step, res):
    try:
        body = res.json()
    except Exception:
        body = res.text()[:300]
    entry = {"step": step, "status": res.status, "body": body}
    proof.append(entry)
    print(json.dumps(entry)[:400]); sys.stdout.flush()
    return entry

def post(ctx, path, data):
    return ctx.request.post(BASE + path, data=json.dumps(data), headers={"content-type": "application/json", "origin": BASE})

def get(ctx, path):
    return ctx.request.get(BASE + path)

def seed_ai(user_id, rows):
    # QA data: logged Gemini calls billed to the account (cost in micro-dollars), as if they had run today.
    for feature, task, n, micros in rows:
        sql(f"""insert into ai_call (user_id, request_id, feature, task, model, location, outcome, cost_micros, origin, billed_to)
          select '{user_id}', 'qa-' || md5(random()::text), '{feature}', '{task}', 'gemini-3.7-flash', 'global', 'ok', {micros}, 'local:qa', '{user_id}'
          from generate_series(1, {n})""")

def shot(page, name, locator=None, full=False):
    page.add_style_tag(content="nextjs-portal{display:none!important}")
    path = f"{OUT}/{name}.png"
    if locator: page.locator(locator).screenshot(path=path)
    else: page.screenshot(path=path, full_page=full)
    print("shot", name)

def account_page(page):
    page.goto(BASE + "/account")
    page.get_by_text("AI credits left this month").wait_for(timeout=30000)
    page.wait_for_timeout(700)

run = uuid.uuid4().hex[:5]
LARA = f"lara.reyes.{run}@everyops.test"
BEN = f"ben.cruz.{run}@everyops.test"
PW = "Everyops-2026!"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    # 1. Pricing page, desktop and phone.
    anon = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme="dark", reduced_motion="reduce")
    page = anon.new_page()
    page.goto(BASE + "/pricing"); page.wait_for_timeout(1500)
    shot(page, "01-pricing-desktop", full=True)
    phone = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, color_scheme="dark", reduced_motion="reduce")
    pp = phone.new_page(); pp.goto(BASE + "/pricing"); pp.wait_for_timeout(1500)
    shot(pp, "02-pricing-phone")

    # 2. Throwaway inboxes can't sign up.
    page.goto(BASE + "/sign-up"); page.wait_for_load_state("networkidle"); page.wait_for_timeout(1500)
    page.get_by_label("Full name").fill("Temp Person")
    page.get_by_label("Work email").fill(f"temp{run}@mailinator.com")
    page.get_by_role("textbox", name="Password").fill(PW)
    page.get_by_role("textbox", name="Password").press("Enter")
    page.get_by_text("Temporary inboxes").wait_for(timeout=15000)
    shot(page, "03-signup-disposable-refused")
    note("disposable sign-up count", type("R", (), {"status": 200, "json": lambda s: {"users": sql(f"select count(*) from \"user\" where email = 'temp{run}@mailinator.com'")}})())

    # 3. A new free account: unverified, so AI is refused before any Gemini call.
    lara = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme="dark", reduced_motion="reduce")
    note("lara sign-up", post(lara, "/api/auth/sign-up/email", {"name": "Lara Reyes", "email": LARA, "password": PW}))
    lara_id = sql(f"select id from \"user\" where email = '{LARA}'")
    note("lara workspaces (starters seeded)", get(lara, "/api/workspaces"))
    ws = sql(f"select id from workspace where owner_id = '{lara_id}' and starter order by created_at limit 1")
    note("unverified AI checkup", get(lara, f"/api/ai/checkup?workspaceId={ws}&refresh=1"))
    lp = lara.new_page()
    account_page(lp)
    shot(lp, "04-plan-free-unverified", "#plan")

    # 4. Verify with the emailed link (no SMTP locally, so the dev log has it).
    time.sleep(1)
    log = open(LOG).read()
    links = re.findall(r"(http://localhost:3047/api/auth/verify-email\?token=[^\s]+)", log)
    assert links, "no verification link in the dev log"
    lp.goto(links[-1]); lp.wait_for_timeout(1500)
    note("lara verified", type("R", (), {"status": 200, "json": lambda s: {"emailVerified": sql(f"select \"emailVerified\" from \"user\" where id = '{lara_id}'")}})())

    # 5. A month of use (QA data): 87% of the Free allowance.
    seed_ai(lara_id, [("setup-design", "design", 2, 131000), ("setup-interview", "interview", 6, 25000), ("assistant", "assistant", 30, 14000), ("checkup", "checkup", 5, 8000)])
    account_page(lp)
    shot(lp, "05-plan-free-near-limit", "#plan")

    # 6. Out of credits: the next AI request is refused with the reason.
    seed_ai(lara_id, [("assistant", "assistant", 15, 14000)])
    note("out of credits AI checkup", get(lara, f"/api/ai/checkup?workspaceId={ws}&refresh=1"))

    # 7. Workspaces: Free includes one besides the starters.
    vid = sql(f"select max(version) from workspace_version where workspace_id = '{ws}'")
    bp = json.loads(sql(f"select blueprint from workspace_version where workspace_id = '{ws}' and version = {vid}"))
    meta = json.loads(sql(f"select doc from workspace where id = '{ws}'"))
    def new_ws(name):
        slug = f"qa-{name.lower().replace(' ', '-')}-{run}"
        m = dict(meta); m["name"] = name; m.pop("setup", None)
        return slug, lara.request.fetch(BASE + f"/api/workspaces/{slug}", method="PATCH",
            data=json.dumps({"create": True, "meta": m, "versions": [{"version": 1, "blueprint": bp}]}),
            headers={"content-type": "application/json", "origin": BASE})
    first, r1 = new_ws("Reyes Rentals"); note("first own workspace", r1)
    second, r2 = new_ws("Reyes Cafe"); note("second own workspace (Free allows 1)", r2)

    # 8. Team: Free allows 2 people per workspace, invites included.
    def invite(i):
        return {"token": f"qa{run}{i}", "email": f"staff{i}.{run}@everyops.test", "role": "staff", "invitedBy": "Lara Reyes", "invitedAt": "2026-10-26T00:00:00.000Z"}
    team = lambda n: lara.request.fetch(BASE + f"/api/workspaces/{first}", method="PATCH",
        data=json.dumps({"team": {"members": [], "invites": [invite(i) for i in range(n)]}}), headers={"content-type": "application/json", "origin": BASE})
    note("invite 2 (fits)", team(2))
    note("invite 3 (over Free's 2)", team(3))

    # 9. Records: Free allows 1,000 per workspace.
    entity = bp["entities"][0]["id"]
    sql(f"""insert into workspace_record (workspace_id, id, entity_id, data, created_at, updated_at)
      select '{first}', 'qa-' || g, '{entity}', '{{}}'::jsonb, now(), now() from generate_series(1, 2000 - (select count(*) from workspace_record where workspace_id = '{first}')) g""")
    rec = {"id": f"qa-new-{run}", "entityId": entity, "data": {}, "createdAt": "2026-10-26T00:00:00.000Z", "updatedAt": "2026-10-26T00:00:00.000Z"}
    note("record 2,001 (over Free's 2,000)", lara.request.fetch(BASE + f"/api/workspaces/{first}", method="PATCH",
        data=json.dumps({"records": {"put": [{"record": rec, "rev": None}], "delete": []}}), headers={"content-type": "application/json", "origin": BASE}))

    # 10. API keys: none on Free.
    note("API key on Free", post(lara, "/api/keys", {"name": "Zapier", "workspaces": None, "permissions": ["records:read"], "expiresInDays": None}))

    account_page(lp)
    shot(lp, "06-plan-free-limits-reached", "#plan")

    # 11. Ask to upgrade: no payment provider yet, so the team is told.
    lp.get_by_role("button", name="Upgrade").click()
    lp.get_by_role("heading", name="Choose a plan").wait_for()
    lp.wait_for_timeout(500)
    shot(lp, "07-upgrade-dialog")
    lp.locator("[data-plan=starter] button").click()
    lp.get_by_text("Online payment isn't available yet").first.wait_for(timeout=15000)
    lp.wait_for_timeout(500)
    shot(lp, "08-upgrade-requested")
    lp.keyboard.press("Escape")
    lp.get_by_role("button", name="Add credits").click()
    lp.get_by_role("heading", name="Add AI credits").wait_for(); lp.wait_for_timeout(400)
    shot(lp, "09-credit-packs")
    lp.keyboard.press("Escape")
    note("upgrade request logged", type("R", (), {"status": 200, "json": lambda s: {"events": sql(f"select kind || ' ' || detail::text from billing_event where user_id = '{lara_id}'")}})())
    note("webhook with no provider", post(lara, "/api/billing/webhook", {"type": "plan.activated"}))

    # 12. Another free account burns through a lot of AI: the daily safety switch pauses free AI.
    ben = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme="dark", reduced_motion="reduce")
    note("ben sign-up", post(ben, "/api/auth/sign-up/email", {"name": "Ben Cruz", "email": BEN, "password": PW}))
    ben_id = sql(f"select id from \"user\" where email = '{BEN}'")
    sql(f"update \"user\" set \"emailVerified\" = true where id = '{ben_id}'")
    get(ben, "/api/workspaces")
    bws = sql(f"select id from workspace where owner_id = '{ben_id}' and starter limit 1")
    seed_ai(ben_id, [("setup-design", "design", 230, 131000)])
    time.sleep(61)  # the day's spending is cached for a minute per instance
    note("free account while safety switch is on", get(ben, f"/api/ai/checkup?workspaceId={bws}&refresh=1"))

    # 13. Site admin: accounts, assign Starter + credits to Lara, suspend Ben.
    admin = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme="dark", reduced_motion="reduce")
    note("admin sign-in", post(admin, "/api/auth/sign-in/email", {"email": "james@everyops.app", "password": "everyops2026"}))
    ap = admin.new_page()
    ap.goto(BASE + f"/admin/accounts"); ap.get_by_text("AI spending today").wait_for(timeout=30000); ap.wait_for_timeout(800)
    shot(ap, "10-admin-accounts-safety-switch", full=True)
    ap.locator(f"tr[data-email='{LARA}'] button", has_text="Manage").click()
    ap.get_by_label("Plan").select_option("starter")
    ap.get_by_label("Add AI credits for this month").fill("2000")
    ap.get_by_label("Note (only admins see it)").fill("Paid ₱499 by GCash, ref 7781 (QA)")
    shot(ap, "11-admin-manage-account")
    ap.get_by_role("button", name="Save").click(); ap.wait_for_timeout(1500)
    note("ben suspended", post(admin, "/api/admin/accounts", {"userId": ben_id, "suspend": "Bulk AI use from many accounts (QA)"}))
    note("suspended account AI", get(ben, f"/api/ai/checkup?workspaceId={bws}&refresh=1"))
    note("non-admin on admin API", get(lara, "/api/admin/accounts"))
    ap.goto(BASE + f"/admin/accounts?email={LARA.split('@')[0][:10]}"); ap.wait_for_timeout(1500)

    # 14. Lara on Starter: more room, credits back, read-only API keys.
    account_page(lp)
    shot(lp, "12-plan-starter-after-admin", "#plan")
    note("starter: write key refused", post(lara, "/api/keys", {"name": "Zapier", "workspaces": None, "permissions": ["records:write"], "expiresInDays": None}))
    note("starter: read key allowed", post(lara, "/api/keys", {"name": "Reports", "workspaces": None, "permissions": ["records:read"], "expiresInDays": None}))
    note("starter: second own workspace", new_ws("Reyes Cafe Two")[1])
    note("lara plan usage", get(lara, "/api/account/plan"))
    bp_ = ben.new_page(); account_page(bp_); shot(bp_, "13-plan-suspended", "#plan")
    browser.close()

json.dump(proof, open(f"/tmp/eo-billing-proof.json", "w"), indent=1, default=str)
print("DONE", len(proof))

