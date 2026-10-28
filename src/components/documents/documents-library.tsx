"use client";

import {
  ArrowSquareOutIcon,
  CloudArrowUpIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  ExportIcon,
  FileCsvIcon,
  FileDocIcon,
  FileIcon,
  FilePdfIcon,
  FileTextIcon,
  FileXlsIcon,
  FolderIcon,
  FolderSimplePlusIcon,
  ImageIcon,
  MusicNotesIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  TrashIcon,
  VideoIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNowStrict } from "date-fns";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from "@/components/views/search-input";
import { ViewEmpty } from "@/components/views/view-empty";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useCurrentUser } from "@/lib/auth/client";
import {
  type DocumentFilter,
  type DocumentsUsage,
  extOf,
  formatBytes,
  matchesFilter,
  type WorkspaceDocument,
} from "@/lib/documents";
import { deleteDocument, renameDocument, uploadDocument, useDocuments } from "@/lib/documents-client";
import { canEdit, canManage } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";

const FILTERS: { value: DocumentFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "documents", label: "Documents" },
  { value: "images", label: "Images" },
  { value: "videos", label: "Videos" },
  { value: "exports", label: "Exports" },
  { value: "records", label: "On records" },
];

type Uploading = { id: string; name: string; progress: number; error?: string };

/**
 * /w/[workspace]/documents: every file the workspace keeps in one list, uploads (documents, pictures, videos),
 * exports kept from tables and Settings, and files attached to records, with how much of the plan's storage they
 * take. Anyone on the team can open and download them; staff and up can add files.
 */
