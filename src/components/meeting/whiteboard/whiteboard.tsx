import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react'
import {
  ArrowUpRight,
  Circle,
  Download,
  Eraser,
  Hand,
  Highlighter,
  Minus,
  MoveDiagonal,
  Pen,
  Pencil,
  Plus,
  Redo2,
  Square,
  Trash2,
  Triangle,
  Type,
  Undo2,
  X,
  ChevronLeft,
  ChevronRight,
  Scan,
  FilePlus2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  BOARD_H,
  BOARD_W,
  COLORS,
  applyOp,
  drawStroke,
  hitStroke,
  newId,
  newPage,
  pageToCanvas,
  renderPage,
  type Stroke,
  type StrokeTool,
  type Tool,
  type WbOp,
  type WbPage,
} from './engine'
import { buildPdf } from './pdf'

export interface WhiteboardHandle {
  /** Apply an operation that arrived from another participant. */
  apply: (op: WbOp) => void
  snapshot: () => { pages: WbPage[]; current: string }
}

export interface WhiteboardProps {
  canDraw: boolean
  isTeacher: boolean
  author: string
  onOp?: (op: WbOp) => void
  onClose?: () => void
  handle?: Ref<WhiteboardHandle>
  className?: string
}

interface View {
  scale: number
  x: number
  y: number
}

const TOOLS: { tool: Tool; label: string; icon: typeof Pen; key: string }[] = [
  { tool: 'pen', label: 'Pen', icon: Pen, key: '1' },
  { tool: 'pencil', label: 'Pencil', icon: Pencil, key: '2' },
  { tool: 'highlighter', label: 'Highlighter', icon: Highlighter, key: '3' },
  { tool: 'eraser', label: 'Eraser', icon: Eraser, key: '4' },
  { tool: 'text', label: 'Text', icon: Type, key: '5' },
  { tool: 'line', label: 'Line', icon: Minus, key: '6' },
  { tool: 'arrow', label: 'Arrow', icon: ArrowUpRight, key: '7' },
  { tool: 'rect', label: 'Rectangle', icon: Square, key: '8' },
  { tool: 'ellipse', label: 'Circle', icon: Circle, key: '9' },
  { tool: 'triangle', label: 'Triangle', icon: Triangle, key: '0' },
  { tool: 'pan', label: 'Move canvas', icon: Hand, key: ' ' },
]

/**
 * Vector whiteboard on two canvases: committed strokes on the base layer,
 * the stroke in progress on the overlay, so drawing never redraws the page.
 */
