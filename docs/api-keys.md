# API keys

Account → **API keys** makes keys for scripts, integrations and AI agents. They authenticate the public API (`/api/v1`) and, from #105, the MCP server.

- **Secret:** `eo_live_<8-char id>_<32 random chars>`, shown once after creating it. Only a SHA-256 hash is stored, looked up by hash on each request; secrets never reach logs.
- **Scope:** every workspace the account can open (including new ones), or a chosen list. A workspace outside the list answers 404, so a key can't tell which workspaces exist.
- **Permissions:** `records:read`, `records:write`, `pages:read`, `pages:write`, `design:propose`, `mcp`.
- **Role cap:** a key never does more than its owner's current role in a workspace (`allowedIn`): write permissions need staff or above, design proposals need admin or above. Demoting the owner takes effect on the key's next request; if the owner leaves a workspace, the key can't reach it.
- **Lifetime:** 30, 90 or 365 days, or no expiry. Revoking stops the key on its next request. Last use (time and IP) shows on the account page, updated at most once a minute.
- **Limits:** 25 active keys per account; 120 requests a minute per key (`API_KEY_RATE_LIMIT`), shared across instances.

```sh
curl https://everyops.app/api/v1/workspaces -H "Authorization: Bearer eo_live_…"
```

## For route authors

```ts
const { caller, error } = await apiCaller(request); // a key, else the browser session
if (error) return error;
const access = await workspaceAccess(caller, workspaceId, "records:write");
if (access.error) return access.error; // 404 out of scope, 403 not allowed
```

The app's own routes use `apiUser` and accept only the session. Keys are created and revoked only through `/api/keys` with a session, never with another key.
