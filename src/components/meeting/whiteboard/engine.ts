/**
 * Whiteboard data model and renderer. Pure functions over plain data so the
 * same code draws locally, replays remote operations, and exports images.
 */

export type Tool =
  | "select"
  | "pen"
  | "pencil"
  | "highlighter"
  | "eraser"
  | "text"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "triangle"
  | "pan";

export type StrokeTool = Exclude<Tool, "select" | "eraser" | "pan"> | "image";

export interface Stroke {
  id: string;
  tool: StrokeTool;
  color: string;
  size: number;
  /** Flat [x0, y0, x1, y1, ...] in board units. Shapes use two points. */
  points: number[];
  text?: string;
  /** Image strokes: a data URL drawn into the box given by two points. */
  src?: string;
  /** Locked strokes (imported PDF pages) are ignored by the eraser. */
  locked?: boolean;
  author: string;
}

export interface WbPage {
  id: string;
  strokes: Stroke[];
}

export type WbOp =
  | { type: "add"; page: string; stroke: Stroke }
  | { type: "remove"; page: string; ids: string[] }
  | { type: "clear"; page: string }
  | { type: "page-add"; page: WbPage; after: string | null }
  | { type: "page-remove"; page: string }
  | { type: "goto"; page: string }
  | { type: "sync"; pages: WbPage[]; current: string };

export const BOARD_W = 1920;
export const BOARD_H = 1080;

export const COLORS = [
  "#1b1b1f",
  "#e5484d",
  "#f76b15",
  "#ffc53d",
  "#30a46c",
  "#0090ff",
  "#8e4ec6",
  "#ffffff",
];

export function newId() {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  );
}

export function newPage(): WbPage {
  return { id: newId(), strokes: [] };
}

/** Applies an op to the page list, returning a new list (pages are immutable). */
export function applyOp(pages: WbPage[], op: WbOp): WbPage[] {
  switch (op.type) {
    case "add":
      return pages.map((p) =>
        p.id === op.page && !p.strokes.some((s) => s.id === op.stroke.id)
          ? { ...p, strokes: [...p.strokes, op.stroke] }
          : p,
      );
    case "remove": {
      const ids = new Set(op.ids);
      return pages.map((p) =>
        p.id === op.page
          ? { ...p, strokes: p.strokes.filter((s) => !ids.has(s.id)) }
          : p,
      );
    }
    case "clear":
      return pages.map((p) => (p.id === op.page ? { ...p, strokes: [] } : p));
    case "page-add": {
      if (pages.some((p) => p.id === op.page.id)) return pages;
      const idx = op.after ? pages.findIndex((p) => p.id === op.after) : -1;
      const next = [...pages];
      next.splice(idx + 1, 0, op.page);
      return next;
    }
    case "page-remove":
      return pages.length > 1 ? pages.filter((p) => p.id !== op.page) : pages;
    case "sync":
      return op.pages;
    case "goto":
      return pages;
  }
}

// ---------------------------------------------------------------------------
// Rendering

const imageCache = new Map<string, HTMLImageElement>();
const imageListeners = new Set<() => void>();

/** Calls back whenever a board image finishes decoding, so views can repaint. */
export function onImageLoad(fn: () => void) {
  imageListeners.add(fn);
  return () => {
    imageListeners.delete(fn);
  };
}

