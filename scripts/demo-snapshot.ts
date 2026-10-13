import { db } from "@/server/db";
import { snapshotDemoAccount } from "@/server/demo";

/** Saves the demo account's current workspaces as what the nightly reset restores. */
snapshotDemoAccount()
  .then(async (result) => {
    console.log(
      result.ok ? `Saved ${result.workspaces} demo workspaces as the reset point.` : result.message,
    );
    await db.destroy();
  })
  .catch(async (error) => {
    console.error(error);
    await db.destroy();
    process.exit(1);
  });
