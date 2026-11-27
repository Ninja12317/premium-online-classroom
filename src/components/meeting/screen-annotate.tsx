import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Highlighter,
  Pen,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { ScreenAnnStroke } from '@/lib/meeting-types'
import { cn } from '@/lib/utils'

type AnnTool = ScreenAnnStroke['tool']

const ANN_COLORS = ['#c94a38', '#d9822b', '#236446', '#2c6fb3', '#ffffff']

export function ScreenAnnotateOverlay({
  canAnnotate,
  strokes: controlledStrokes,
  authorId,
  onAddStroke,
  onUndoStroke,
  onClearStrokes,
}: {
  canAnnotate: boolean
  strokes?: ScreenAnnStroke[]
  authorId?: string
  onAddStroke?: (stroke: ScreenAnnStroke) => void
  onUndoStroke?: () => void
  onClearStrokes?: () => void
}) {
  const [active, setActive] = useState(false)
  const [tool, setTool] = useState<AnnTool>('pen')
  const [color, setColor] = useState(ANN_COLORS[0])
  const [localStrokes, setLocalStrokes] = useState<ScreenAnnStroke[]>([])
  const strokes = controlledStrokes ?? localStrokes
  const strokesRef = useRef(strokes)
  useLayoutEffect(() => {
    strokesRef.current = strokes
  }, [strokes])

  const draftRef = useRef<ScreenAnnStroke | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const paint = useCallback(
    (list: ScreenAnnStroke[], draft: ScreenAnnStroke | null) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const drawOne = (s: ScreenAnnStroke) => {
        ctx.save()
        ctx.strokeStyle = s.color
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalAlpha = s.tool === 'highlighter' ? 0.35 : 0.95
        ctx.lineWidth =
          (s.tool === 'highlighter' ? s.width * 3.5 : s.width) *
          (window.devicePixelRatio || 1)
        const pts = s.points
        const w = canvas.width
        const h = canvas.height
        if (s.tool === 'pen' || s.tool === 'highlighter') {
          ctx.beginPath()
          for (let i = 0; i < pts.length; i += 2) {
            const x = pts[i] * w
            const y = pts[i + 1] * h
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        } else if (s.tool === 'rect' && pts.length >= 4) {
          const x0 = pts[0] * w
          const y0 = pts[1] * h
          const x1 = pts[2] * w
          const y1 = pts[3] * h
          ctx.strokeRect(
            Math.min(x0, x1),
            Math.min(y0, y1),
            Math.abs(x1 - x0),
            Math.abs(y1 - y0),
          )
        } else if (s.tool === 'arrow' && pts.length >= 4) {
          const x0 = pts[0] * w
          const y0 = pts[1] * h
          const x1 = pts[2] * w
          const y1 = pts[3] * h
          ctx.beginPath()
          ctx.moveTo(x0, y0)
          ctx.lineTo(x1, y1)
          ctx.stroke()
          const angle = Math.atan2(y1 - y0, x1 - x0)
          const len = 18 * (window.devicePixelRatio || 1)
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(
            x1 - len * Math.cos(angle - Math.PI / 6),
            y1 - len * Math.sin(angle - Math.PI / 6),
          )
          ctx.moveTo(x1, y1)
          ctx.lineTo(
            x1 - len * Math.cos(angle + Math.PI / 6),
            y1 - len * Math.sin(angle + Math.PI / 6),
          )
          ctx.stroke()
        }
        ctx.restore()
      }
      for (const s of list) drawOne(s)
      if (draft) drawOne(draft)
    },
    [],
  )

  useLayoutEffect(() => {
    const el = wrapRef.current
    const canvas = canvasRef.current
    if (!el || !canvas) return
    const resize = () => {
      const { width, height } = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      paint(strokesRef.current, draftRef.current)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    return () => ro.disconnect()
  }, [paint])

  useEffect(() => {
    paint(strokes, draftRef.current)
  }, [strokes, paint])

  const norm = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / Math.max(1, rect.width),
      y: (e.clientY - rect.top) / Math.max(1, rect.height),
    }
  }

  const onDown = (e: React.PointerEvent) => {
    if (!active) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = norm(e)
    draftRef.current = {
      id: crypto.randomUUID(),
      tool,
      color,
      width: 4,
      points: [x, y, x, y],
      authorId,
    }
    paint(strokes, draftRef.current)
  }

  const onMove = (e: React.PointerEvent) => {
    if (!draftRef.current) return
    const { x, y } = norm(e)
    if (
      draftRef.current.tool === 'pen' ||
      draftRef.current.tool === 'highlighter'
    ) {
      draftRef.current.points.push(x, y)
    } else {
      draftRef.current.points[2] = x
      draftRef.current.points[3] = y
    }
    paint(strokes, draftRef.current)
  }

  const onUp = () => {
    if (!draftRef.current) return
    const finished = draftRef.current
    draftRef.current = null
    if (onAddStroke) {
      onAddStroke(finished)
    } else {
      setLocalStrokes((s) => [...s, finished])
    }
  }

  const handleUndo = () => {
    if (onUndoStroke) onUndoStroke()
    else setLocalStrokes((s) => s.slice(0, -1))
  }

  const handleClear = () => {
    if (onClearStrokes) onClearStrokes()
    else setLocalStrokes([])
  }

  if (!canAnnotate && strokes.length === 0) return null

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 z-10">
      <canvas
        ref={canvasRef}
        className={cn(
          'absolute inset-0 h-full w-full',
          active ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none',
        )}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />

      {canAnnotate && (
        <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-1 rounded-xl border border-border bg-card/95 p-1 text-card-foreground shadow-md backdrop-blur">
          {!active ? (
            <Button
              size="xs"
              variant="ghost"
              className="gap-1.5"
              onClick={() => setActive(true)}
            >
              <Pen className="size-3.5" /> Annotate
            </Button>
          ) : (
            <>
              {(
                [
                  ['pen', Pen, 'Pen'],
                  ['highlighter', Highlighter, 'Highlighter'],
                  ['arrow', ArrowUpRight, 'Arrow'],
                  ['rect', Square, 'Rectangle'],
                ] as const
              ).map(([t, Icon, lbl]) => (
                <button
                  key={t}
                  type="button"
                  aria-label={lbl}
                  onClick={() => setTool(t)}
                  className={cn(
                    'grid size-7 place-items-center rounded-md',
                    tool === t
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted',
                  )}
                >
                  <Icon className="size-3.5" />
                </button>
              ))}
              <span className="mx-0.5 h-4 w-px bg-border" />
              {ANN_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Annotate color ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-4 rounded-full border border-black/20',
                    color === c && 'ring-2 ring-ring',
                  )}
                  style={{ background: c }}
                />
              ))}
              <span className="mx-0.5 h-4 w-px bg-border" />
              <button
                type="button"
                aria-label="Undo annotation"
                disabled={strokes.length === 0}
                onClick={handleUndo}
                className="grid size-7 place-items-center rounded-md hover:bg-muted disabled:opacity-40"
              >
                <Undo2 className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Clear annotations"
                disabled={strokes.length === 0}
                onClick={handleClear}
                className="grid size-7 place-items-center rounded-md hover:bg-muted disabled:opacity-40"
              >
                <Trash2 className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Close annotate toolbar"
                onClick={() => setActive(false)}
                className="grid size-7 place-items-center rounded-md hover:bg-muted"
              >
                <X className="size-3.5" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
