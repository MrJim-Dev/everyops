# REST API (v1)

The public API lives under `/api/v1` and is described by `src/lib/api/openapi.ts`, served as `/api/v1/openapi.json` and rendered at `/developers`. Keys come from Account → API keys (`docs/api-keys.md`).

- **Same engine as MCP.** Handlers call `runTool` (`src/server/mcp/tools.ts`) through `restRoute` (`src/server/rest.ts`), so access checks, value coercion (`coerceValues`) and record writes (`writeRecord`: workspace lock, validation, booking conflicts, reference numbers, save automations) match the MCP tools exactly. Add a capability as a tool first, then a route.
- **Shapes.** Success is `{ data, meta? }`; failure is `{ error: { code, message, details? } }` with 400 invalid, 401, 403 forbidden, 404 not_found (also for workspaces outside the key), 409 conflict, 413 too_large, 429 rate_limited. A record is flat: `id`, every field by id, `rev`, and `linkedNames` on reads. Choices come back as ids; the schema lists each choice's id and label, and writes take either.
- **Pagination.** `cursor` is opaque (`src/lib/api/params.ts`); clients follow `meta.nextCursor`. Up to 50 a page.
- **Concurrency.** Writes take `rev` (body, `?rev=` or `If-Match`). A stale rev writes nothing and answers 409 with `error.details.current`.
- **Pages.** `PUT /pages/{viewId}` saves document and custom HTML page text through `writePages` (the replaced text is kept as a version). HTML pages are public code, so only owners and admins may change them, as in the app.
- **Client.** `src/lib/api/client.ts` has one method per operation and no dependencies; `scripts/api-example.mts` runs list, create, update, a stale-rev conflict and delete against any server.
- **Contract.** `src/lib/api/openapi.test.ts` fails when a route file and the spec disagree on paths or methods, when an operation has no client method, or when a $ref doesn't resolve. v1 only gains endpoints and optional fields; anything breaking goes in `/api/v2`.
