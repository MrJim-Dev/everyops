"use client";

import {
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  ArrowUpRightIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CircleIcon,
  CopyIcon,
  CornersOutIcon,
  DownloadSimpleIcon,
  ImageIcon,
  LineSegmentIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  NoteIcon,
  SquareIcon,
  StarIcon,
  TextTIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import Konva from "konva";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Arrow,
  Ellipse,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Star,
  Text,
  Transformer,
} from "react-konva";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { type CanvasShape, LABELS, newShape, parseCanvas, type ShapeType } from "@/lib/canvas/model";
import { canEdit } from "@/lib/store/workspaces";
import { uploadImage } from "@/lib/uploads";
import { cn } from "@/lib/utils";

const SAVE_DELAY = 700;
const HISTORY = 60;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const TEXT_TYPES = new Set<ShapeType>(["text", "note"]);
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Loads an uploaded picture for Konva. Same-origin, so PNG export keeps working. */
function useImage(src: string | undefined) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return setImage(null);
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.src = src;
  }, [src]);
  return image;
}

/**
 * A canvas page modelled on Konva's Canvas Editor demo: add shapes, text, sticky notes, arrows and pictures; select,
 * drag, resize and rotate them; edit text in place; reorder, duplicate and delete; undo and redo; zoom and pan; and
 * export a PNG. Changes save to the workspace a moment after they're made.
 */