function getImage(src: string) {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => imageListeners.forEach((fn) => fn());
    img.src = src;
    imageCache.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

function strokeStyle(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.globalAlpha =
    s.tool === "highlighter" ? 0.35 : s.tool === "pencil" ? 0.85 : 1;
  ctx.lineWidth = s.tool === "highlighter" ? s.size * 3 : s.size;
}

function drawFreehand(ctx: CanvasRenderingContext2D, pts: number[]) {
  if (pts.length < 2) return;
  ctx.beginPath();
  if (pts.length < 6) {
    ctx.moveTo(pts[0], pts[1]);
    ctx.lineTo(pts[pts.length - 2] + 0.01, pts[pts.length - 1] + 0.01);
  } else {
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length - 2; i += 2) {
      const mx = (pts[i] + pts[i + 2]) / 2;
      const my = (pts[i + 1] + pts[i + 3]) / 2;
      ctx.quadraticCurveTo(pts[i], pts[i + 1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
  }
  ctx.stroke();
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
) {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.max(12, size * 4);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(
    x1 - len * Math.cos(angle - Math.PI / 6),
    y1 - len * Math.sin(angle - Math.PI / 6),
  );
  ctx.moveTo(x1, y1);
  ctx.lineTo(
    x1 - len * Math.cos(angle + Math.PI / 6),
    y1 - len * Math.sin(angle + Math.PI / 6),
  );
  ctx.stroke();
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.save();
  strokeStyle(ctx, s);
  const [x0, y0] = s.points;
  const x1 = s.points[s.points.length - 2];
  const y1 = s.points[s.points.length - 1];
  switch (s.tool) {
    case "pen":
    case "pencil":
    case "highlighter":
      drawFreehand(ctx, s.points);
      break;
    case "line":
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      break;
    case "arrow":
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      drawArrowHead(ctx, x0, y0, x1, y1, s.size);
      break;
    case "rect":
      ctx.strokeRect(
        Math.min(x0, x1),
        Math.min(y0, y1),
        Math.abs(x1 - x0),
        Math.abs(y1 - y0),
      );
      break;
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(
        (x0 + x1) / 2,
        (y0 + y1) / 2,
        Math.abs(x1 - x0) / 2,
        Math.abs(y1 - y0) / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      break;
    case "triangle":
      ctx.beginPath();
      ctx.moveTo((x0 + x1) / 2, Math.min(y0, y1));
      ctx.lineTo(Math.max(x0, x1), Math.max(y0, y1));
      ctx.lineTo(Math.min(x0, x1), Math.max(y0, y1));
      ctx.closePath();
      ctx.stroke();
      break;
    case "image": {
      const img = s.src ? getImage(s.src) : null;
      if (img) ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
      break;
    }
    case "text": {
      const px = Math.max(14, s.size * 6);
      ctx.font = `500 ${px}px ${getComputedStyle(document.documentElement).getPropertyValue("--font-body") || "sans-serif"}`;
      ctx.textBaseline = "top";
      const lines = (s.text ?? "").split("\n");
      lines.forEach((line, i) => ctx.fillText(line, x0, y0 + i * px * 1.25));
      break;
    }
  }
  ctx.restore();
}

export function renderPage(
  ctx: CanvasRenderingContext2D,
  page: WbPage,
  opts: {
    background: string | null;
    scale: number;
    offsetX: number;
    offsetY: number;
  },
) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  ctx.save();
  ctx.setTransform(opts.scale, 0, 0, opts.scale, opts.offsetX, opts.offsetY);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  }
  for (const s of page.strokes) drawStroke(ctx, s);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Hit testing for the eraser

function distToSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = x0 + t * dx;
  const cy = y0 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function hitStroke(
  s: Stroke,
  x: number,
  y: number,
  radius: number,
): boolean {
  if (s.locked) return false;
  const pts = s.points;
  const r = radius + s.size / 2;
  const [x0, y0] = pts;
  const x1 = pts[pts.length - 2];
  const y1 = pts[pts.length - 1];
  switch (s.tool) {
    case "pen":
    case "pencil":
    case "highlighter":
      for (let i = 0; i < pts.length - 2; i += 2) {
        if (
          distToSegment(x, y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]) <= r
        )
          return true;
      }
      return pts.length === 2 && Math.hypot(x - x0, y - y0) <= r;
    case "line":
    case "arrow":
      return distToSegment(x, y, x0, y0, x1, y1) <= r;
    case "image":
    case "rect":
    case "triangle":
    case "ellipse": {
      const minX = Math.min(x0, x1) - r;
      const maxX = Math.max(x0, x1) + r;
      const minY = Math.min(y0, y1) - r;
      const maxY = Math.max(y0, y1) + r;
      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
    case "text": {
      const px = Math.max(14, s.size * 6);
      const lines = (s.text ?? "").split("\n");
      const w = Math.max(...lines.map((l) => l.length)) * px * 0.55;
      const h = lines.length * px * 1.25;
      return x >= x0 - r && x <= x0 + w + r && y >= y0 - r && y <= y0 + h + r;
    }
  }
}

/** Renders a page to a standalone canvas (white background) for export. */
export function pageToCanvas(page: WbPage, scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = BOARD_W * scale;
  canvas.height = BOARD_H * scale;
  const ctx = canvas.getContext("2d")!;
  renderPage(ctx, page, {
    background: "#ffffff",
    scale,
    offsetX: 0,
    offsetY: 0,
  });
  return canvas;
}
