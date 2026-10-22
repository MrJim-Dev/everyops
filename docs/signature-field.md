# Signature fields

Waivers, rental agreements, delivery receipts and job sign-offs needed a signature, and the closest field was a file upload: people had to sign on paper, photograph it and upload the photo.

## What owners get

- A **signature** field type: a pad people sign on with a finger, pen or mouse. Dark ink on white, sharp on phones and high-density screens, with **Clear**. A saved signature shows as its picture with **Sign again**, and in tables as a small picture.
- **Public forms** ask for it too, so a customer can sign a waiver or rental agreement on their own phone. The generated booking page has the same pad. Once saved, it says "✓ Signed" with "Sign again", so a redraw of the page never loses it.
- **Required** works like any field ("Renter signature is required").

## Privacy

A signature is stored as a PNG in the workspace's private documents (`/api/files/<workspace>/docs/<uuid>.png`), like a file field's, and served only to people on the workspace's team. Anyone else gets 404, including the visitor who signed. Signature fields count as personal data (`personalField`): public pages, shared tables and public layouts never show them. Text outputs (emails, CSV, MCP and REST text) say "Signed" and never include the image.

The public upload stores a drawing as a signature only when the form asks for one, the upload is named `Signature.png`, and its bytes are a PNG. A public submission only accepts a signature this workspace's public upload stored. The app's own pad uploads through the existing `/api/uploads` (`kind=file`).

## AI

The designer's schema is near Gemini's structural limit, so it gets no new type value. A file field named like a signature ("Signature", "Staff signature", "Renter signature", "E-signature", "Signed by") becomes a signature field, both in setup (`toEntity`) and in Ask EveryOps (`add_field`, `add_entity`). This is the same approach as a text field named "Email" becoming an email field. Names like "Signed contract" or "Signature date" stay files. Both prompts say how to ask for one. When setup starts from a template that has a signature field, the design sent to Gemini carries it as a file named Signature (`designEntities`), and it comes back as a signature.

## Verification, 2026-10-22

Local dev server against an isolated PostgreSQL 17 and a local Cloud Storage stand-in (`STORAGE_EMULATOR_HOST`, bucket `qa-local-uploads`; nothing was written to the production bucket). Synthetic workspace from `scripts/qa-signature.mts` (kayak rentals with a required renter signature and a public "Sign the rental agreement" form). Chrome through Playwright, no page errors. Screenshots are in `docs/pr-screenshots/signature-field/`.

- Saving a new rental without a signature showed "Renter signature is required". After signing on the pad it saved, and the record panel and the table showed the signature.
- The signature's URL returned `200 image/png` to the signed-in owner and `404` to an anonymous request.
- On a phone-sized screen (430 × 932, touch), the public form took a drawn signature ("Signed"), submitted, and the rental appeared in the team's table with its signature.
- Real Vertex (`gemini-3.7-flash`): "Add a Returns page to log each kayak return, with the renter's name, the condition, and a staff signature when it's checked in." planned a Return record type in 26 s. After Apply, its "Staff signature" field is `type: "signature"` and the New return form shows the pad. The first run of this request came back with "Staff signature" as a plain file field, which is how the naming rule was widened to any name ending in "signature".
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

Not covered: owner-designed custom HTML pages (`formSnippet` leaves a note instead of a pad, so keep signature fields optional on forms that use one), showing signatures as pictures in print templates (#139 prints "Signed" until they're merged and wired together), and a deployed environment with the real bucket.