export function DocumentsLibrary() {
  const ws = useWorkspace();
  const me = useCurrentUser();
  const params = useSearchParams();
  const editor = ws.mode === "live" && canEdit(ws.role);
  const { documents, usage, status, setDocuments, reload } = useDocuments(ws.id);
  const [filter, setFilter] = useState<DocumentFilter>(
    FILTERS.some((f) => f.value === params.get("show")) ? (params.get("show") as DocumentFilter) : "all",
  );
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<WorkspaceDocument | null>(null);
  const [editing, setEditing] = useState<WorkspaceDocument | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const folders = useMemo(
    () => [...new Set(documents.map((d) => d.folder).filter((f): f is string => !!f))].sort(),
    [documents],
  );
  const q = query.trim().toLowerCase();
  const shown = documents.filter(
    (d) =>
      matchesFilter(d, filter) &&
      (folder === null || d.folder === folder) &&
      (!q || `${d.displayName} ${d.folder ?? ""} ${d.addedByName ?? ""}`.toLowerCase().includes(q)),
  );
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f.value, documents.filter((d) => matchesFilter(d, f.value)).length]),
  );

  const upload = async (files: File[]) => {
    if (!editor || !files.length) return;
    for (const file of files) {
      const id = crypto.randomUUID();
      setUploading((u) => [...u, { id, name: file.name, progress: 0 }]);
      const result = await uploadDocument(ws.id, file, {
        folder,
        onProgress: (progress) => setUploading((u) => u.map((x) => (x.id === id ? { ...x, progress } : x))),
      });
      if (result.ok) {
        setDocuments((d) => [result.document, ...d]);
        setUploading((u) => u.filter((x) => x.id !== id));
      } else setUploading((u) => u.map((x) => (x.id === id ? { ...x, error: result.message } : x)));
    }
    void reload();
  };

  const remove = async (doc: WorkspaceDocument) => {
    const result = await deleteDocument(ws.id, doc.name);
    if (!result.ok) return void toast.error(result.message);
    setDocuments((d) => d.filter((x) => x.name !== doc.name));
    toast.success(`${doc.displayName} deleted`);
    void reload();
  };
  const mayChange = (doc: WorkspaceDocument) =>
    ws.mode === "live" && (canManage(ws.role) || (editor && !!me && doc.addedBy === me.id));

  return (
    <section
      aria-label="Documents"
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
      onDragOver={(e) => {
        if (!editor || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (!editor) return;
        e.preventDefault();
        setDragging(false);
        void upload([...e.dataTransfer.files]);
      }}
    >
      <PageHeader
        title="Documents"
        description={`Every file in ${ws.name}: uploads, exports and files on records.`}
        className="border-b pb-3"
        actions={
          editor ? (
            <Button size="sm" onClick={() => picker.current?.click()}>
              <CloudArrowUpIcon data-icon="inline-start" />
              Upload
            </Button>
          ) : undefined
        }
      />
      <input
        ref={picker}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void upload([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-5">
        <StorageMeter usage={usage} />
        {uploading.length ? (
          <ul className="flex flex-col gap-2" aria-label="Uploads">
            {uploading.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-[13px]"
              >
                <CloudArrowUpIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {u.error ? (
                  <>
                    <span className="text-[12px] text-destructive">{u.error}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setUploading((x) => x.filter((y) => y.id !== u.id))}
                    >
                      Dismiss
                    </Button>
                  </>
                ) : (
                  <span className="flex w-40 items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary transition-[width] duration-200"
                        style={{ width: `${Math.round(u.progress * 100)}%` }}
                      />
                    </span>
                    <span className="w-9 text-right text-[12px] text-muted-foreground tabular">
                      {Math.round(u.progress * 100)}%
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label="Show"
            value={filter}
            onValueChange={(v) => setFilter(v as DocumentFilter)}
            className="flex-nowrap overflow-x-auto"
            options={FILTERS.map((f) => ({
              value: f.value,
              label: (
                <>
                  {f.label}
                  <span className="ml-1.5 text-[12px] font-normal text-muted-foreground tabular">
                    {counts[f.value]}
                  </span>
                </>
              ),
            }))}
          />
          <SearchInput value={query} onChange={setQuery} placeholder="Search documents" />
        </div>
        {folders.length || editor ? (
          <fieldset className="-mt-1 flex flex-wrap items-center gap-2">
            <legend className="sr-only">Folders</legend>
            <FolderChip active={folder === null} onClick={() => setFolder(null)}>
              All folders
            </FolderChip>
            {folders.map((f) => (
              <FolderChip key={f} active={folder === f} onClick={() => setFolder(folder === f ? null : f)}>
                <FolderIcon className="size-3.5" />
                {f}
              </FolderChip>
            ))}
            {editor ? <NewFolder onCreate={(f) => setFolder(f)} /> : null}
          </fieldset>
        ) : null}
        {status === "loading" ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : shown.length ? (
          <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card" aria-label="Files">
            {shown.map((d) => (
              <DocumentRow
                key={d.name}
                doc={d}
                onOpen={() =>
                  ["image", "video", "audio"].includes(d.kind) ? setPreview(d) : window.open(d.url, "_blank")
                }
                onEdit={mayChange(d) ? () => setEditing(d) : undefined}
                onDelete={mayChange(d) && d.source !== "record" ? () => void remove(d) : undefined}
              />
            ))}
          </ul>
        ) : (
          <ViewEmpty
            title={documents.length ? "No files match" : "No files yet"}
            description={
              documents.length
                ? "Try another filter, folder or word."
                : editor
                  ? "Upload contracts, photos, videos and spreadsheets, or drop them here. Exports you download are kept here too."
                  : "Files your team uploads and exports show up here."
            }
            actionLabel={!documents.length && editor ? "Upload files" : undefined}
            onAction={!documents.length && editor ? () => picker.current?.click() : undefined}
          />
        )}
      </div>
      {dragging ? (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-background/80 backdrop-blur-sm">
          <p className="flex items-center gap-2 text-[15px] font-medium">
            <CloudArrowUpIcon className="size-5 text-primary" />
            Drop to upload{folder ? ` to ${folder}` : ""}
          </p>
        </div>
      ) : null}
      <PreviewDialog doc={preview} onClose={() => setPreview(null)} />
      <EditDialog
        doc={editing}
        folders={folders}
        onClose={() => setEditing(null)}
        onSaved={(name, patch) => {
          setDocuments((d) => d.map((x) => (x.name === name ? { ...x, ...patch } : x)));
          setEditing(null);
        }}
      />
    </section>
  );
}

function StorageMeter({ usage }: { usage: DocumentsUsage | null }) {
  if (!usage) return <Skeleton className="h-[74px] w-full rounded-xl" />;
  const { workspaceBytes, limitBytes } = usage;
  const share = Math.min(1, workspaceBytes / limitBytes);
  const tight = share >= 0.9;
  return (
    <section aria-label="Storage" className="flex flex-col gap-2.5 rounded-xl border bg-card/60 px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13.5px]">
          <span className="font-semibold tabular">{formatBytes(workspaceBytes)}</span>
          <span className="text-muted-foreground"> of {formatBytes(limitBytes)} used</span>
        </p>
        <p className={cn("text-[12px]", tight ? "text-warning" : "text-muted-foreground")}>
          {tight
            ? "Almost full: delete files you no longer need to make room."
            : `${formatBytes(Math.max(0, limitBytes - workspaceBytes))} free`}
        </p>
      </div>
      <progress
        value={workspaceBytes}
        max={limitBytes}
        aria-label="Storage used"
        className={cn(
          "h-2 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-moz-progress-bar]:rounded-full",
          tight
            ? "[&::-webkit-progress-value]:bg-warning [&::-moz-progress-bar]:bg-warning"
            : "[&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary",
        )}
      />
    </section>
  );
}

function FolderChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "border-primary/50 bg-primary/10 text-foreground"
          : "text-muted-foreground hover:border-foreground/25 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function NewFolder({ onCreate }: { onCreate: (folder: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  return (
    <>
      <FolderChip active={false} onClick={() => setOpen(true)}>
        <FolderSimplePlusIcon className="size-3.5" />
        New folder
      </FolderChip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const clean = name.trim().slice(0, 60);
              if (!clean) return;
              onCreate(clean);
              setName("");
              setOpen(false);
              toast.success(`${clean} is open`, { description: "Files you upload now go into it." });
            }}
          >
            <Label htmlFor="new-folder">Name</Label>
            <Input
              id="new-folder"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contracts"
              autoFocus
            />
            <DialogFooter>
              <Button type="submit" disabled={!name.trim()}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DocIcon({ doc }: { doc: WorkspaceDocument }) {
  const ext = extOf(doc.name);
  const Icon =
    doc.kind === "image"
      ? ImageIcon
      : doc.kind === "video"
        ? VideoIcon
        : doc.kind === "audio"
          ? MusicNotesIcon
          : ext === "pdf"
            ? FilePdfIcon
            : ext === "xlsx"
              ? FileXlsIcon
              : ext === "csv"
                ? FileCsvIcon
                : ext === "docx"
                  ? FileDocIcon
                  : ext === "txt" || ext === "md"
                    ? FileTextIcon
                    : FileIcon;
  if (doc.kind === "image")
    return (
      // biome-ignore lint/performance/noImgElement: a private file served by the app, not a static asset
      <img
        src={`${doc.url}&inline=1`}
        alt=""
        loading="lazy"
        className="size-10 shrink-0 rounded-md border object-cover"
      />
    );
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
      <Icon className="size-5" />
    </span>
  );
}

function sourceLine(doc: WorkspaceDocument) {
  if (doc.source === "export")
    return (
      <span className="inline-flex items-center gap-1">
        <ExportIcon className="size-3" />
        Export{doc.addedByName ? ` by ${doc.addedByName}` : ""}
      </span>
    );
  if (doc.source === "record")
    return (
      <span className="inline-flex items-center gap-1">
        <PaperclipIcon className="size-3" />
        On a record{doc.addedByName ? ` · ${doc.addedByName}` : ""}
      </span>
    );
  return doc.addedByName ? `Uploaded by ${doc.addedByName}` : "Uploaded";
}

function DocumentRow({
  doc,
  onOpen,
  onEdit,
  onDelete,
}: {
  doc: WorkspaceDocument;
  onOpen: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <li className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/30">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-md"
      >
        <DocIcon doc={doc} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium">{doc.displayName}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
            <span className="tabular">{formatBytes(doc.bytes)}</span>
            <span aria-hidden>·</span>
            {sourceLine(doc)}
            {doc.folder ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <FolderIcon className="size-3" />
                  {doc.folder}
                </span>
              </>
            ) : null}
          </span>
        </span>
      </button>
      <span className="hidden shrink-0 text-[12px] text-muted-foreground tabular sm:block">
        {formatDistanceToNowStrict(new Date(doc.at), { addSuffix: true })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="icon" variant="ghost" aria-label={`More for ${doc.displayName}`} />}
        >
          <DotsThreeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onOpen}>
              <ArrowSquareOutIcon />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem render={<Anchor href={doc.url} download />}>
              <DownloadSimpleIcon />
              Download
            </DropdownMenuItem>
            {onEdit ? (
              <DropdownMenuItem onClick={onEdit}>
                <PencilSimpleIcon />
                Rename or move
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          {onDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <TrashIcon />
                Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function PreviewDialog({ doc, onClose }: { doc: WorkspaceDocument | null; onClose: () => void }) {
  const src = doc ? `${doc.url}&inline=1` : "";
  return (
    <Dialog open={!!doc} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{doc?.displayName}</DialogTitle>
        </DialogHeader>
        {doc?.kind === "image" ? (
          // biome-ignore lint/performance/noImgElement: a private file served by the app
          <img src={src} alt={doc.displayName} className="max-h-[70vh] w-full rounded-lg object-contain" />
        ) : doc?.kind === "video" ? (
          // biome-ignore lint/a11y/useMediaCaption: people's own videos come without captions
          <video src={src} controls autoPlay className="max-h-[70vh] w-full rounded-lg bg-black" />
        ) : doc?.kind === "audio" ? (
          // biome-ignore lint/a11y/useMediaCaption: people's own recordings come without captions
          <audio src={src} controls autoPlay className="w-full" />
        ) : null}
        <DialogFooter>
          {doc ? (
            <Button variant="outline" nativeButton={false} render={<Anchor href={doc.url} download />}>
              <DownloadSimpleIcon data-icon="inline-start" />
              Download
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  doc,
  folders,
  onClose,
  onSaved,
}: {
  doc: WorkspaceDocument | null;
  folders: string[];
  onClose: () => void;
  onSaved: (name: string, patch: { displayName: string; folder: string | null }) => void;
}) {
  const ws = useWorkspace();
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (doc && shownFor !== doc.name) {
    setShownFor(doc.name);
    setName(doc.displayName);
    setFolder(doc.folder ?? "");
  }
  const save = async () => {
    if (!doc || !name.trim()) return;
    const patch = { displayName: name.trim(), folder: folder.trim() || null };
    const result = await renameDocument(ws.id, doc.name, patch);
    if (!result.ok) return void toast.error(result.message);
    onSaved(doc.name, patch);
  };
  return (
    <Dialog open={!!doc} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename or move</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Label htmlFor="doc-name">Name</Label>
          <Input id="doc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          <Label htmlFor="doc-folder">Folder</Label>
          <Input
            id="doc-folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            list="doc-folders"
            placeholder="No folder"
            maxLength={60}
          />
          <datalist id="doc-folders">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A plain link for menu items and buttons that download (their own text is the link's content). */
function Anchor(props: React.ComponentProps<"a">) {
  return <a {...props} />;
}
