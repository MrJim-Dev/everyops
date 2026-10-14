import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function Page() {
  return (
    <LegalPage title="Privacy Policy" updated="October 14, 2026">
      <h2>What we store</h2>
      <p>
        Your name, email, a salted hash of your password, and the workspaces, records and history you create.
      </p>
      <h2>Where it lives</h2>
      <p>
        Your account and workspaces are stored in a database on Google Cloud in Singapore (asia-southeast1).
        Pictures you add to records and pages are stored in Google Cloud Storage in the same region.
      </p>
      <h2>What we don't do</h2>
      <p>
        We don't sell your data, show ads, or share your records through community systems. Publishing a
        system shares its blueprint only.
      </p>
      <h2>AI processing</h2>
      <p>
        When you use Ask EveryOps or the assistant, your messages, the workspace you're working in, and any
        files you attach are sent to Gemini on Google Cloud (Vertex AI, asia-southeast1) to answer and to
        design or update your systems. Attached files are stored in Google Cloud Storage under your account
        and deleted 90 days after upload. Voice messages are turned into text and not stored.
      </p>
      <h2>Your choices</h2>
      <p>
        You can export your workspaces, change your password, or delete your account and its workspaces from
        account settings.
      </p>
    </LegalPage>
  );
}
