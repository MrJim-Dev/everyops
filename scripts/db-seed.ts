import { sql } from "kysely";
import { DEMO_ACCOUNT } from "@/lib/auth/demo";
import { auth } from "@/server/auth";
import { db } from "@/server/db";

/** Creates the demo account if it doesn't exist yet. */
async function main() {
  const existing = await sql<{
    id: string;
  }>`select id from "user" where email = ${DEMO_ACCOUNT.email}`.execute(db);
  if (existing.rows.length) {
    console.log(`Demo account ${DEMO_ACCOUNT.email} already exists.`);
  } else {
    await auth.api.signUpEmail({
      body: { name: DEMO_ACCOUNT.name, email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password },
    });
    console.log(`Created demo account ${DEMO_ACCOUNT.email}.`);
  }
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
