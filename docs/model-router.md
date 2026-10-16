# Model test router

EveryOps runs on Gemini. The test router can send some or all AI tasks to Claude so the two can be compared on the same requests: answer quality, speed, failures and cost. Gemini stays the default, and the router reads its settings on every call, so going back to Gemini is an environment change only.

## Settings

| Variable | Effect |
|---|---|
| `AI_PROVIDER=claude` | Every task goes to Claude (default `gemini`). |
| `AI_PROVIDER_TASKS=assistant*=claude,design*=gemini` | Per task; a trailing `*` matches a prefix. Wins over `AI_PROVIDER`. Task names are in `src/lib/ai-usage.ts`. |
| `CLAUDE_MODEL` | Default `claude-haiku-4-5@20251001`. |
| `CLAUDE_DESIGN_MODEL` | For setup's design tasks, e.g. `claude-sonnet-4-5@20250929` (default: `CLAUDE_MODEL`). |
| `CLAUDE_LOCATION` | Vertex endpoint, default `global`. |
| `ANTHROPIC_API_KEY` | Call Anthropic's API instead of Vertex AI (the model's `@version` is dropped). |

Voice notes always stay with Gemini (Claude doesn't take audio), and so does any call carrying a file other than a photo or a PDF.

## How Claude is called

`src/server/ai/claude.ts` keeps `generateJson`'s contract, so no caller changes. The answer is a forced call to an `answer` tool whose input schema is the task's schema; the assistant's record lookups are offered as tools in the same request, and the last round must answer. The system prompt is marked for prompt caching. Streaming, the runaway and stall checks, hedged retries and the usage log work as they do for Gemini. Claude's extended thinking can't be combined with a forced tool, so `thinking` levels are ignored on this path.

## Comparing

Every call lands in `ai_call` with its model, so **Settings → AI use → Model** shows the two side by side (calls, tokens, wasted spend, cost). For a fixed batch:

```bash
AI_PROVIDER=claude pnpm dev                                      # then, in another terminal:
pnpm eval:assistant                                              # same requests, Claude's answers
AI_PROVIDER=claude EVAL_ONLY=courts EVAL_REPEAT=1 pnpm eval:design  # one design brief on Claude
```

## Access on Vertex AI

Claude is a partner model on Vertex. Before it answers, the project needs the model enabled in Model Garden (Anthropic's terms) and a non-zero quota for `global_online_prediction_requests_per_base_model` on `anthropic-claude-haiku-4-5`. Until then calls fail with `429 RESOURCE_EXHAUSTED` (logged as `rate-limited`). Free-trial billing accounts may not be granted partner-model quota; `ANTHROPIC_API_KEY` is the alternative.
