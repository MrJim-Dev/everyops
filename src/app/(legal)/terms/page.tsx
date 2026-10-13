import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

export default function Page() {
  return (
    <LegalPage title="Terms of Service" updated="October 13, 2026">
      <h2>Using EveryOps</h2>
      <p>
        EveryOps lets you describe your business and builds systems such as bookings, a register, content
        planning, finances and leave inside your workspace. You may use it for lawful business purposes.
      </p>
      <h2>Your account</h2>
      <p>Keep your password private. You are responsible for activity in your workspaces.</p>
      <h2>Your data</h2>
      <p>
        You own the records you put into EveryOps and the blueprints EveryOps designs for you. You can export
        both from workspace settings at any time.
      </p>
      <h2>Community systems</h2>
      <p>
        Community systems are shared under the license shown on each listing. Using one copies its blueprint
        into your workspace; your records are never shared.
      </p>
      <h2>AI-made changes</h2>
      <p>
        EveryOps shows every change before it is applied and keeps a history you can undo. Review changes
        before applying them, especially changes to prices or balances.
      </p>
      <h2>Availability</h2>
      <p>
        The prototype is provided as is, without guarantees of availability or fitness for a particular
        purpose.
      </p>
    </LegalPage>
  );
}
