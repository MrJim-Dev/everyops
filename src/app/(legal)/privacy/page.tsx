import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function Page() {
  return (
    <LegalPage title="Privacy Policy" updated="October 13, 2026">
      <h2>What we store</h2>
      <p>
        Your name, email, a salted hash of your password, and the workspaces, records and history you create.
      </p>
      <h2>Where it lives</h2>
      <p>
        In this prototype, everything is stored in your browser on this device. Clearing site data removes it.
        Nothing is sent to a server.
      </p>
      <h2>What we don't do</h2>
      <p>
        We don't sell your data, show ads, or share your records through community systems. Publishing a
        system shares its blueprint only.
      </p>
      <h2>AI processing</h2>
      <p>
        When Gemini is connected, your descriptions and change requests will be sent to Google Cloud to design
        and update your systems. This page will be updated before that happens.
      </p>
      <h2>Your choices</h2>
      <p>
        You can export your workspaces, change your password, or delete your account and its workspaces from
        account settings.
      </p>
    </LegalPage>
  );
}
