"use client";

import { CheckIcon, PencilSimpleIcon, PlusIcon, SparkleIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  KIND_LABEL,
  MAX_INSTRUCTIONS,
  MAX_NOTE_CHARS,
  MEMORY_KINDS,
  type MemoryKind,
  type MemoryNote,
  type WorkspaceMemory,
} from "@/lib/assistant/memory";
import {
  type AssistantPermissions,
  AUTONOMY_INFO,
  AUTONOMY_LEVELS,
  type Autonomy,
  DEFAULT_PERMISSIONS,
} from "@/lib/assistant/permissions";
import { formatDateTime } from "@/lib/format";
import { canManage } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { SettingsPage, SettingsSection } from "./settings-section";

const SOURCE: Record<MemoryNote["source"], string> = {
  setup: "From setup",
  assistant: "Learned in chat",
  owner: "Added by your team",
};

type Draft = { id?: string; kind: MemoryKind; text: string };

/** Settings → Assistant: what Ask EveryOps may do on its own, the owner's instructions and its memory. */
export function AssistantSettings() {
  const ws = useWorkspace();
  const manager = canManage(ws.role);
  const [memory, setMemory] = useState<WorkspaceMemory | null>(null);
  const [instructions, setInstructions] = useState("");
  const [perms, setPerms] = useState<AssistantPermissions>(DEFAULT_PERMISSIONS);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [fresh, setFresh] = useState<Draft>({ kind: "business", text: "" });
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/workspaces/${ws.id}/memory`)
      .then((r) => r.json())
      .then((body: { ok: boolean; memory?: WorkspaceMemory }) => {
        if (!live || !body.ok || !body.memory) return;
        setMemory(body.memory);
        setInstructions(body.memory.instructions);
        setPerms(body.memory.permissions);
      })
      .catch(() => toast.error("Couldn't load the assistant's memory"));
    return () => {
      live = false;
    };
  }, [ws.id]);

  const save = useCallback(
    async (
      next: { instructions: string; notes: Draft[]; permissions?: AssistantPermissions },
      done: string,
    ) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/workspaces/${ws.id}/memory`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        });
        const body = (await res.json()) as { ok: boolean; memory?: WorkspaceMemory; message?: string };
        if (!body.ok || !body.memory) throw new Error(body.message ?? "Couldn't save");
        setMemory(body.memory);
        setInstructions(body.memory.instructions);
        setPerms(body.memory.permissions);
        toast.success(done);
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't save");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [ws.id],
  );

  if (!memory)
    return (
      <SettingsPage>
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </SettingsPage>
    );

  const toDrafts = (notes: MemoryNote[]): Draft[] => notes.map(({ id, kind, text }) => ({ id, kind, text }));

  const draft = async () => {
    setDrafting(true);
    try {
      const res = await fetch(`/api/workspaces/${ws.id}/memory/draft`, { method: "POST" });
      const body = (await res.json()) as { ok: boolean; notes?: Draft[]; message?: string };
      if (!body.ok || !body.notes) throw new Error(body.message ?? "Couldn't draft notes");
      setDrafts(body.notes);
      setPicked(body.notes.map((_, i) => i));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't draft notes");
    } finally {
      setDrafting(false);
    }
  };
  const changed = instructions.trim() !== memory.instructions.trim();
  const permsChanged = JSON.stringify(perms) !== JSON.stringify(memory.permissions);
  const saveNotes = (notes: Draft[], done: string) =>
    save({ instructions: memory.instructions, notes }, done);

  return (
    <SettingsPage>
      <SettingsSection
        title="Permissions"
        description="How much Ask EveryOps may do on its own. People's roles still apply, and anything it applies is saved to History so it can be undone."
        footer={
          manager
            ? "Applies to everyone who uses the assistant in this workspace."
            : "Only the owner or an admin can change the permissions."
        }
        action={
          manager ? (
            <Button
              size="sm"
              variant={permsChanged ? "default" : "outline"}
              disabled={!permsChanged || saving}
              onClick={() =>
                void save(
                  { instructions: memory.instructions, notes: toDrafts(memory.notes), permissions: perms },
                  "Permissions saved",
                )
              }
            >
              Save
            </Button>
          ) : null
        }
      >
        <RadioGroup
          aria-label="What the assistant may do on its own"
          value={perms.autonomy}
          disabled={!manager}
          onValueChange={(value) => setPerms({ ...perms, autonomy: value as Autonomy })}
          className="gap-0 divide-y overflow-hidden rounded-lg border"
        >
          {AUTONOMY_LEVELS.map((level) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: the radio inside is the control
            <label
              key={level}
              className={cn(
                "flex cursor-pointer items-start gap-3 px-3.5 py-3 transition-colors hover:bg-foreground/[0.02]",
                perms.autonomy === level && "bg-primary/[0.06]",
              )}
            >
              <RadioGroupItem value={level} className="mt-0.5" />
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[13.5px] font-medium">
                  {AUTONOMY_INFO[level].label}
                  {level === "ask" ? (
                    <span className="rounded border px-1.5 py-px text-[10.5px] font-normal text-muted-foreground">
                      Default
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">
                  {AUTONOMY_INFO[level].detail}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
        <div className="divide-y rounded-lg border">
          <ToggleRow
            title="Always ask before removing"
            detail="Deleting records, pages, fields or record types waits for approval, whatever the level above."
            checked={perms.confirmDeletes}
            disabled={!manager || perms.autonomy === "read_only" || perms.autonomy === "ask"}
            onChange={(confirmDeletes) => setPerms({ ...perms, confirmDeletes })}
          />
          <ToggleRow
            title="Learn from conversations"
            detail="Saves business facts, preferences and plans people mention to the memory below."
            checked={perms.learn}
            disabled={!manager}
            onChange={(learn) => setPerms({ ...perms, learn })}
          />
        </div>
      </SettingsSection>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) void save({ instructions, notes: toDrafts(memory.notes) }, "Instructions saved");
        }}
      >
        <SettingsSection
          title="Instructions"
          description="Ask EveryOps follows these in every conversation, for everyone on the team: how to talk, what to call things, what to always or never do."
          footer={
            manager
              ? `${instructions.length.toLocaleString()} / ${MAX_INSTRUCTIONS.toLocaleString()} characters`
              : "Only the owner or an admin can change the instructions."
          }
          action={
            manager ? (
              <Button
                type="submit"
                size="sm"
                variant={changed ? "default" : "outline"}
                disabled={!changed || saving}
              >
                Save
              </Button>
            ) : null
          }
        >
          <Textarea
            aria-label="Instructions for Ask EveryOps"
            className="min-h-32 text-[13.5px]"
            maxLength={MAX_INSTRUCTIONS}
            readOnly={!manager}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={
              "e.g. Call our customers members. Prices are VAT-inclusive. Always ask before deleting records. Reply in English with Tagalog terms where natural."
            }
          />
        </SettingsSection>
      </form>
      <SettingsSection
        title="Memory"
        description="What Ask EveryOps knows about your business. It starts with what you told it during setup and adds what people mention in chat, so it can plan ahead and keep every page in step."
        footer={
          memory.updatedAt
            ? `${memory.notes.length} notes · updated ${formatDateTime(memory.updatedAt)}`
            : "Nothing saved yet."
        }
        action={
          manager ? (
            <Button size="sm" variant="outline" disabled={drafting} onClick={() => void draft()}>
              <SparkleIcon data-icon="inline-start" className={cn(drafting && "animate-pulse")} />
              {drafting ? "Reading the workspace…" : "Draft from workspace"}
            </Button>
          ) : null
        }
      >
        {drafts ? (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
            <p className="text-[13px] font-medium">
              {drafts.length
                ? `Drafted from ${ws.name}: keep what's right`
                : "Nothing new to add: the memory already covers what the workspace shows."}
            </p>
            {drafts.map((d, i) => (
              // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is the control
              <label key={d.text} className="flex cursor-pointer items-start gap-2.5 text-[13px]">
                <Checkbox
                  className="mt-0.5"
                  checked={picked.includes(i)}
                  onCheckedChange={(on) => setPicked(on ? [...picked, i] : picked.filter((x) => x !== i))}
                />
                <span className="min-w-0">
                  {d.text}
                  <span className="ml-1.5 text-[11.5px] text-muted-foreground">{KIND_LABEL[d.kind]}</span>
                </span>
              </label>
            ))}
            <div className="flex gap-2 pt-1">
              {drafts.length ? (
                <Button
                  size="sm"
                  disabled={!picked.length || saving}
                  onClick={async () => {
                    const kept = drafts.filter((_, i) => picked.includes(i));
                    const label = `${kept.length} ${kept.length === 1 ? "note" : "notes"} added`;
                    if (await saveNotes([...toDrafts(memory.notes), ...kept], label)) setDrafts(null);
                  }}
                >
                  Add {picked.length} {picked.length === 1 ? "note" : "notes"}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setDrafts(null)}>
                {drafts.length ? "Discard" : "Close"}
              </Button>
            </div>
          </div>
        ) : null}
        {MEMORY_KINDS.map((kind) => {
          const notes = memory.notes.filter((n) => n.kind === kind);
          return (
            <div key={kind} className="flex flex-col gap-1.5">
              <h3 className="text-[12px] font-medium text-muted-foreground">{KIND_LABEL[kind]}</h3>
              {notes.length ? (
                <ul className="divide-y rounded-lg border">
                  {notes.map((n) => (
                    <li key={n.id} className="flex items-start gap-3 px-3 py-2.5">
                      {editing === n.id ? (
                        <form
                          className="flex min-w-0 flex-1 items-center gap-2"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const next = toDrafts(memory.notes).map((d) =>
                              d.id === n.id ? { ...d, text: editText } : d,
                            );
                            if (await saveNotes(next, "Note saved")) setEditing(null);
                          }}
                        >
                          <Input
                            aria-label="Note"
                            autoFocus
                            className="h-8 flex-1 text-[13.5px]"
                            maxLength={MAX_NOTE_CHARS}
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                          />
                          <Button type="submit" size="icon-sm" aria-label="Save note" disabled={saving}>
                            <CheckIcon />
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Cancel"
                            onClick={() => setEditing(null)}
                          >
                            <XIcon />
                          </Button>
                        </form>
                      ) : (
                        <>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13.5px] leading-snug">{n.text}</p>
                            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{SOURCE[n.source]}</p>
                          </div>
                          {manager ? (
                            <div className="flex shrink-0 gap-1">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Edit "${n.text}"`}
                                onClick={() => {
                                  setEditing(n.id);
                                  setEditText(n.text);
                                }}
                              >
                                <PencilSimpleIcon />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Forget "${n.text}"`}
                                disabled={saving}
                                onClick={() =>
                                  void saveNotes(
                                    toDrafts(memory.notes.filter((x) => x.id !== n.id)),
                                    "Note forgotten",
                                  )
                                }
                              >
                                <TrashIcon />
                              </Button>
                            </div>
                          ) : null}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed px-3 py-2.5 text-[12.5px] text-muted-foreground">
                  Nothing yet.
                </p>
              )}
            </div>
          );
        })}
        {manager ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!fresh.text.trim()) return;
              if (await saveNotes([...toDrafts(memory.notes), fresh], "Note added"))
                setFresh({ kind: fresh.kind, text: "" });
            }}
          >
            <NativeSelect
              aria-label="Kind of note"
              value={fresh.kind}
              onChange={(e) => setFresh({ ...fresh, kind: e.target.value as MemoryKind })}
            >
              {MEMORY_KINDS.map((k) => (
                <NativeSelectOption key={k} value={k}>
                  {KIND_LABEL[k]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              aria-label="New note"
              className="h-8 min-w-[220px] flex-1 text-[13.5px]"
              maxLength={MAX_NOTE_CHARS}
              placeholder="e.g. Open 6 AM to 10 PM daily; peak hours are 5 to 9 PM"
              value={fresh.text}
              onChange={(e) => setFresh({ ...fresh, text: e.target.value })}
            />
            <Button type="submit" size="sm" variant="outline" disabled={!fresh.text.trim() || saving}>
              <PlusIcon data-icon="inline-start" />
              Add note
            </Button>
          </form>
        ) : null}
      </SettingsSection>
    </SettingsPage>
  );
}

function ToggleRow({
  title,
  detail,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the switch inside is the control
    <label className="flex cursor-pointer items-center justify-between gap-4 px-3.5 py-3">
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{detail}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </label>
  );
}
