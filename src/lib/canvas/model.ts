/**
 * A canvas page's drawing, stored as JSON in the workspace's docs under the view id. Every shape is a box
 * (x, y, width, height, rotation); lines and arrows run corner to corner inside their box.
 */
export type ShapeType = "rect" | "ellipse" | "star" | "text" | "note" | "line" | "arrow" | "image";

export type CanvasShape = {
  id: string;
  type: ShapeType;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  cornerRadius?: number;
  text?: string;
  fontSize?: number;
  fontStyle?: "normal" | "bold";
  align?: "left" | "center" | "right";
  textColor?: string;
  src?: string;
};

export type CanvasDoc = { version: 1; shapes: CanvasShape[] };

export const EMPTY_CANVAS: CanvasDoc = { version: 1, shapes: [] };

const TYPES = new Set<ShapeType>(["rect", "ellipse", "star", "text", "note", "line", "arrow", "image"]);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v.slice(0, 5000) : fallback);

/** Reads a saved drawing, dropping anything malformed so one bad shape can't break the page. */
export function parseCanvas(body: string | undefined): CanvasDoc {
  if (!body) return EMPTY_CANVAS;
  try {
    const raw = JSON.parse(body) as { shapes?: unknown[] };
    const shapes = (Array.isArray(raw.shapes) ? raw.shapes : []).flatMap((s): CanvasShape[] => {
      const o = s as Record<string, unknown>;
      if (!o || typeof o.id !== "string" || !TYPES.has(o.type as ShapeType)) return [];
      return [
        {
          id: o.id,
          type: o.type as ShapeType,
          name: typeof o.name === "string" ? o.name.slice(0, 80) : undefined,
          x: num(o.x, 0),
          y: num(o.y, 0),
          width: Math.max(1, num(o.width, 100)),
          height: Math.max(1, num(o.height, 100)),
          rotation: num(o.rotation, 0),
          fill: str(o.fill, "#3fa796"),
          stroke: str(o.stroke, "#00000000"),
          strokeWidth: Math.max(0, num(o.strokeWidth, 0)),
          opacity: Math.min(1, Math.max(0.05, num(o.opacity, 1))),
          cornerRadius: typeof o.cornerRadius === "number" ? o.cornerRadius : undefined,
          text: typeof o.text === "string" ? o.text.slice(0, 5000) : undefined,
          fontSize: typeof o.fontSize === "number" ? o.fontSize : undefined,
          fontStyle: o.fontStyle === "bold" ? "bold" : o.fontStyle === "normal" ? "normal" : undefined,
          align: o.align === "center" || o.align === "right" || o.align === "left" ? o.align : undefined,
          textColor: typeof o.textColor === "string" ? o.textColor : undefined,
          src: typeof o.src === "string" && /^(\/api\/files\/|data:image\/)/.test(o.src) ? o.src : undefined,
        },
      ];
    });
    return { version: 1, shapes };
  } catch {
    return EMPTY_CANVAS;
  }
}

export const LABELS: Record<ShapeType, string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  star: "Star",
  text: "Text",
  note: "Sticky note",
  line: "Line",
  arrow: "Arrow",
  image: "Picture",
};

/** A new shape of a type, centred on a point. */
export function newShape(
  type: ShapeType,
  cx: number,
  cy: number,
  extra: Partial<CanvasShape> = {},
): CanvasShape {
  const id = `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const base = { id, type, rotation: 0, opacity: 1, stroke: "#00000000", strokeWidth: 0 };
  const box = (w: number, h: number) => ({ x: cx - w / 2, y: cy - h / 2, width: w, height: h });
  switch (type) {
    case "rect":
      return { ...base, ...box(200, 130), fill: "#3fa796", cornerRadius: 10, ...extra };
    case "ellipse":
      return { ...base, ...box(150, 150), fill: "#f59e0b", ...extra };
    case "star":
      return { ...base, ...box(140, 140), fill: "#ec4899", ...extra };
    case "text":
      return {
        ...base,
        ...box(260, 44),
        fill: "#00000000",
        text: "Double-click to edit",
        fontSize: 28,
        fontStyle: "bold",
        align: "left",
        textColor: "#f4f4f5",
        ...extra,
      };
    case "note":
      return {
        ...base,
        ...box(200, 180),
        fill: "#fde68a",
        cornerRadius: 6,
        text: "Note",
        fontSize: 18,
        fontStyle: "normal",
        align: "left",
        textColor: "#1c1917",
        ...extra,
      };
    case "line":
      return {
        ...base,
        ...box(220, 0.0001),
        height: 1,
        fill: "#00000000",
        stroke: "#e4e4e7",
        strokeWidth: 4,
        ...extra,
      };
    case "arrow":
      return { ...base, ...box(220, 80), fill: "#e4e4e7", stroke: "#e4e4e7", strokeWidth: 4, ...extra };
    case "image":
      return { ...base, ...box(320, 220), fill: "#00000000", ...extra };
  }
}
