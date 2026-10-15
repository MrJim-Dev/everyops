"use client";

import { type DesignStreamEvent, sketchOf } from "@/lib/assistant/design-sketch";
import { useSetupBuild } from "@/lib/store/setup-build";
import { type ChatTurn, type SetupDraft, useWorkspaces } from "@/lib/store/workspaces";

/**
 * Posts to a setup endpoint that answers in JSON lines and hands each line to onEvent until the final one
 * (type "done" or "error"), which it returns. Errors before the stream starts (sign-in, rate limit) come as JSON.
 */
export async function streamLines<T extends { type: string }>(
  url: string,
  body: unknown,
  onEvent: (event: T) => void,
): Promise<{ ok: true; last: T } | { ok: false; message: string }> {
  const dropped = "The connection dropped before EveryOps answered. Try again.";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("ndjson")) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, message: data?.message ?? "Something went wrong. Try again." };
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as T;
        if (event.type === "done" || event.type === "error") return { ok: true, last: event };
        onEvent(event);
      }
    }
    return { ok: false, message: dropped };
  } catch {
    return { ok: false, message: dropped };
  }
}

export type DesignOutcome =
  | { ok: true; draft: SetupDraft; messages: ChatTurn[] }
  | { ok: false; message: string };

/** Designs running now, by workspace. A design outlives the setup screen: leaving the page doesn't stop it. */
const runs = new Map<string, Promise<DesignOutcome>>();

/**
 * Designs a workspace and follows its progress in the shared build (see useSetupBuild), so the sidebar and the setup
 * screen show it wherever the owner is. Asking again while one runs joins it. The finished draft and its message are
 * saved with the setup conversation here, so the review is waiting even if setup wasn't open when it finished.
 */
export function designWorkspace(
  workspaceId: string,
  history: ChatTurn[],
  brief: string,
  workspaceName: string,
  attachments: unknown[],
  /** The community system the interview chose to start from, if any. */
  base?: string,
): Promise<DesignOutcome> {
  const running = runs.get(workspaceId);
  if (running) return running;
  const builds = useSetupBuild.getState();
  builds.setBuild(workspaceId, { stage: "design", since: Date.now() });
  const run = (async (): Promise<DesignOutcome> => {
    const streamed = await streamLines<DesignStreamEvent>(
      "/api/ai/design",
      { brief, workspaceName, attachments, ...(base ? { base } : {}) },
      (event) => {
        if (event.type === "stage")
          builds.setBuild(
            workspaceId,
            (b) =>
              b && {
                ...b,
                stage: event.stage,
                ...(event.issues ? { issues: event.issues } : {}),
                ...(event.from ? { from: event.from } : {}),
              },
          );
        else if (event.type === "sketch")
          builds.setBuild(workspaceId, (b) => b && { ...b, sketch: event.sketch });
      },
    );
    const last = streamed.ok ? streamed.last : null;
    if (last?.type !== "done") {
      builds.setBuild(workspaceId, null);
      return {
        ok: false,
        message: !streamed.ok
          ? streamed.message
          : last?.type === "error"
            ? last.message
            : "Something went wrong. Try again.",
      };
    }
    const draft = last.draft as SetupDraft;
    // A finished design holds for a moment: the checks run down the sidebar and the bar says it's ready.
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      builds.setBuild(workspaceId, (b) => b && { ...b, ready: true });
      await new Promise((resolve) => setTimeout(resolve, 1800));
    }
    const messages: ChatTurn[] = [
      ...history,
      {
        role: "assistant",
        text: `Here's ${draft.name}. Review it below, then create it, or tell me what to change.`,
      },
    ];
    const progress = useWorkspaces.getState().workspaces[workspaceId]?.setup?.progress;
    if (progress) useWorkspaces.getState().saveSetup(workspaceId, { ...progress, messages, draft });
    // The draft's pages take over the sidebar in the same moment, so the pages there stay put.
    const sketch = sketchOf(draft.data.blueprint, true);
    builds.setDraft(workspaceId, sketch ? { ...sketch, name: draft.name } : null);
    builds.setBuild(workspaceId, null);
    return { ok: true, draft, messages };
  })().finally(() => runs.delete(workspaceId));
  runs.set(workspaceId, run);
  return run;
}

/** Whether a design is running for this workspace. */
export const designing = (workspaceId: string) => runs.has(workspaceId);