export function Whiteboard({
  canDraw,
  isTeacher,
  author,
  onOp,
  onClose,
  handle,
  className,
}: WhiteboardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const [pages, setPages] = useState<WbPage[]>(() => [newPage()])
  const pagesRef = useRef(pages)
  const [currentId, setCurrentId] = useState(() => pages[0].id)
  const currentRef = useRef(currentId)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(4)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const viewRef = useRef(view)
  const undoRef = useRef<{ undo: WbOp; redo: WbOp }[]>([])
  const redoRef = useRef<{ undo: WbOp; redo: WbOp }[]>([])
  const [stackSizes, setStackSizes] = useState({ undo: 0, redo: 0 })
  const syncStacks = useCallback(
    () =>
      setStackSizes({
        undo: undoRef.current.length,
        redo: redoRef.current.length,
      }),
    [],
  )

  // Handlers read the latest values through refs; keep them in sync after each render.
  useLayoutEffect(() => {
    pagesRef.current = pages
    currentRef.current = currentId
    viewRef.current = view
  }, [pages, currentId, view])
  const [textEdit, setTextEdit] = useState<{
    x: number
    y: number
    sx: number
    sy: number
  } | null>(null)

  const currentPage = useCallback(
    () =>
      pagesRef.current.find((p) => p.id === currentRef.current) ??
      pagesRef.current[0],
    [],
  )

  // ---- rendering -----------------------------------------------------------

  const paintBase = useCallback(() => {
    const canvas = baseRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const page = pages.find((p) => p.id === currentId) ?? pages[0]
    renderPage(ctx, page, {
      background: '#ffffff',
      scale: view.scale * dpr,
      offsetX: view.x * dpr,
      offsetY: view.y * dpr,
    })
  }, [pages, currentId, view])

  const clearOverlay = useCallback(() => {
    const canvas = overlayRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  const paintOverlay = useCallback((stroke: Stroke) => {
    const canvas = overlayRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const v = viewRef.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, v.x * dpr, v.y * dpr)
    drawStroke(ctx, stroke)
  }, [])

  const fitToScreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const scale = Math.min(width / BOARD_W, height / BOARD_H) * 0.97
    setView({
      scale,
      x: (width - BOARD_W * scale) / 2,
      y: (height - BOARD_H * scale) / 2,
    })
  }, [])

  // Size canvases to the container (HiDPI aware) and refit on resize.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      for (const c of [baseRef.current, overlayRef.current]) {
        if (!c) continue
        c.width = Math.round(width * dpr)
        c.height = Math.round(height * dpr)
        c.style.width = `${width}px`
        c.style.height = `${height}px`
      }
      fitToScreen()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitToScreen])

  useEffect(() => {
    paintBase()
  }, [paintBase])

  // ---- ops -----------------------------------------------------------------

  const applyLocal = useCallback((op: WbOp) => {
    const next = applyOp(pagesRef.current, op)
    pagesRef.current = next
    setPages(next)
    if (op.type === 'goto' || op.type === 'sync') {
      const target = op.type === 'goto' ? op.page : op.current
      if (next.some((p) => p.id === target)) {
        currentRef.current = target
        setCurrentId(target)
      }
    }
    if (op.type === 'page-remove' && currentRef.current === op.page) {
      currentRef.current = next[0].id
      setCurrentId(next[0].id)
    }
    if (op.type === 'page-add') {
      currentRef.current = op.page.id
      setCurrentId(op.page.id)
    }
  }, [])

  const commit = useCallback(
    (redo: WbOp, undo: WbOp | null) => {
      applyLocal(redo)
      onOp?.(redo)
      if (undo) {
        undoRef.current.push({ redo, undo })
        if (undoRef.current.length > 200) undoRef.current.shift()
        redoRef.current = []
        syncStacks()
      }
    },
    [applyLocal, onOp, syncStacks],
  )

  const undo = useCallback(() => {
    const entry = undoRef.current.pop()
    if (!entry) return
    applyLocal(entry.undo)
    onOp?.(entry.undo)
    redoRef.current.push(entry)
    syncStacks()
  }, [applyLocal, onOp, syncStacks])

  const redo = useCallback(() => {
    const entry = redoRef.current.pop()
    if (!entry) return
    applyLocal(entry.redo)
    onOp?.(entry.redo)
    undoRef.current.push(entry)
    syncStacks()
  }, [applyLocal, onOp, syncStacks])

  useImperativeHandle(
    handle,
    () => ({
      apply: (op) => {
        // Students follow the teacher's page; teachers keep their own place.
        if (op.type === 'goto' && isTeacher) return
        applyLocal(op)
      },
      snapshot: () => ({
        pages: pagesRef.current,
        current: currentRef.current,
      }),
    }),
    [applyLocal, isTeacher],
  )

  // ---- pointer handling ----------------------------------------------------

  const drawing = useRef<{
    stroke: Stroke | null
    erased: Stroke[]
    pan: { x: number; y: number; vx: number; vy: number } | null
    pointerId: number
  } | null>(null)

  const toBoard = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return {
      x: (clientX - rect.left - v.x) / v.scale,
      y: (clientY - rect.top - v.y) / v.scale,
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (textEdit) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const isPan =
      tool === 'pan' || e.button === 1 || (!canDraw && e.button === 0)
    if (isPan) {
      drawing.current = {
        stroke: null,
        erased: [],
        pan: {
          x: e.clientX,
          y: e.clientY,
          vx: viewRef.current.x,
          vy: viewRef.current.y,
        },
        pointerId: e.pointerId,
      }
      return
    }
    if (!canDraw || e.button !== 0) return
    const { x, y } = toBoard(e.clientX, e.clientY)
    if (tool === 'text') {
      const rect = containerRef.current!.getBoundingClientRect()
      setTextEdit({ x, y, sx: e.clientX - rect.left, sy: e.clientY - rect.top })
      return
    }
    if (tool === 'eraser') {
      drawing.current = {
        stroke: null,
        erased: [],
        pan: null,
        pointerId: e.pointerId,
      }
      eraseAt(x, y)
      return
    }
    const stroke: Stroke = {
      id: newId(),
      tool: tool as StrokeTool,
      color,
      size,
      points: [x, y, x, y],
      author,
    }
    drawing.current = { stroke, erased: [], pan: null, pointerId: e.pointerId }
    paintOverlay(stroke)
  }

  const eraseAt = (x: number, y: number) => {
    const page = currentPage()
    const radius = Math.max(6, size * 2) / viewRef.current.scale
    const hits = page.strokes.filter((s) => hitStroke(s, x, y, radius))
    if (hits.length === 0) return
    drawing.current?.erased.push(...hits)
    applyLocal({ type: 'remove', page: page.id, ids: hits.map((h) => h.id) })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drawing.current
    if (!d || d.pointerId !== e.pointerId) return
    if (d.pan) {
      setView((v) => ({
        ...v,
        x: d.pan!.vx + (e.clientX - d.pan!.x),
        y: d.pan!.vy + (e.clientY - d.pan!.y),
      }))
      return
    }
    const { x, y } = toBoard(e.clientX, e.clientY)
    if (tool === 'eraser') {
      eraseAt(x, y)
      return
    }
    const s = d.stroke
    if (!s) return
    if (s.tool === 'pen' || s.tool === 'pencil' || s.tool === 'highlighter') {
      const lx = s.points[s.points.length - 2]
      const ly = s.points[s.points.length - 1]
      if (Math.hypot(x - lx, y - ly) < 1.5 / viewRef.current.scale) return
      s.points.push(x, y)
    } else {
      s.points[2] = x
      s.points[3] = y
    }
    paintOverlay(s)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drawing.current
    if (!d || d.pointerId !== e.pointerId) return
    drawing.current = null
    if (d.pan) return
    const page = currentPage()
    if (tool === 'eraser') {
      if (d.erased.length) {
        const ids = d.erased.map((s) => s.id)
        onOp?.({ type: 'remove', page: page.id, ids })
        // Restoring multiple strokes needs one op per stroke; store them as a batch.
        undoRef.current.push({
          redo: { type: 'remove', page: page.id, ids },
          undo: {
            type: 'page-add',
            page: { id: '__batch__', strokes: d.erased },
            after: null,
          },
        })
        redoRef.current = []
        syncStacks()
      }
      return
    }
    const s = d.stroke
    if (!s) return
    clearOverlay()
    if (
      s.points.length === 4 &&
      s.tool !== 'pen' &&
      s.tool !== 'pencil' &&
      s.tool !== 'highlighter'
    ) {
      const [x0, y0, x1, y1] = s.points
      if (Math.hypot(x1 - x0, y1 - y0) < 2) return
    }
    commit(
      { type: 'add', page: page.id, stroke: s },
      { type: 'remove', page: page.id, ids: [s.id] },
    )
  }

  // Batched undo of an eraser pass: re-add every erased stroke.
  const undoBatched = useCallback(() => {
    const entry = undoRef.current[undoRef.current.length - 1]
    if (
      entry &&
      entry.undo.type === 'page-add' &&
      entry.undo.page.id === '__batch__'
    ) {
      undoRef.current.pop()
      const pageId = (entry.redo as { page: string }).page
      for (const s of entry.undo.page.strokes) {
        const op: WbOp = { type: 'add', page: pageId, stroke: s }
        applyLocal(op)
        onOp?.(op)
      }
      redoRef.current.push(entry)
      syncStacks()
      return true
    }
    return false
  }, [applyLocal, onOp, syncStacks])

  const handleUndo = useCallback(() => {
    if (!undoBatched()) undo()
  }, [undoBatched, undo])

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      return
    }
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY)
  }

  const zoomBy = (factor: number, cx?: number, cy?: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = cx !== undefined ? cx - rect.left : rect.width / 2
    const py = cy !== undefined ? cy - rect.top : rect.height / 2
    setView((v) => {
      const scale = Math.min(8, Math.max(0.1, v.scale * factor))
      const k = scale / v.scale
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
  }

  // ---- text tool -----------------------------------------------------------

  const commitText = (value: string) => {
    const edit = textEdit
    setTextEdit(null)
    if (!edit || !value.trim()) return
    const page = currentPage()
    const stroke: Stroke = {
      id: newId(),
      tool: 'text',
      color,
      size,
      points: [edit.x, edit.y],
      text: value.trimEnd(),
      author,
    }
    commit(
      { type: 'add', page: page.id, stroke },
      { type: 'remove', page: page.id, ids: [stroke.id] },
    )
  }

  // ---- pages & export ------------------------------------------------------

  const pageIndex = Math.max(
    0,
    pages.findIndex((p) => p.id === currentId),
  )

  const goto = (index: number) => {
    const target = pages[Math.max(0, Math.min(pages.length - 1, index))]
    if (!target) return
    currentRef.current = target.id
    setCurrentId(target.id)
    if (isTeacher) onOp?.({ type: 'goto', page: target.id })
  }

  const addPage = () => {
    const page = newPage()
    commit({ type: 'page-add', page, after: currentId }, null)
    if (isTeacher) onOp?.({ type: 'goto', page: page.id })
  }

  const removePage = () => {
    if (pages.length <= 1) return
    const removed = currentPage()
    commit({ type: 'page-remove', page: removed.id }, null)
    if (isTeacher) onOp?.({ type: 'goto', page: pagesRef.current[0].id })
  }

  const clearPage = () => {
    const page = currentPage()
    if (page.strokes.length === 0) return
    commit(
      { type: 'clear', page: page.id },
      {
        type: 'page-add',
        page: { id: '__batch__', strokes: page.strokes },
        after: null,
      },
    )
  }

  const exportPng = () => {
    const canvas = pageToCanvas(currentPage())
    canvas.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `whiteboard-page-${pageIndex + 1}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }, 'image/png')
  }

  const exportPdf = () => {
    try {
      const images = pages.map((p) => {
        const c = pageToCanvas(p, 0.75)
        return {
          dataUrl: c.toDataURL('image/jpeg', 0.9),
          width: c.width,
          height: c.height,
        }
      })
      const blob = buildPdf(images)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'whiteboard.pdf'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch {
      toast.error('Could not export the PDF.')
    }
  }

  // Tool shortcuts while the board is focused/hovered.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') return
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          handleUndo()
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault()
          redo()
        }
        return
      }
      const match = TOOLS.find((t) => t.key === e.key)
      if (match && canDraw) setTool(match.tool)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canDraw, handleUndo, redo])

  const cursor =
    tool === 'pan' || !canDraw
      ? 'grab'
      : tool === 'text'
        ? 'text'
        : tool === 'eraser'
          ? 'cell'
          : 'crosshair'

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-xl bg-muted',
        className,
      )}
    >
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b bg-card px-2 py-1.5 text-card-foreground">
        {canDraw ? (
          <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
            {TOOLS.map((t) => (
              <ToolButton
                key={t.tool}
                label={t.label}
                active={tool === t.tool}
                onClick={() => setTool(t.tool)}
              >
                <t.icon className="size-4" />
              </ToolButton>
            ))}
          </div>
        ) : (
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            View only. Your teacher controls who can draw.
          </span>
        )}
        {canDraw && (
          <>
            <div
              className="mx-1 flex items-center gap-1"
              role="radiogroup"
              aria-label="Colour"
            >
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`Colour ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-6 rounded-full border border-black/10 transition-transform motion-reduce:transition-none',
                    color === c &&
                      'scale-110 ring-2 ring-ring ring-offset-1 ring-offset-card',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="sr-only">Brush size</span>
              <span
                aria-hidden
                className="rounded-full bg-foreground"
                style={{ width: Math.max(3, size), height: Math.max(3, size) }}
              />
              <input
                type="range"
                min={1}
                max={24}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="w-20 accent-primary"
                aria-label="Brush size"
              />
            </label>
            <div className="flex items-center">
              <ToolButton
                label="Undo (Ctrl+Z)"
                onClick={handleUndo}
                disabled={stackSizes.undo === 0}
              >
                <Undo2 className="size-4" />
              </ToolButton>
              <ToolButton
                label="Redo (Ctrl+Y)"
                onClick={redo}
                disabled={stackSizes.redo === 0}
              >
                <Redo2 className="size-4" />
              </ToolButton>
              <ToolButton label="Clear page" onClick={clearPage}>
                <Trash2 className="size-4" />
              </ToolButton>
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          <div className="flex items-center rounded-lg bg-muted p-0.5">
            <ToolButton label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
              <Minus className="size-4" />
            </ToolButton>
            <button
              type="button"
              onClick={fitToScreen}
              className="min-w-12 rounded-md px-1 text-xs tabular-nums hover:bg-background"
              aria-label="Fit to screen"
            >
              {Math.round(view.scale * 100)}%
            </button>
            <ToolButton label="Zoom in" onClick={() => zoomBy(1.25)}>
              <Plus className="size-4" />
            </ToolButton>
            <ToolButton label="Fit to screen" onClick={fitToScreen}>
              <Scan className="size-4" />
            </ToolButton>
          </div>
          <div className="flex items-center rounded-lg bg-muted p-0.5">
            <ToolButton
              label="Previous page"
              onClick={() => goto(pageIndex - 1)}
              disabled={pageIndex === 0 || (!isTeacher && !canDraw)}
            >
              <ChevronLeft className="size-4" />
            </ToolButton>
            <span className="min-w-12 text-center text-xs tabular-nums">
              {pageIndex + 1} / {pages.length}
            </span>
            <ToolButton
              label="Next page"
              onClick={() => goto(pageIndex + 1)}
              disabled={
                pageIndex >= pages.length - 1 || (!isTeacher && !canDraw)
              }
            >
              <ChevronRight className="size-4" />
            </ToolButton>
            {isTeacher && (
              <>
                <ToolButton label="Add page" onClick={addPage}>
                  <FilePlus2 className="size-4" />
                </ToolButton>
                <ToolButton
                  label="Delete page"
                  onClick={removePage}
                  disabled={pages.length <= 1}
                >
                  <X className="size-4" />
                </ToolButton>
              </>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Export"
              >
                <Download className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={exportPng}>
                Save this page as PNG
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={exportPdf}>
                Save all pages as PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={onClose}
              aria-label="Close whiteboard"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* canvas */}
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-[oklch(0.93_0.005_100)] dark:bg-[oklch(0.2_0.01_165)]"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={() => tool === 'pan' && fitToScreen()}
        role="img"
        aria-label={`Whiteboard page ${pageIndex + 1} of ${pages.length}`}
      >
        <canvas
          ref={baseRef}
          className="absolute inset-0 shadow-[0_0_0_1px_rgba(0,0,0,.06)]"
        />
        <canvas ref={overlayRef} className="absolute inset-0" />
        {textEdit && (
          <textarea
            autoFocus
            aria-label="Text"
            className="absolute z-10 min-h-8 min-w-40 resize rounded border border-primary bg-white/90 p-1 font-medium leading-tight text-black outline-none"
            style={{
              left: textEdit.sx,
              top: textEdit.sy,
              fontSize: Math.max(14, size * 6) * view.scale,
              color,
            }}
            onBlur={(e) => commitText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setTextEdit(null)
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                commitText((e.target as HTMLTextAreaElement).value)
              }
            }}
            placeholder="Type, then click away"
          />
        )}
        <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-white">
          <MoveDiagonal className="mr-1 inline size-3" />
          Ctrl + scroll to zoom
        </span>
      </div>
    </div>
  )
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'grid size-8 place-items-center rounded-md transition-colors motion-reduce:transition-none disabled:opacity-40',
            active
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-background',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