export function CanvasEditor({ viewId, name }: { viewId: string; name: string }) {
  const ws = useWorkspace();
  const editable = canEdit(ws.role);
  const [shapes, setShapes] = useState<CanvasShape[]>(() => parseCanvas(ws.docs[viewId]?.body).shapes);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const history = useRef<{ past: CanvasShape[][]; future: CanvasShape[][] }>({ past: [], future: [] });
  const [, bump] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const transformer = useRef<Konva.Transformer>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const font = useMemo(
    () => (typeof document === "undefined" ? "sans-serif" : getComputedStyle(document.body).fontFamily),
    [],
  );

  /* ---------- Saving and history ---------- */
  const saved = useRef(ws.docs[viewId]?.body ?? "");
  useEffect(() => {
    if (!editable) return;
    const body = JSON.stringify({ version: 1, shapes });
    if (body === saved.current || (!shapes.length && !saved.current)) return;
    const timer = setTimeout(() => {
      saved.current = body;
      ws.saveDoc(viewId, body);
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [shapes, editable, viewId, ws.saveDoc]);

  const commit = useCallback((next: CanvasShape[] | ((s: CanvasShape[]) => CanvasShape[])) => {
    setShapes((current) => {
      const value = typeof next === "function" ? next(current) : next;
      if (value === current) return current;
      history.current.past = [...history.current.past.slice(-HISTORY), current];
      history.current.future = [];
      bump((n) => n + 1);
      return value;
    });
  }, []);
  const undo = useCallback(() => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    setShapes((current) => {
      h.future.push(current);
      return prev;
    });
    setSelected([]);
    bump((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    setShapes((current) => {
      h.past.push(current);
      return next;
    });
    setSelected([]);
    bump((n) => n + 1);
  }, []);
  const update = useCallback(
    (id: string, patch: Partial<CanvasShape>) =>
      commit((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s))),
    [commit],
  );

  /* ---------- Layout ---------- */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!shapes.length) return setView({ x: size.width / 2, y: size.height / 2, scale: 1 });
    const minX = Math.min(...shapes.map((s) => s.x));
    const minY = Math.min(...shapes.map((s) => s.y));
    const maxX = Math.max(...shapes.map((s) => s.x + s.width));
    const maxY = Math.max(...shapes.map((s) => s.y + s.height));
    const scale = clampZoom(
      Math.min(1.5, (size.width - 120) / (maxX - minX || 1), (size.height - 120) / (maxY - minY || 1)),
    );
    setView({
      scale,
      x: size.width / 2 - ((minX + maxX) / 2) * scale,
      y: size.height / 2 - ((minY + maxY) / 2) * scale,
    });
  }, [shapes, size]);
  // Open with everything in view.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || size.width < 50) return;
    fitted.current = true;
    fit();
  }, [fit, size.width]);

  const center = () => ({
    x: (size.width / 2 - view.x) / view.scale,
    y: (size.height / 2 - view.y) / view.scale,
  });
  const zoomBy = (factor: number, at = { x: size.width / 2, y: size.height / 2 }) =>
    setView((v) => {
      const scale = clampZoom(v.scale * factor);
      const point = { x: (at.x - v.x) / v.scale, y: (at.y - v.y) / v.scale };
      return { scale, x: at.x - point.x * scale, y: at.y - point.y * scale };
    });

  /* ---------- Adding ---------- */
  const add = (type: ShapeType, extra: Partial<CanvasShape> = {}) => {
    const c = center();
    const offset = ((shapes.length % 6) - 2.5) * 40;
    const shape = newShape(type, c.x + offset, c.y + offset, extra);
    commit((list) => [...list, shape]);
    setSelected([shape.id]);
  };
  const addImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const src = await uploadImage(file, ws);
      const img = new window.Image();
      img.onload = () => {
        const w = Math.min(420, img.width);
        add("image", { src, width: w, height: (img.height / img.width) * w });
      };
      img.src = src;
    } catch (error) {
      toast("Couldn't add the picture", { description: (error as Error).message });
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  /* ---------- Selection ---------- */
  // biome-ignore lint/correctness/useExhaustiveDependencies: shapes re-render their nodes, so reattach the handles
  useEffect(() => {
    const tr = transformer.current;
    const st = stage.current;
    if (!tr || !st) return;
    tr.nodes(selected.map((id) => st.findOne(`#${id}`)).filter((n): n is Konva.Node => !!n));
    tr.getLayer()?.batchDraw();
  }, [selected, shapes]);

  const select = (id: string, additive: boolean) =>
    setSelected((s) => (additive ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));
  const removeSelected = () => {
    if (!selected.length) return;
    commit((list) => list.filter((s) => !selected.includes(s.id)));
    setSelected([]);
  };
  const duplicate = () => {
    const copies = shapes
      .filter((s) => selected.includes(s.id))
      .map((s) => ({ ...s, id: newShape(s.type, 0, 0).id, x: s.x + 24, y: s.y + 24 }));
    if (!copies.length) return;
    commit((list) => [...list, ...copies]);
    setSelected(copies.map((c) => c.id));
  };
  const reorder = (to: "front" | "back") =>
    commit((list) => {
      const picked = list.filter((s) => selected.includes(s.id));
      const rest = list.filter((s) => !selected.includes(s.id));
      return to === "front" ? [...rest, ...picked] : [...picked, ...rest];
    });

  /* ---------- Keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!box.current?.closest("main")?.contains(target) && target !== document.body) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (editable) (e.shiftKey ? redo : undo)();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        if (editable) redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (editable) duplicate();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(shapes.map((s) => s.id));
      } else if ((e.key === "Delete" || e.key === "Backspace") && editable && selected.length) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === "Escape") setSelected([]);
      else if (editable && selected.length && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        commit((list) => list.map((s) => (selected.includes(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------- Export ---------- */
  const exportPng = () => {
    const st = stage.current;
    const content = st?.findOne<Konva.Layer>("#content");
    if (!st || !content || !shapes.length) return toast("Add something to the canvas first.");
    const tr = transformer.current;
    tr?.hide();
    const rect = content.getClientRect();
    // Export on the page's own background so light text and notes stay readable.
    const scale = st.scaleX();
    const backdrop = new Konva.Rect({
      x: (rect.x - 24 - st.x()) / scale,
      y: (rect.y - 24 - st.y()) / scale,
      width: (rect.width + 48) / scale,
      height: (rect.height + 48) / scale,
      fill: getComputedStyle(document.body).getPropertyValue("--background").trim() || "#0b0b0c",
    });
    content.add(backdrop);
    backdrop.moveToBottom();
    const url = st.toDataURL({
      x: rect.x - 24,
      y: rect.y - 24,
      width: rect.width + 48,
      height: rect.height + 48,
      pixelRatio: 2 / view.scale,
    });
    backdrop.destroy();
    tr?.show();
    const link = document.createElement("a");
    link.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "canvas"}.png`;
    link.href = url;
    link.click();
  };

  const one = selected.length === 1 ? shapes.find((s) => s.id === selected[0]) : undefined;
  const editingShape = editingText ? shapes.find((s) => s.id === editingText) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b px-3 py-1.5">
        {editable ? (
          <>
            <Tool label="Rectangle" onClick={() => add("rect")} icon={<SquareIcon />} />
            <Tool label="Ellipse" onClick={() => add("ellipse")} icon={<CircleIcon />} />
            <Tool label="Star" onClick={() => add("star")} icon={<StarIcon />} />
            <Tool label="Text" onClick={() => add("text")} icon={<TextTIcon />} />
            <Tool label="Sticky note" onClick={() => add("note")} icon={<NoteIcon />} />
            <Tool label="Arrow" onClick={() => add("arrow")} icon={<ArrowUpRightIcon />} />
            <Tool label="Line" onClick={() => add("line")} icon={<LineSegmentIcon />} />
            <Tool label="Picture" onClick={() => fileInput.current?.click()} icon={<ImageIcon />} />
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
              className="sr-only"
              aria-label="Picture to add"
              onChange={(e) => void addImage(e.target.files?.[0])}
            />
            <Sep />
            <Tool
              label="Undo (⌘Z)"
              onClick={undo}
              disabled={!history.current.past.length}
              icon={<ArrowUUpLeftIcon />}
            />
            <Tool
              label="Redo (⇧⌘Z)"
              onClick={redo}
              disabled={!history.current.future.length}
              icon={<ArrowUUpRightIcon />}
            />
            <Sep />
          </>
        ) : null}
        <Tool label="Zoom out" onClick={() => zoomBy(1 / 1.2)} icon={<MagnifyingGlassMinusIcon />} />
        <button
          type="button"
          onClick={() => setView((v) => ({ ...v, scale: 1 }))}
          className="h-7 w-12 rounded-md font-mono text-[12px] tabular text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Reset zoom"
        >
          {Math.round(view.scale * 100)}%
        </button>
        <Tool label="Zoom in" onClick={() => zoomBy(1.2)} icon={<MagnifyingGlassPlusIcon />} />
        <Tool label="Fit to screen" onClick={fit} icon={<CornersOutIcon />} />
        <span className="ml-auto hidden text-[11.5px] text-muted-foreground lg:inline">
          Drag the background to pan · ⌘ + scroll to zoom
        </span>
        <Tool label="Export PNG" onClick={exportPng} icon={<DownloadSimpleIcon />} />
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={box}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-shell"
          style={{
            backgroundImage:
              "radial-gradient(circle, color-mix(in oklab, var(--foreground) 14%, transparent) 1px, transparent 1px)",
            backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
        >
          <Stage
            ref={stage}
            width={size.width}
            height={size.height}
            x={view.x}
            y={view.y}
            scaleX={view.scale}
            scaleY={view.scale}
            draggable
            onDragEnd={(e) => {
              if (e.target === e.target.getStage())
                setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
            }}
            onWheel={(e) => {
              e.evt.preventDefault();
              const st = e.target.getStage();
              if (!st) return;
              if (e.evt.ctrlKey || e.evt.metaKey) {
                const pointer = st.getPointerPosition() ?? { x: size.width / 2, y: size.height / 2 };
                zoomBy(e.evt.deltaY > 0 ? 1 / 1.08 : 1.08, pointer);
              } else setView((v) => ({ ...v, x: v.x - e.evt.deltaX, y: v.y - e.evt.deltaY }));
            }}
            onMouseDown={(e) => {
              if (e.target === e.target.getStage()) setSelected([]);
            }}
            onTouchStart={(e) => {
              if (e.target === e.target.getStage()) setSelected([]);
            }}
          >
            <Layer id="content">
              {shapes.map((s) => (
                <ShapeNode
                  key={s.id}
                  shape={s}
                  font={font}
                  editable={editable}
                  hidden={editingText === s.id}
                  onSelect={(additive) => select(s.id, additive)}
                  onChange={(patch) => update(s.id, patch)}
                  onEditText={() => editable && TEXT_TYPES.has(s.type) && setEditingText(s.id)}
                />
              ))}
            </Layer>
            <Layer>
              <Transformer
                ref={transformer}
                rotateEnabled={editable}
                resizeEnabled={editable}
                keepRatio={false}
                anchorSize={8}
                anchorCornerRadius={2}
                borderStroke="#3fa796"
                anchorStroke="#3fa796"
                anchorFill="#0b0b0c"
                boundBoxFunc={(oldBox, next) => (next.width < 8 || next.height < 1 ? oldBox : next)}
              />
            </Layer>
          </Stage>
          {editingShape ? (
            <TextOverlay
              shape={editingShape}
              view={view}
              font={font}
              onDone={(text) => {
                if (text !== editingShape.text) update(editingShape.id, { text });
                setEditingText(null);
              }}
            />
          ) : null}
          {!shapes.length ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="text-[13px] text-muted-foreground">
                {editable
                  ? "Add a shape, text, sticky note or picture from the toolbar."
                  : "Nothing on this canvas yet."}
              </p>
            </div>
          ) : null}
        </div>

        <aside className="hidden w-[240px] shrink-0 flex-col border-l md:flex">
          {one && editable ? (
            <Properties
              shape={one}
              onChange={(patch) => update(one.id, patch)}
              onFront={() => reorder("front")}
              onBack={() => reorder("back")}
              onDuplicate={duplicate}
              onDelete={removeSelected}
            />
          ) : selected.length > 1 && editable ? (
            <div className="flex flex-col gap-2 border-b p-3 text-[12.5px]">
              <span className="text-muted-foreground">{selected.length} selected</span>
              <div className="flex gap-1">
                <Tool label="Bring to front" onClick={() => reorder("front")} icon={<ArrowLineUpIcon />} />
                <Tool label="Send to back" onClick={() => reorder("back")} icon={<ArrowLineDownIcon />} />
                <Tool label="Duplicate (⌘D)" onClick={duplicate} icon={<CopyIcon />} />
                <Tool label="Delete" onClick={removeSelected} icon={<TrashIcon />} />
              </div>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <p className="px-1.5 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Objects
            </p>
            {shapes.length ? (
              <ul className="flex flex-col-reverse gap-px">
                {shapes.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-pressed={selected.includes(s.id)}
                      onClick={(e) => select(s.id, e.shiftKey || e.metaKey)}
                      className="flex w-full items-center gap-2 truncate rounded-md px-1.5 py-1 text-left text-[12.5px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-muted aria-pressed:text-foreground"
                    >
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-sm border"
                        style={{ background: s.type === "text" ? s.textColor : s.fill }}
                      />
                      <span className="truncate">
                        {s.name ||
                          (TEXT_TYPES.has(s.type) && s.text ? s.text.split("\n")[0] : LABELS[s.type])}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-1.5 text-[12px] text-muted-foreground">No objects yet.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ShapeNode({
  shape: s,
  font,
  editable,
  hidden,
  onSelect,
  onChange,
  onEditText,
}: {
  shape: CanvasShape;
  font: string;
  editable: boolean;
  hidden: boolean;
  onSelect: (additive: boolean) => void;
  onChange: (patch: Partial<CanvasShape>) => void;
  onEditText: () => void;
}) {
  const image = useImage(s.type === "image" ? s.src : undefined);
  const textProps = {
    text: s.text ?? "",
    fontSize: s.fontSize ?? 18,
    fontStyle: s.fontStyle ?? "normal",
    fontFamily: font,
    align: s.align ?? "left",
    fill: s.textColor ?? "#f4f4f5",
    lineHeight: 1.25,
  };
  return (
    <Group
      id={s.id}
      x={s.x}
      y={s.y}
      rotation={s.rotation}
      opacity={hidden ? 0 : s.opacity}
      draggable={editable}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(e.evt.shiftKey || e.evt.metaKey);
      }}
      onTap={() => onSelect(false)}
      onDblClick={onEditText}
      onDblTap={onEditText}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => {
        const node = e.target;
        const sx = node.scaleX();
        const sy = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        const proportional = Math.abs(sx - sy) < 0.02;
        onChange({
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
          width: Math.max(8, s.width * sx),
          height: Math.max(1, s.height * sy),
          ...(TEXT_TYPES.has(s.type) && proportional && s.type === "text"
            ? { fontSize: Math.max(6, Math.round((s.fontSize ?? 18) * sy)) }
            : {}),
        });
      }}
    >
      {s.type === "rect" ? (
        <Rect
          width={s.width}
          height={s.height}
          fill={s.fill}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
          cornerRadius={s.cornerRadius ?? 0}
        />
      ) : s.type === "ellipse" ? (
        <Ellipse
          x={s.width / 2}
          y={s.height / 2}
          radiusX={s.width / 2}
          radiusY={s.height / 2}
          fill={s.fill}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
        />
      ) : s.type === "star" ? (
        <Star
          x={s.width / 2}
          y={s.height / 2}
          numPoints={5}
          outerRadius={Math.min(s.width, s.height) / 2}
          innerRadius={Math.min(s.width, s.height) / 4.4}
          scaleX={s.width >= s.height ? s.width / s.height : 1}
          scaleY={s.height > s.width ? s.height / s.width : 1}
          fill={s.fill}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
        />
      ) : s.type === "line" ? (
        <Line
          points={[0, 0, s.width, s.height === 1 ? 0 : s.height]}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
          lineCap="round"
          hitStrokeWidth={18}
        />
      ) : s.type === "arrow" ? (
        <Arrow
          points={[0, s.height, s.width, 0]}
          stroke={s.stroke}
          fill={s.stroke}
          strokeWidth={s.strokeWidth}
          pointerLength={14}
          pointerWidth={14}
          lineCap="round"
          hitStrokeWidth={18}
        />
      ) : s.type === "image" ? (
        image ? (
          <KonvaImage
            image={image}
            width={s.width}
            height={s.height}
            cornerRadius={s.cornerRadius ?? 0}
            stroke={s.stroke}
            strokeWidth={s.strokeWidth}
          />
        ) : (
          <Rect width={s.width} height={s.height} fill="#27272a" cornerRadius={8} />
        )
      ) : s.type === "note" ? (
        <>
          <Rect
            width={s.width}
            height={s.height}
            fill={s.fill}
            cornerRadius={s.cornerRadius ?? 6}
            shadowColor="#000"
            shadowOpacity={0.35}
            shadowBlur={14}
            shadowOffsetY={4}
          />
          <Text {...textProps} x={14} y={14} width={s.width - 28} height={s.height - 28} />
        </>
      ) : (
        <>
          <Rect width={s.width} height={s.height} fill={s.fill} />
          <Text {...textProps} width={s.width} />
        </>
      )}
    </Group>
  );
}

/** Editing text in place: a textarea laid over the shape at the current zoom. */
function TextOverlay({
  shape: s,
  view,
  font,
  onDone,
}: {
  shape: CanvasShape;
  view: { x: number; y: number; scale: number };
  font: string;
  onDone: (text: string) => void;
}) {
  const [value, setValue] = useState(s.text ?? "");
  const pad = s.type === "note" ? 14 : 0;
  return (
    <textarea
      // biome-ignore lint/a11y/noAutofocus: opened by a double-click, for typing right away
      autoFocus
      aria-label="Text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey)))
          (e.target as HTMLTextAreaElement).blur();
      }}
      className="absolute resize-none border-0 bg-transparent p-0 outline-none ring-2 ring-primary/60"
      style={{
        left: view.x + (s.x + pad) * view.scale,
        top: view.y + (s.y + pad) * view.scale,
        width: (s.width - pad * 2) * view.scale,
        height: Math.max(40, (s.height - pad * 2) * view.scale),
        transform: `rotate(${s.rotation}deg)`,
        transformOrigin: "top left",
        fontSize: (s.fontSize ?? 18) * view.scale,
        fontWeight: s.fontStyle === "bold" ? 700 : 400,
        fontFamily: font,
        lineHeight: 1.25,
        textAlign: s.align ?? "left",
        color: s.textColor ?? "#f4f4f5",
      }}
    />
  );
}

const SWATCHES = ["#3fa796", "#2563eb", "#f59e0b", "#ec4899", "#ef4444", "#fde68a", "#f4f4f5", "#27272a"];

function Properties({
  shape: s,
  onChange,
  onFront,
  onBack,
  onDuplicate,
  onDelete,
}: {
  shape: CanvasShape;
  onChange: (patch: Partial<CanvasShape>) => void;
  onFront: () => void;
  onBack: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const hasFill = s.type !== "line" && s.type !== "image" && s.type !== "text";
  const lineLike = s.type === "line" || s.type === "arrow";
  return (
    <div className="flex flex-col gap-3 border-b p-3 text-[12.5px]">
      <input
        aria-label="Object name"
        value={s.name ?? ""}
        placeholder={LABELS[s.type]}
        onChange={(e) => onChange({ name: e.target.value || undefined })}
        className="h-7 rounded-md border bg-transparent px-2 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      {hasFill && !lineLike ? (
        <ColorRow label="Fill" value={s.fill} onChange={(fill) => onChange({ fill })} />
      ) : null}
      {TEXT_TYPES.has(s.type) ? (
        <>
          <ColorRow
            label="Text"
            value={s.textColor ?? "#f4f4f5"}
            onChange={(textColor) => onChange({ textColor })}
          />
          <label className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Size</span>
            <input
              type="number"
              min={6}
              max={200}
              value={s.fontSize ?? 18}
              onChange={(e) => onChange({ fontSize: Math.max(6, Number(e.target.value) || 18) })}
              className="h-7 w-16 rounded-md border bg-transparent px-2 text-right font-mono outline-none"
            />
          </label>
          <div className="flex gap-1">
            <Chip
              on={s.fontStyle === "bold"}
              onClick={() => onChange({ fontStyle: s.fontStyle === "bold" ? "normal" : "bold" })}
            >
              Bold
            </Chip>
            {(["left", "center", "right"] as const).map((a) => (
              <Chip key={a} on={(s.align ?? "left") === a} onClick={() => onChange({ align: a })}>
                {a[0].toUpperCase() + a.slice(1)}
              </Chip>
            ))}
          </div>
        </>
      ) : null}
      <ColorRow
        label={lineLike ? "Color" : "Border"}
        value={s.stroke === "#00000000" ? "#00000000" : s.stroke}
        onChange={(stroke) =>
          onChange(lineLike ? { stroke, fill: stroke } : { stroke, strokeWidth: s.strokeWidth || 2 })
        }
      />
      <label className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{lineLike ? "Thickness" : "Border width"}</span>
        <input
          type="range"
          min={0}
          max={20}
          value={s.strokeWidth}
          onChange={(e) => onChange({ strokeWidth: Number(e.target.value) })}
          className="w-24 accent-[var(--primary)]"
        />
      </label>
      {s.type === "rect" || s.type === "note" || s.type === "image" ? (
        <label className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Corners</span>
          <input
            type="range"
            min={0}
            max={60}
            value={s.cornerRadius ?? 0}
            onChange={(e) => onChange({ cornerRadius: Number(e.target.value) })}
            className="w-24 accent-[var(--primary)]"
          />
        </label>
      ) : null}
      <label className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Opacity</span>
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round(s.opacity * 100)}
          onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
          className="w-24 accent-[var(--primary)]"
        />
      </label>
      <div className="flex gap-1">
        <Tool label="Bring to front" onClick={onFront} icon={<ArrowLineUpIcon />} />
        <Tool label="Send to back" onClick={onBack} icon={<ArrowLineDownIcon />} />
        <Tool label="Duplicate (⌘D)" onClick={onDuplicate} icon={<CopyIcon />} />
        <Tool label="Delete" onClick={onDelete} icon={<TrashIcon />} />
      </div>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const none = value === "#00000000";
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-1">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${label} ${c}`}
            aria-pressed={value.toLowerCase() === c}
            onClick={() => onChange(c)}
            className="size-5 rounded-full border outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-primary"
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          aria-label={`Custom ${label.toLowerCase()} colour`}
          value={none ? "#000000" : value.slice(0, 7)}
          onChange={(e) => onChange(e.target.value)}
          className="size-5 cursor-pointer rounded-full border-0 bg-transparent p-0"
        />
        <button
          type="button"
          onClick={() => onChange("#00000000")}
          aria-pressed={none}
          className="rounded px-1 text-[11px] text-muted-foreground hover:text-foreground aria-pressed:text-foreground"
        >
          None
        </button>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="h-6 rounded-md border px-2 text-[11.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:text-foreground"
    >
      {children}
    </button>
  );
}

function Tool({
  label,
  onClick,
  icon,
  disabled,
}: {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.94] disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4",
      )}
    >
      {icon}
    </button>
  );
}

function Sep() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />;
}
