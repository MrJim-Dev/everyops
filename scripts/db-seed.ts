import { sql } from "kysely";
import { DEMO_ACCOUNT } from "@/lib/auth/demo";
import { CATALOG } from "@/lib/catalog";
import { DEMO_WORKSPACES } from "@/lib/catalog/demo-workspaces";
import { describeBlueprint } from "@/lib/community/describe";
import { todayKey } from "@/lib/time";
import { auth } from "@/server/auth";
import { upsertOfficial } from "@/server/community";
import { db } from "@/server/db";
import { upsertWorkspaceTemplate } from "@/server/workspaces";

/**
 * Loads the starter templates (official community systems and demo workspaces) and the demo
 * account. Safe to run repeatedly: templates are refreshed in place.
 */
async function main() {
  const now = new Date();
  const builtOn = todayKey(now);

  for (const system of CATALOG) {
    const sample = system.sample(now, system.name);
    await upsertOfficial(system.id, {
      name: system.name,
      summary: system.summary,
      category: system.category,
      icon: system.icon,
      author: system.author,
      license: system.license,
      version: system.version,
      uses: system.uses,
      includes: system.includes.length ? system.includes : describeBlueprint(sample.blueprint),
      blueprint: sample.blueprint,
      sample: { records: sample.records, builtOn },
    });
  }
  console.log(`Official community systems: ${CATALOG.length}`);

  for (const [sort, demo] of DEMO_WORKSPACES.entries()) {
    await upsertWorkspaceTemplate({
      id: demo.slug,
      name: demo.name,
      summary: demo.summary,
      sourceSystemId: demo.sourceId,
      sort,
      data: demo.build(now),
      builtOn,
    });
  }
  console.log(`Workspace templates: ${DEMO_WORKSPACES.length}`);

  const existing = await sql<{
    id: string;
  }>`select id from "user" where email = ${DEMO_ACCOUNT.email}`.execute(db);
  if (!existing.rows.length) {
    await auth.api.signUpEmail({
      body: { name: DEMO_ACCOUNT.name, email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password },
    });
    console.log(`Created demo account ${DEMO_ACCOUNT.email}.`);
  } else console.log(`Demo account ${DEMO_ACCOUNT.email} exists.`);
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
