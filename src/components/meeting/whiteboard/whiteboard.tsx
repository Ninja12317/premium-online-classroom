import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import {
  ArrowUpRight,
  Circle,
  Copy,
  Diamond,
  Download,
  Eraser,
  FilePlus2,
  Grid2X2,
  Hand,
  Highlighter,
  ImagePlus,
  LayoutTemplate,
  Lock,
  LockOpen,
  Maximize2,
  MessageCircle,
  Minus,
  Moon,
  MousePointer2,
  Pen,
  Plus,
  Redo2,
  RotateCcw,
  Sparkles,
  Square,
  Star,
  StickyNote,
  Sun,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Upload,
  X,
  BringToFront,
  SendToBack,
  RectangleHorizontal,
  FolderKanban,
  Eye,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  clearWhiteboardCollection,
  deleteWhiteboardElements,
  subscribeWhiteboardElements,
  subscribeWhiteboardMeta,
  updateWhiteboardMeta,
  upsertWhiteboardElement,
  upsertWhiteboardElementsBatch,
} from '@/services/firestore-meetings'
import { newPage, type WbOp, type WbPage } from './engine'
import {
  BOARD_COLORS,
  STICKY_COLORS,
  createTemplateElements,
  drawBoardElement,
  drawInfiniteBackground,
  exportBoardJson,
  exportBoardSvg,
  getContentBounds,
  getElementBounds,
  hitTestElement,
  makeElementId,
  parseBoardJson,
  rectsIntersect,
  renderExportCanvas,
  resizeElementToBounds,
  translateElement,
  type BoardElement,
  type BoardPattern,
  type BoardTheme,
  type Camera,
  type ElementKind,
  type InfiniteTool,
  type LaserTrail,
  type Rect,
  type StrokeStyle,
  type TemplateKind,
} from './infinite-engine'
import { buildPdf } from './pdf'

export interface WhiteboardHandle {
  apply: (op: WbOp) => void
  snapshot: () => { pages: WbPage[]; current: string }
}

export interface WhiteboardProps {
  canDraw: boolean
  isTeacher: boolean
  author: string
  authorName?: string
  syncScope?:
    | { kind: 'meeting'; meetingId: string }
    | { kind: 'board'; boardId: string }
  title?: string
  onOp?: (op: WbOp) => void
  onLaser?: (x: number, y: number) => void
  remoteLasers?: LaserTrail[]
  allowParticipantsAnnotate?: boolean
  onToggleParticipantsAnnotate?: (allowed: boolean) => void
  onOpenBoardPicker?: () => void
  onCameraBroadcast?: (cx: number, cy: number, zoom: number) => void
  remotePresenterCamera?: { cx: number; cy: number; zoom: number; at: number } | null
  onClose?: () => void
  handle?: Ref<WhiteboardHandle>
  className?: string
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'

const SHAPE_TOOLS: {
  tool: InfiniteTool
  label: string
  icon: typeof Square
}[] = [
  { tool: 'rect', label: 'Rectangle', icon: Square },
  { tool: 'rounded-rect', label: 'Rounded rectangle', icon: RectangleHorizontal },
  { tool: 'ellipse', label: 'Circle / Ellipse', icon: Circle },
  { tool: 'triangle', label: 'Triangle', icon: Triangle },
  { tool: 'diamond', label: 'Diamond', icon: Diamond },
  { tool: 'star', label: 'Star', icon: Star },
  { tool: 'speech-bubble', label: 'Speech bubble', icon: MessageCircle },
]

const MIN_ZOOM = 0.1
const MAX_ZOOM = 5.0

function clampZoom(z: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

function getHandlePositions(b: Rect): Record<HandleId, { x: number; y: number }> {
  const mx = b.x + b.w / 2
  const my = b.y + b.h / 2
  return {
    nw: { x: b.x, y: b.y },
    n: { x: mx, y: b.y },
    ne: { x: b.x + b.w, y: b.y },
    e: { x: b.x + b.w, y: my },
    se: { x: b.x + b.w, y: b.y + b.h },
    s: { x: mx, y: b.y + b.h },
    sw: { x: b.x, y: b.y + b.h },
    w: { x: b.x, y: my },
    rotate: { x: mx, y: b.y - 28 },
  }
}

async function compressImageFile(
  file: File,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Could not decode image'))
    el.src = rawUrl
  })
  const maxDim = 900
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
  return { dataUrl, width: Math.min(420, w), height: Math.min(420, h) }
}

/**
 * Full infinite whiteboard with real-time Firestore sync, rich shapes,
 * sticky notes, images, templates, laser pointer, minimap, and export.
 */
export function Whiteboard({
  canDraw,
  isTeacher,
  author,
  authorName,
  syncScope,
  title,
  onOp,
  onLaser,
  remoteLasers = [],
  allowParticipantsAnnotate,
  onToggleParticipantsAnnotate,
  onOpenBoardPicker,
  onCameraBroadcast,
  remotePresenterCamera,
  onClose,
  handle,
  className,
}: WhiteboardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const minimapRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef({ width: 0, height: 0 })

  const [elements, setElements] = useState<BoardElement[]>([])
  const elementsRef = useRef<BoardElement[]>(elements)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedIdsRef = useRef<string[]>(selectedIds)

  const [tool, setTool] = useState<InfiniteTool>('pen')
  const [lastShapeTool, setLastShapeTool] = useState<InfiniteTool>('rect')
  const [strokeColor, setStrokeColor] = useState(BOARD_COLORS[0])
  const [fillColor, setFillColor] = useState<string>('transparent')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [strokeStyle, setStrokeStyle] = useState<StrokeStyle>('solid')
  const [opacity, setOpacity] = useState(1)
  const [stickyColor, setStickyColor] = useState(STICKY_COLORS[0].bg)
  const [pattern, setPattern] = useState<BoardPattern>('dots')
  const [boardTheme, setBoardTheme] = useState<BoardTheme>(() =>
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
  )

  const [camera, setCamera] = useState<Camera>({ panX: 0, panY: 0, zoom: 1 })
  const cameraRef = useRef<Camera>(camera)
  const [followPresenter, setFollowPresenter] = useState(false)
  const [fsLasers, setFsLasers] = useState<LaserTrail[]>([])
  const [fsPresenterCam, setFsPresenterCam] = useState<{
    cx: number
    cy: number
    zoom: number
    at: number
  } | null>(null)
  const [spacePressed, setSpacePressed] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [showMinimap, setShowMinimap] = useState(true)
  const [sectionCount, setSectionCount] = useState(1)
  const [renderTick, setRenderTick] = useState(0)

  const lastStreamSyncRef = useRef(0)
  const lastCamBroadcastRef = useRef(0)
  const lastFsLaserEmitRef = useRef(0)
  const lastFsLaserAtRef = useRef(0)
  const activeEditingIdsRef = useRef<Set<string>>(new Set())

  // Undo / Redo snapshot history
  const undoStackRef = useRef<BoardElement[][]>([])
  const redoStackRef = useRef<BoardElement[][]>([])
  const [historySizes, setHistorySizes] = useState({ undo: 0, redo: 0 })

  // Inline text / sticky editor
  const [textEdit, setTextEdit] = useState<{
    elementId: string | null
    kind: 'text' | 'sticky' | 'shape'
    wx: number
    wy: number
    w: number
    h: number
    value: string
    stickyBg?: string
  } | null>(null)

  // Local laser trail points
  const localLaserRef = useRef<{ x: number; y: number; at: number }[]>([])
  const lastLaserEmitRef = useRef(0)

  // Active pointer interaction
  const draftRef = useRef<BoardElement | null>(null)
  const marqueeRef = useRef<Rect | null>(null)
  const interactionRef = useRef<{
    mode:
      | 'pan'
      | 'draw'
      | 'erase'
      | 'marquee'
      | 'move'
      | 'resize'
      | 'rotate'
      | 'laser'
    pointerId: number
    startClientX: number
    startClientY: number
    startWx: number
    startWy: number
    startCamera: Camera
    handleId?: HandleId
    initialElements?: Map<string, BoardElement>
    initialBounds?: Rect
    erasedIds?: Set<string>
  } | null>(null)
  const activeTouchesRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchStartRef = useRef<{ dist: number; zoom: number; cx: number; cy: number; panX: number; panY: number } | null>(null)

  useLayoutEffect(() => {
    elementsRef.current = elements
    selectedIdsRef.current = selectedIds
    cameraRef.current = camera
  }, [elements, selectedIds, camera])

  // Keep backwards-compatible handle for MeetingRoom
  useImperativeHandle(
    handle,
    () => ({
      apply: () => {
        // Firestore sync handles real-time element collaboration
      },
      snapshot: () => ({ pages: [newPage()], current: 'infinite' }),
    }),
    [],
  )

  // ---- Firestore real-time sync --------------------------------------------
  const syncKey =
    syncScope?.kind === 'meeting'
      ? `meeting:${syncScope.meetingId}`
      : syncScope?.kind === 'board'
        ? `board:${syncScope.boardId}`
        : null

  const [seenSyncKey, setSeenSyncKey] = useState(syncKey)
  if (syncKey !== seenSyncKey) {
    setSeenSyncKey(syncKey)
    setElements([])
    setSelectedIds([])
  }

  useEffect(() => {
    if (!syncScope) return
    const unsubEls = subscribeWhiteboardElements<BoardElement>(
      syncScope,
      (remote) => {
        // Keep locally in-flight drawn/dragged elements authoritative until pointerUp
        const activeIds = activeEditingIdsRef.current
        const draftId = draftRef.current?.id
        if (activeIds.size === 0 && !draftId) {
          elementsRef.current = remote
          setElements(remote)
          return
        }
        const localById = new Map(elementsRef.current.map((e) => [e.id, e]))
        const merged = remote
          .filter((e) => e.id !== draftId)
          .map((e) => (activeIds.has(e.id) ? (localById.get(e.id) ?? e) : e))
        elementsRef.current = merged
        setElements(merged)
      },
    )
    const unsubMeta =
      syncScope.kind === 'board'
        ? subscribeWhiteboardMeta(syncScope.boardId, (meta) => {
            if (meta.backgroundType) setPattern(meta.backgroundType)
            if (meta.boardTheme) setBoardTheme(meta.boardTheme)
            if (
              meta.presenterCamera &&
              meta.presenterCamera.by !== author
            ) {
              setFsPresenterCam({
                cx: meta.presenterCamera.cx,
                cy: meta.presenterCamera.cy,
                zoom: meta.presenterCamera.zoom,
                at: meta.presenterCamera.at,
              })
            }
            if (
              meta.laser &&
              meta.laser.id !== author &&
              meta.laser.at > lastFsLaserAtRef.current &&
              Date.now() - meta.laser.at < 2000
            ) {
              lastFsLaserAtRef.current = meta.laser.at
              const l = meta.laser
              setFsLasers((prev) => {
                const nowTs = Date.now()
                const others = prev.filter((x) => x.id !== l.id)
                const cur = prev.find((x) => x.id === l.id)
                const pts = [
                  ...(cur?.points.filter((pt) => nowTs - pt.at < 1500) ?? []),
                  { x: l.x, y: l.y, at: nowTs },
                ]
                return [...others, { id: l.id, name: l.name, points: pts }]
              })
            }
          })
        : () => {}
    return () => {
      unsubEls()
      unsubMeta()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey, author])

  const syncUpsert = useCallback(
    (el: BoardElement) => {
      if (syncScope) void upsertWhiteboardElement(syncScope, el)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncKey],
  )

  const syncBatch = useCallback(
    (els: BoardElement[]) => {
      if (syncScope && els.length > 0)
        void upsertWhiteboardElementsBatch(syncScope, els)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncKey],
  )

  const syncDelete = useCallback(
    (ids: string[]) => {
      if (syncScope && ids.length > 0) void deleteWhiteboardElements(syncScope, ids)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncKey],
  )

  const persistPattern = useCallback(
    (next: BoardPattern) => {
      setPattern(next)
      if (syncScope?.kind === 'board') {
        void updateWhiteboardMeta(syncScope.boardId, { backgroundType: next })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncKey],
  )

  const persistBoardTheme = useCallback(
    (next: BoardTheme) => {
      setBoardTheme(next)
      if (syncScope?.kind === 'board') {
        void updateWhiteboardMeta(syncScope.boardId, { boardTheme: next })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncKey],
  )

  // Broadcast teacher viewport center + zoom so students in Follow Presenter mode stay aligned
  useEffect(() => {
    if (!isTeacher) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const now = Date.now()
    if (now - lastCamBroadcastRef.current < 160) return
    lastCamBroadcastRef.current = now
    const cx = (rect.width / 2 - camera.panX) / camera.zoom
    const cy = (rect.height / 2 - camera.panY) / camera.zoom
    onCameraBroadcast?.(cx, cy, camera.zoom)
    if (syncScope?.kind === 'board') {
      void updateWhiteboardMeta(syncScope.boardId, {
        presenterCamera: { cx, cy, zoom: camera.zoom, by: author, at: now },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, isTeacher, author, syncKey, onCameraBroadcast])

  // Apply Follow Presenter viewport when enabled for participants
  const latestPresenterCam = useMemo(() => {
    if (remotePresenterCamera && fsPresenterCam) {
      return remotePresenterCamera.at >= fsPresenterCam.at
        ? remotePresenterCamera
        : fsPresenterCam
    }
    return remotePresenterCamera ?? fsPresenterCam
  }, [remotePresenterCamera, fsPresenterCam])

  useEffect(() => {
    if (!followPresenter || isTeacher || !latestPresenterCam) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const z = clampZoom(latestPresenterCam.zoom)
    setCamera({
      zoom: z,
      panX: rect.width / 2 - latestPresenterCam.cx * z,
      panY: rect.height / 2 - latestPresenterCam.cy * z,
    })
  }, [followPresenter, isTeacher, latestPresenterCam])

  const mergedRemoteLasers = useMemo(
    () => [...remoteLasers, ...fsLasers],
    [remoteLasers, fsLasers],
  )

  const pushHistory = useCallback((prev: BoardElement[]) => {
    undoStackRef.current.push(prev)
    if (undoStackRef.current.length > 80) undoStackRef.current.shift()
    redoStackRef.current = []
    setHistorySizes({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    })
  }, [])

  const applyElementsReplace = useCallback(
    (prev: BoardElement[], next: BoardElement[]) => {
      elementsRef.current = next
      setElements(next)
      if (!syncScope) return
      const prevMap = new Map(prev.map((e) => [e.id, e]))
      const nextMap = new Map(next.map((e) => [e.id, e]))
      const toDelete: string[] = []
      const toUpsert: BoardElement[] = []
      for (const id of prevMap.keys()) {
        if (!nextMap.has(id)) toDelete.push(id)
      }
      for (const [id, el] of nextMap) {
        if (prevMap.get(id) !== el) toUpsert.push(el)
      }
      if (toDelete.length) syncDelete(toDelete)
      if (toUpsert.length) syncBatch(toUpsert)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncKey, syncDelete, syncBatch],
  )

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop()
    if (!prev) return
    const current = elementsRef.current
    redoStackRef.current.push(current)
    setHistorySizes({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    })
    applyElementsReplace(current, prev)
    setSelectedIds([])
  }, [applyElementsReplace])

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop()
    if (!next) return
    const current = elementsRef.current
    undoStackRef.current.push(current)
    setHistorySizes({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    })
    applyElementsReplace(current, next)
    setSelectedIds([])
  }, [applyElementsReplace])

  // ---- Coordinate conversions (1:1 against canvas.getBoundingClientRect) ---
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect =
      canvasRef.current?.getBoundingClientRect() ??
      containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const c = cameraRef.current
    return {
      x: (clientX - rect.left - c.panX) / c.zoom,
      y: (clientY - rect.top - c.panY) / c.zoom,
    }
  }, [])

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const rect =
        canvasRef.current?.getBoundingClientRect() ??
        containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const px = clientX !== undefined ? clientX - rect.left : rect.width / 2
      const py = clientY !== undefined ? clientY - rect.top : rect.height / 2
      setCamera((c) => {
        const nextZoom = clampZoom(c.zoom * factor)
        const ratio = nextZoom / c.zoom
        return {
          zoom: nextZoom,
          panX: px - (px - c.panX) * ratio,
          panY: py - (py - c.panY) * ratio,
        }
      })
    },
    [],
  )

  const resetView = useCallback(() => {
    const rect =
      canvasRef.current?.getBoundingClientRect() ??
      containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      setCamera({ panX: 0, panY: 0, zoom: 1 })
      return
    }
    setCamera({ panX: rect.width / 2, panY: rect.height / 2, zoom: 1 })
  }, [])

  const fitToContent = useCallback(() => {
    const rect =
      canvasRef.current?.getBoundingClientRect() ??
      containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const { width, height } = rect
    const bounds = getContentBounds(elementsRef.current)
    if (!bounds) {
      resetView()
      return
    }
    const pad = 72
    const zoom = clampZoom(
      Math.min(
        (width - pad * 2) / bounds.w,
        (height - pad * 2) / bounds.h,
        1.5,
      ),
    )
    setCamera({
      zoom,
      panX: width / 2 - (bounds.x + bounds.w / 2) * zoom,
      panY: height / 2 - (bounds.y + bounds.h / 2) * zoom,
    })
  }, [resetView])

  const addSection = useCallback(() => {
    const rect =
      canvasRef.current?.getBoundingClientRect() ??
      containerRef.current?.getBoundingClientRect()
    const width = rect?.width || 1200
    const nextIndex = sectionCount
    setSectionCount((n) => n + 1)
    setCamera((c) => ({
      zoom: 1,
      panX: width / 2 - nextIndex * 1400,
      panY: c.panY,
    }))
    toast.success(`Moved to fresh canvas space #${nextIndex + 1}`)
  }, [sectionCount])

  // ---- Main Canvas & Minimap Painting --------------------------------------
  const paintCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = container.getBoundingClientRect()
    const cssW = Math.max(1, rect.width || viewportRef.current.width)
    const cssH = Math.max(1, rect.height || viewportRef.current.height)
    const dpr = window.devicePixelRatio || 1
    const targetW = Math.max(1, Math.floor(cssW * dpr))
    const targetH = Math.max(1, Math.floor(cssH * dpr))

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      canvas.width = targetW
      canvas.height = targetH
    }
    viewportRef.current = { width: cssW, height: cssH }

    const cam = cameraRef.current

    ctx.save()
    // 1. Reset transform to Retina DPR BEFORE painting full logical viewport
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawInfiniteBackground(ctx, cssW, cssH, cam, pattern, boardTheme)

    // 2. Apply camera transform (pan + zoom) for all world-space objects
    ctx.translate(cam.panX, cam.panY)
    ctx.scale(cam.zoom, cam.zoom)

    const sorted = [...elementsRef.current].sort((a, b) => a.zIndex - b.zIndex)
    for (const el of sorted) {
      drawBoardElement(ctx, el, () => setRenderTick((t) => t + 1))
    }
    if (draftRef.current) {
      drawBoardElement(ctx, draftRef.current)
    }

    // Selection outlines & resize/rotate handles
    const selSet = new Set(selectedIdsRef.current)
    const selectedEls = sorted.filter((e) => selSet.has(e.id))
    if (selectedEls.length > 0 && canDraw) {
      const invZ = 1 / cam.zoom
      ctx.save()
      ctx.strokeStyle = '#236446'
      ctx.lineWidth = 1.5 * invZ
      ctx.setLineDash([5 * invZ, 4 * invZ])
      for (const el of selectedEls) {
        const b = getElementBounds(el)
        ctx.strokeRect(b.x - 4 * invZ, b.y - 4 * invZ, b.w + 8 * invZ, b.h + 8 * invZ)
      }
      ctx.setLineDash([])
      if (selectedEls.length === 1 && !selectedEls[0].locked) {
        const b = getElementBounds(selectedEls[0])
        const handles = getHandlePositions(b)
        const r = 5 * invZ
        // Rotate stem
        ctx.beginPath()
        ctx.moveTo(handles.n.x, handles.n.y)
        ctx.lineTo(handles.rotate.x, handles.rotate.y)
        ctx.stroke()
        for (const [key, pos] of Object.entries(handles)) {
          ctx.fillStyle = key === 'rotate' ? '#236446' : '#ffffff'
          ctx.strokeStyle = '#236446'
          ctx.lineWidth = 1.5 * invZ
          ctx.beginPath()
          if (key === 'rotate') {
            ctx.arc(pos.x, pos.y, r * 1.15, 0, Math.PI * 2)
          } else {
            ctx.rect(pos.x - r, pos.y - r, r * 2, r * 2)
          }
          ctx.fill()
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    // Marquee selection box
    if (marqueeRef.current) {
      const m = marqueeRef.current
      const invZ = 1 / cam.zoom
      ctx.save()
      ctx.fillStyle = 'rgba(35,100,70,0.12)'
      ctx.strokeStyle = '#236446'
      ctx.lineWidth = 1.25 * invZ
      ctx.setLineDash([4 * invZ, 3 * invZ])
      ctx.fillRect(m.x, m.y, m.w, m.h)
      ctx.strokeRect(m.x, m.y, m.w, m.h)
      ctx.restore()
    }

    // Laser pointer glowing fade trails (1.5s lifetime)
    const now = Date.now()
    const allLasers: { points: { x: number; y: number; at: number }[]; name?: string }[] = [
      { points: localLaserRef.current },
      ...mergedRemoteLasers,
    ]
    for (const trail of allLasers) {
      const fresh = trail.points.filter((pt) => now - pt.at < 1500)
      if (fresh.length === 0) continue
      const invZ = 1 / cam.zoom
      for (let i = 1; i < fresh.length; i++) {
        const p0 = fresh[i - 1]
        const p1 = fresh[i]
        const age = 1 - (now - p1.at) / 1500
        if (age <= 0) continue
        ctx.save()
        ctx.lineCap = 'round'
        ctx.strokeStyle = `rgba(217, 65, 50, ${age * 0.9})`
        ctx.shadowColor = 'rgba(217, 65, 50, 0.85)'
        ctx.shadowBlur = 12
        ctx.lineWidth = (2 + age * 6) * invZ
        ctx.beginPath()
        ctx.moveTo(p0.x, p0.y)
        ctx.lineTo(p1.x, p1.y)
        ctx.stroke()
        ctx.restore()
      }
      const tip = fresh[fresh.length - 1]
      const tipAge = 1 - (now - tip.at) / 1500
      if (tipAge > 0) {
        ctx.save()
        ctx.fillStyle = `rgba(255, 110, 90, ${tipAge})`
        ctx.shadowColor = 'rgba(217, 65, 50, 1)'
        ctx.shadowBlur = 14
        ctx.beginPath()
        ctx.arc(tip.x, tip.y, 5 * invZ, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    ctx.restore()

    // Paint Minimap (Retina DPR-scaled and aligned 1:1 with full viewport)
    const mini = minimapRef.current
    if (mini && showMinimap) {
      const mctx = mini.getContext('2d')
      if (mctx) {
        const mw = 176
        const mh = 112
        const targetMw = Math.max(1, Math.floor(mw * dpr))
        const targetMh = Math.max(1, Math.floor(mh * dpr))
        if (mini.width !== targetMw || mini.height !== targetMh) {
          mini.width = targetMw
          mini.height = targetMh
          mini.style.width = `${mw}px`
          mini.style.height = `${mh}px`
        }
        mctx.save()
        mctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        mctx.clearRect(0, 0, mw, mh)
        mctx.fillStyle = boardTheme === 'dark' ? '#171f1b' : '#faf9f5'
        mctx.fillRect(0, 0, mw, mh)

        const viewWorld: Rect = {
          x: -cam.panX / cam.zoom,
          y: -cam.panY / cam.zoom,
          w: cssW / cam.zoom,
          h: cssH / cam.zoom,
        }
        const content = getContentBounds(elementsRef.current)
        const minX = Math.min(viewWorld.x, content?.x ?? viewWorld.x) - 200
        const minY = Math.min(viewWorld.y, content?.y ?? viewWorld.y) - 200
        const maxX =
          Math.max(
            viewWorld.x + viewWorld.w,
            content ? content.x + content.w : viewWorld.x + viewWorld.w,
          ) + 200
        const maxY =
          Math.max(
            viewWorld.y + viewWorld.h,
            content ? content.y + content.h : viewWorld.y + viewWorld.h,
          ) + 200
        const spanW = Math.max(100, maxX - minX)
        const spanH = Math.max(100, maxY - minY)
        const scale = Math.min(mw / spanW, mh / spanH)
        const ox = (mw - spanW * scale) / 2 - minX * scale
        const oy = (mh - spanH * scale) / 2 - minY * scale

        for (const el of sorted) {
          const b = getElementBounds(el)
          mctx.fillStyle =
            el.kind === 'sticky'
              ? el.stickyBg || '#fef3c7'
              : el.strokeColor === '#ffffff'
                ? '#9ca3af'
                : el.strokeColor
          mctx.globalAlpha = 0.75
          mctx.fillRect(
            b.x * scale + ox,
            b.y * scale + oy,
            Math.max(2, b.w * scale),
            Math.max(2, b.h * scale),
          )
        }
        mctx.globalAlpha = 1
        mctx.strokeStyle = '#236446'
        mctx.fillStyle = 'rgba(35,100,70,0.14)'
        mctx.lineWidth = 1.5
        const vx = viewWorld.x * scale + ox
        const vy = viewWorld.y * scale + oy
        const vw = viewWorld.w * scale
        const vh = viewWorld.h * scale
        mctx.fillRect(vx, vy, vw, vh)
        mctx.strokeRect(vx, vy, vw, vh)
        mctx.restore()
      }
    }
  }, [pattern, boardTheme, canDraw, mergedRemoteLasers, showMinimap])

  // ResizeObserver + window resize so initial mount, window resize, and side
  // panel open/close ALWAYS keep the canvas 100% edge-to-edge and painted.
  const didInitCamera = useRef(false)
  const paintCanvasRef = useRef(paintCanvas)
  useLayoutEffect(() => {
    paintCanvasRef.current = paintCanvas
  }, [paintCanvas])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const resize = () => {
      const rect = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const c = canvasRef.current
      if (c && rect.width > 0 && rect.height > 0) {
        c.style.width = `${rect.width}px`
        c.style.height = `${rect.height}px`
        c.width = Math.max(1, Math.floor(rect.width * dpr))
        c.height = Math.max(1, Math.floor(rect.height * dpr))
        viewportRef.current = { width: rect.width, height: rect.height }
      }
      if (!didInitCamera.current && rect.width > 0 && rect.height > 0) {
        didInitCamera.current = true
        const nextCam = { panX: rect.width / 2, panY: rect.height / 2, zoom: 1 }
        cameraRef.current = nextCam
        setCamera(nextCam)
      }
      paintCanvasRef.current()
      setRenderTick((t) => t + 1)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    window.addEventListener('resize', resize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [])

  useEffect(() => {
    paintCanvas()
  }, [paintCanvas, elements, selectedIds, camera, renderTick])

  // Animate laser fade at 60fps while any laser points are active
  useEffect(() => {
    let raf = 0
    const step = () => {
      const now = Date.now()
      const hadLocal = localLaserRef.current.length > 0
      if (hadLocal) {
        localLaserRef.current = localLaserRef.current.filter(
          (p) => now - p.at < 1500,
        )
      }
      const hasRemote = mergedRemoteLasers.some((r) =>
        r.points.some((p) => now - p.at < 1500),
      )
      if (hadLocal || hasRemote) {
        paintCanvas()
        raf = requestAnimationFrame(step)
      }
    }
    if (localLaserRef.current.length > 0 || mergedRemoteLasers.length > 0) {
      raf = requestAnimationFrame(step)
    }
    return () => cancelAnimationFrame(raf)
  }, [mergedRemoteLasers, paintCanvas, renderTick])

  // ---- Selection operations ------------------------------------------------
  const selectedElements = useMemo(
    () => elements.filter((e) => selectedIds.includes(e.id)),
    [elements, selectedIds],
  )

  const deleteSelected = useCallback(() => {
    if (!canDraw || selectedIdsRef.current.length === 0) return
    const sel = new Set(selectedIdsRef.current)
    const deletable = elementsRef.current.filter(
      (e) => sel.has(e.id) && !e.locked,
    )
    if (deletable.length === 0) return
    const delIds = deletable.map((e) => e.id)
    const delSet = new Set(delIds)
    const prev = elementsRef.current
    const next = prev.filter((e) => !delSet.has(e.id))
    pushHistory(prev)
    elementsRef.current = next
    setElements(next)
    setSelectedIds([])
    syncDelete(delIds)
  }, [canDraw, pushHistory, syncDelete])

  const duplicateSelected = useCallback(() => {
    if (!canDraw || selectedIdsRef.current.length === 0) return
    const sel = new Set(selectedIdsRef.current)
    const prev = elementsRef.current
    const maxZ = prev.reduce((m, e) => Math.max(m, e.zIndex), 0)
    const copies: BoardElement[] = []
    let z = maxZ + 1
    for (const el of prev) {
      if (!sel.has(el.id)) continue
      copies.push({
        ...translateElement(el, 28, 28),
        id: makeElementId(),
        locked: false,
        zIndex: z++,
        createdAt: Date.now(),
      })
    }
    if (copies.length === 0) return
    const next = [...prev, ...copies]
    pushHistory(prev)
    elementsRef.current = next
    setElements(next)
    setSelectedIds(copies.map((c) => c.id))
    syncBatch(copies)
  }, [canDraw, pushHistory, syncBatch])

  const toggleLockSelected = useCallback(() => {
    if (!canDraw || selectedIdsRef.current.length === 0) return
    const sel = new Set(selectedIdsRef.current)
    const allLocked = elementsRef.current
      .filter((e) => sel.has(e.id))
      .every((e) => e.locked)
    const prev = elementsRef.current
    const changed: BoardElement[] = []
    const next = prev.map((e) => {
      if (!sel.has(e.id)) return e
      const updated = { ...e, locked: !allLocked }
      changed.push(updated)
      return updated
    })
    pushHistory(prev)
    elementsRef.current = next
    setElements(next)
    syncBatch(changed)
  }, [canDraw, pushHistory, syncBatch])

  const reorderSelected = useCallback(
    (dir: 'front' | 'back') => {
      if (!canDraw || selectedIdsRef.current.length === 0) return
      const sel = new Set(selectedIdsRef.current)
      const prev = elementsRef.current
      const minZ = prev.reduce((m, e) => Math.min(m, e.zIndex), 0)
      const maxZ = prev.reduce((m, e) => Math.max(m, e.zIndex), 0)
      let z = dir === 'front' ? maxZ + 1 : minZ - sel.size - 1
      const changed: BoardElement[] = []
      const next = prev.map((e) => {
        if (!sel.has(e.id)) return e
        const updated = { ...e, zIndex: z++ }
        changed.push(updated)
        return updated
      })
      pushHistory(prev)
      elementsRef.current = next
      setElements(next)
      syncBatch(changed)
    },
    [canDraw, pushHistory, syncBatch],
  )

  const insertTemplate = useCallback(
    (kind: TemplateKind) => {
      if (!canDraw) return
      const el = containerRef.current
      const rect = el?.getBoundingClientRect()
      const cx = rect
        ? (rect.width / 2 - cameraRef.current.panX) / cameraRef.current.zoom
        : 0
      const cy = rect
        ? (rect.height / 2 - cameraRef.current.panY) / cameraRef.current.zoom
        : 0
      const prev = elementsRef.current
      const maxZ = prev.reduce((m, e) => Math.max(m, e.zIndex), 0)
      const items = createTemplateElements(kind, cx, cy, author, maxZ + 1)
      const next = [...prev, ...items]
      pushHistory(prev)
      elementsRef.current = next
      setElements(next)
      setSelectedIds(items.map((i) => i.id))
      setTool('select')
      syncBatch(items)
      toast.success('Template added to board')
    },
    [author, canDraw, pushHistory, syncBatch],
  )

  const addImageAt = useCallback(
    async (file: File, wx?: number, wy?: number) => {
      if (!canDraw) return
      try {
        const { dataUrl, width, height } = await compressImageFile(file)
        const rect = containerRef.current?.getBoundingClientRect()
        const cx =
          wx ??
          (rect
            ? (rect.width / 2 - cameraRef.current.panX) / cameraRef.current.zoom
            : 0)
        const cy =
          wy ??
          (rect
            ? (rect.height / 2 - cameraRef.current.panY) /
              cameraRef.current.zoom
            : 0)
        const prev = elementsRef.current
        const maxZ = prev.reduce((m, e) => Math.max(m, e.zIndex), 0)
        const imgEl: BoardElement = {
          id: makeElementId(),
          kind: 'image',
          x: cx - width / 2,
          y: cy - height / 2,
          w: width,
          h: height,
          rotation: 0,
          strokeColor: '#1f2924',
          fillColor: 'transparent',
          strokeWidth: 1,
          strokeStyle: 'solid',
          opacity: 1,
          imageDataUrl: dataUrl,
          zIndex: maxZ + 1,
          author,
          createdAt: Date.now(),
        }
        const next = [...prev, imgEl]
        pushHistory(prev)
        elementsRef.current = next
        setElements(next)
        setSelectedIds([imgEl.id])
        setTool('select')
        syncUpsert(imgEl)
      } catch {
        toast.error('Could not load that image.')
      }
    },
    [author, canDraw, pushHistory, syncUpsert],
  )

  const clearBoardConfirmed = useCallback(() => {
    setClearConfirmOpen(false)
    if (!canDraw) return
    const prev = elementsRef.current
    if (prev.length === 0) return
    pushHistory(prev)
    elementsRef.current = []
    setElements([])
    setSelectedIds([])
    if (syncScope) void clearWhiteboardCollection(syncScope)
    onOp?.({ type: 'clear', page: 'infinite' })
    toast.success('Whiteboard cleared')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDraw, onOp, pushHistory, syncKey])

  // ---- Inline text / sticky commit -----------------------------------------
  const commitTextEdit = useCallback(
    (value: string) => {
      const edit = textEdit
      setTextEdit(null)
      if (!edit) return
      const trimmed = value.trimEnd()
      const prev = elementsRef.current

      if (edit.elementId) {
        const existing = prev.find((e) => e.id === edit.elementId)
        if (!existing) return
        if (!trimmed && existing.kind === 'text') {
          pushHistory(prev)
          const next = prev.filter((e) => e.id !== edit.elementId)
          elementsRef.current = next
          setElements(next)
          syncDelete([edit.elementId])
          return
        }
        const updated: BoardElement = { ...existing, text: trimmed }
        pushHistory(prev)
        const next = prev.map((e) => (e.id === edit.elementId ? updated : e))
        elementsRef.current = next
        setElements(next)
        syncUpsert(updated)
        return
      }

      if (!trimmed && edit.kind === 'text') return
      const maxZ = prev.reduce((m, e) => Math.max(m, e.zIndex), 0)
      const created: BoardElement =
        edit.kind === 'sticky'
          ? {
              id: makeElementId(),
              kind: 'sticky',
              x: edit.wx,
              y: edit.wy,
              w: edit.w,
              h: edit.h,
              rotation: 0,
              strokeColor,
              fillColor: 'transparent',
              strokeWidth: 2,
              strokeStyle: 'solid',
              opacity,
              text: trimmed || 'Note',
              fontSize: 16,
              stickyBg: edit.stickyBg || stickyColor,
              zIndex: maxZ + 1,
              author,
              createdAt: Date.now(),
            }
          : {
              id: makeElementId(),
              kind: 'text',
              x: edit.wx,
              y: edit.wy,
              w: Math.max(140, trimmed.length * 11),
              h: Math.max(32, trimmed.split('\n').length * 28),
              rotation: 0,
              strokeColor,
              fillColor: 'transparent',
              strokeWidth,
              strokeStyle: 'solid',
              opacity,
              text: trimmed,
              fontSize: Math.max(18, strokeWidth * 5),
              zIndex: maxZ + 1,
              author,
              createdAt: Date.now(),
            }
      pushHistory(prev)
      const next = [...prev, created]
      elementsRef.current = next
      setElements(next)
      setSelectedIds([created.id])
      syncUpsert(created)
    },
    [
      author,
      opacity,
      pushHistory,
      stickyColor,
      strokeColor,
      strokeWidth,
      syncDelete,
      syncUpsert,
      textEdit,
    ],
  )

  // ---- Pointer Events ------------------------------------------------------
  const hitElementTop = (wx: number, wy: number) => {
    const tol = 8 / cameraRef.current.zoom
    const sorted = [...elementsRef.current].sort((a, b) => b.zIndex - a.zIndex)
    return sorted.find((el) => hitTestElement(el, wx, wy, tol)) ?? null
  }

  const hitHandle = (el: BoardElement, wx: number, wy: number): HandleId | null => {
    if (el.locked) return null
    const handles = getHandlePositions(getElementBounds(el))
    const tol = 10 / cameraRef.current.zoom
    for (const [id, pos] of Object.entries(handles) as [
      HandleId,
      { x: number; y: number },
    ][]) {
      if (Math.hypot(wx - pos.x, wy - pos.y) <= tol) return id
    }
    return null
  }

  const eraseAt = (wx: number, wy: number) => {
    const hit = hitElementTop(wx, wy)
    if (!hit || hit.locked) return
    interactionRef.current?.erasedIds?.add(hit.id)
    const next = elementsRef.current.filter((e) => e.id !== hit.id)
    elementsRef.current = next
    setElements(next)
    setSelectedIds((s) => s.filter((id) => id !== hit.id))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (textEdit) return
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)

    // Track multi-touch for pinch zoom
    if (e.pointerType === 'touch') {
      activeTouchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (activeTouchesRef.current.size === 2) {
        const pts = Array.from(activeTouchesRef.current.values())
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        const cx = (pts[0].x + pts[1].x) / 2
        const cy = (pts[0].y + pts[1].y) / 2
        pinchStartRef.current = {
          dist,
          zoom: cameraRef.current.zoom,
          cx,
          cy,
          panX: cameraRef.current.panX,
          panY: cameraRef.current.panY,
        }
        interactionRef.current = null
        return
      }
    }

    const isPan =
      tool === 'hand' ||
      spacePressed ||
      e.button === 1 ||
      (!canDraw && e.button === 0)

    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY)

    if (isPan) {
      if (followPresenter) setFollowPresenter(false)
      interactionRef.current = {
        mode: 'pan',
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWx: wx,
        startWy: wy,
        startCamera: { ...cameraRef.current },
      }
      return
    }

    if (!canDraw || e.button !== 0) return

    if (tool === 'laser') {
      interactionRef.current = {
        mode: 'laser',
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWx: wx,
        startWy: wy,
        startCamera: { ...cameraRef.current },
      }
      localLaserRef.current.push({ x: wx, y: wy, at: Date.now() })
      onLaser?.(wx, wy)
      if (syncScope?.kind === 'board') {
        void updateWhiteboardMeta(syncScope.boardId, {
          laser: {
            id: author,
            name: authorName || 'Presenter',
            x: wx,
            y: wy,
            at: Date.now(),
          },
        })
      }
      setRenderTick((t) => t + 1)
      return
    }

    if (tool === 'text') {
      setTextEdit({
        elementId: null,
        kind: 'text',
        wx,
        wy,
        w: 220,
        h: 44,
        value: '',
      })
      return
    }

    if (tool === 'sticky') {
      setTextEdit({
        elementId: null,
        kind: 'sticky',
        wx: wx - 90,
        wy: wy - 70,
        w: 190,
        h: 150,
        value: '',
        stickyBg: stickyColor,
      })
      return
    }

    if (tool === 'eraser') {
      const before = elementsRef.current
      interactionRef.current = {
        mode: 'erase',
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWx: wx,
        startWy: wy,
        startCamera: { ...cameraRef.current },
        initialElements: new Map(before.map((el) => [el.id, el])),
        erasedIds: new Set<string>(),
      }
      eraseAt(wx, wy)
      return
    }

    if (tool === 'select') {
      // Check resize / rotate handles on single selected element
      if (selectedIdsRef.current.length === 1) {
        const selEl = elementsRef.current.find(
          (el) => el.id === selectedIdsRef.current[0],
        )
        if (selEl) {
          const handleId = hitHandle(selEl, wx, wy)
          if (handleId) {
            activeEditingIdsRef.current = new Set([selEl.id])
            interactionRef.current = {
              mode: handleId === 'rotate' ? 'rotate' : 'resize',
              pointerId: e.pointerId,
              startClientX: e.clientX,
              startClientY: e.clientY,
              startWx: wx,
              startWy: wy,
              startCamera: { ...cameraRef.current },
              handleId,
              initialElements: new Map([[selEl.id, selEl]]),
              initialBounds: getElementBounds(selEl),
            }
            return
          }
        }
      }

      const hit = hitElementTop(wx, wy)
      if (hit) {
        let nextSel = selectedIdsRef.current
        if (e.shiftKey) {
          nextSel = nextSel.includes(hit.id)
            ? nextSel.filter((id) => id !== hit.id)
            : [...nextSel, hit.id]
        } else if (!nextSel.includes(hit.id)) {
          nextSel = [hit.id]
        }
        selectedIdsRef.current = nextSel
        setSelectedIds(nextSel)

        const movable = elementsRef.current.filter(
          (el) => nextSel.includes(el.id) && !el.locked,
        )
        if (movable.length > 0) {
          activeEditingIdsRef.current = new Set(movable.map((el) => el.id))
          interactionRef.current = {
            mode: 'move',
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startWx: wx,
            startWy: wy,
            startCamera: { ...cameraRef.current },
            initialElements: new Map(movable.map((el) => [el.id, el])),
          }
        }
      } else {
        setSelectedIds([])
        marqueeRef.current = { x: wx, y: wy, w: 0, h: 0 }
        interactionRef.current = {
          mode: 'marquee',
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startWx: wx,
          startWy: wy,
          startCamera: { ...cameraRef.current },
        }
      }
      return
    }

    // Drawing tools (pen, highlighter, line, arrow, shapes)
    const maxZ = elementsRef.current.reduce((m, el) => Math.max(m, el.zIndex), 0)
    const kind = tool as ElementKind
    const isFree = kind === 'pen' || kind === 'highlighter'
    const isLine = kind === 'line' || kind === 'arrow'
    const draft: BoardElement = {
      id: makeElementId(),
      kind,
      x: wx,
      y: wy,
      w: 0,
      h: 0,
      points: isFree || isLine ? [wx, wy, wx, wy] : undefined,
      rotation: 0,
      strokeColor,
      fillColor: isFree || isLine ? 'transparent' : fillColor,
      strokeWidth,
      strokeStyle,
      opacity,
      zIndex: maxZ + 1,
      author,
      createdAt: Date.now(),
    }
    draftRef.current = draft
    interactionRef.current = {
      mode: 'draw',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWx: wx,
      startWy: wy,
      startCamera: { ...cameraRef.current },
    }
    paintCanvas()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && activeTouchesRef.current.has(e.pointerId)) {
      activeTouchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (activeTouchesRef.current.size === 2 && pinchStartRef.current) {
        const pts = Array.from(activeTouchesRef.current.values())
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        const ps = pinchStartRef.current
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect && ps.dist > 0) {
          const nextZoom = clampZoom(ps.zoom * (dist / ps.dist))
          const ratio = nextZoom / ps.zoom
          const px = ps.cx - rect.left
          const py = ps.cy - rect.top
          setCamera({
            zoom: nextZoom,
            panX: px - (px - ps.panX) * ratio,
            panY: py - (py - ps.panY) * ratio,
          })
        }
        return
      }
    }

    const inter = interactionRef.current
    if (!inter || inter.pointerId !== e.pointerId) return

    if (inter.mode === 'pan') {
      setCamera({
        ...inter.startCamera,
        panX: inter.startCamera.panX + (e.clientX - inter.startClientX),
        panY: inter.startCamera.panY + (e.clientY - inter.startClientY),
      })
      return
    }

    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY)

    if (inter.mode === 'laser') {
      const now = Date.now()
      localLaserRef.current.push({ x: wx, y: wy, at: now })
      if (now - lastLaserEmitRef.current > 35) {
        lastLaserEmitRef.current = now
        onLaser?.(wx, wy)
      }
      if (syncScope?.kind === 'board' && now - lastFsLaserEmitRef.current > 90) {
        lastFsLaserEmitRef.current = now
        void updateWhiteboardMeta(syncScope.boardId, {
          laser: {
            id: author,
            name: authorName || 'Presenter',
            x: wx,
            y: wy,
            at: now,
          },
        })
      }
      setRenderTick((t) => t + 1)
      return
    }

    if (inter.mode === 'erase') {
      eraseAt(wx, wy)
      return
    }

    if (inter.mode === 'marquee') {
      marqueeRef.current = {
        x: Math.min(inter.startWx, wx),
        y: Math.min(inter.startWy, wy),
        w: Math.abs(wx - inter.startWx),
        h: Math.abs(wy - inter.startWy),
      }
      paintCanvas()
      return
    }

    if (inter.mode === 'move' && inter.initialElements) {
      const dx = wx - inter.startWx
      const dy = wy - inter.startWy
      const movedEls: BoardElement[] = []
      const next = elementsRef.current.map((el) => {
        const orig = inter.initialElements!.get(el.id)
        if (!orig) return el
        const translated = translateElement(orig, dx, dy)
        movedEls.push(translated)
        return translated
      })
      elementsRef.current = next
      setElements(next)
      const now = Date.now()
      if (movedEls.length > 0 && now - lastStreamSyncRef.current > 90) {
        lastStreamSyncRef.current = now
        syncBatch(movedEls)
      }
      return
    }

    if (inter.mode === 'resize' && inter.initialElements && inter.initialBounds && inter.handleId) {
      const [id, orig] = Array.from(inter.initialElements.entries())[0]
      const b = inter.initialBounds
      let x = b.x
      let y = b.y
      let w = b.w
      let h = b.h
      const dx = wx - inter.startWx
      const dy = wy - inter.startWy
      const hid = inter.handleId
      if (hid.includes('e')) w = Math.max(16, b.w + dx)
      if (hid.includes('s')) h = Math.max(16, b.h + dy)
      if (hid.includes('w')) {
        const nx = Math.min(b.x + b.w - 16, b.x + dx)
        w = b.x + b.w - nx
        x = nx
      }
      if (hid.includes('n')) {
        const ny = Math.min(b.y + b.h - 16, b.y + dy)
        h = b.y + b.h - ny
        y = ny
      }
      const resized = resizeElementToBounds(orig, { x, y, w, h })
      const next = elementsRef.current.map((el) => (el.id === id ? resized : el))
      elementsRef.current = next
      setElements(next)
      const now = Date.now()
      if (now - lastStreamSyncRef.current > 90) {
        lastStreamSyncRef.current = now
        syncUpsert(resized)
      }
      return
    }

    if (inter.mode === 'rotate' && inter.initialElements && inter.initialBounds) {
      const [id, orig] = Array.from(inter.initialElements.entries())[0]
      const b = inter.initialBounds
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      const angle = Math.atan2(wy - cy, wx - cx) + Math.PI / 2
      const snapped = e.shiftKey
        ? Math.round(angle / (Math.PI / 12)) * (Math.PI / 12)
        : angle
      const rotated = { ...orig, rotation: snapped }
      const next = elementsRef.current.map((el) =>
        el.id === id ? rotated : el,
      )
      elementsRef.current = next
      setElements(next)
      const now = Date.now()
      if (now - lastStreamSyncRef.current > 90) {
        lastStreamSyncRef.current = now
        syncUpsert(rotated)
      }
      return
    }

    if (inter.mode === 'draw' && draftRef.current) {
      const d = draftRef.current
      if (d.kind === 'pen' || d.kind === 'highlighter') {
        const pts = d.points!
        const lx = pts[pts.length - 2]
        const ly = pts[pts.length - 1]
        if (Math.hypot(wx - lx, wy - ly) < 1.5 / cameraRef.current.zoom) return
        pts.push(wx, wy)
      } else if (d.kind === 'line' || d.kind === 'arrow') {
        d.points = [inter.startWx, inter.startWy, wx, wy]
        d.w = wx - inter.startWx
        d.h = wy - inter.startWy
      } else {
        d.x = Math.min(inter.startWx, wx)
        d.y = Math.min(inter.startWy, wy)
        d.w = Math.abs(wx - inter.startWx)
        d.h = Math.abs(wy - inter.startWy)
      }
      paintCanvas()
      // Stream live stroke to Firestore so opposite joiners watch drawing in real time
      const now = Date.now()
      if (now - lastStreamSyncRef.current > 85) {
        lastStreamSyncRef.current = now
        syncUpsert({ ...d, points: d.points ? [...d.points] : undefined })
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      activeTouchesRef.current.delete(e.pointerId)
      if (activeTouchesRef.current.size < 2) pinchStartRef.current = null
    }
    const inter = interactionRef.current
    if (!inter || inter.pointerId !== e.pointerId) return
    interactionRef.current = null

    if (inter.mode === 'marquee') {
      const m = marqueeRef.current
      marqueeRef.current = null
      if (m && (m.w > 4 || m.h > 4)) {
        const hits = elementsRef.current
          .filter((el) => rectsIntersect(m, getElementBounds(el)))
          .map((el) => el.id)
        setSelectedIds(hits)
      }
      paintCanvas()
      return
    }

    if (inter.mode === 'erase' && inter.erasedIds && inter.erasedIds.size > 0) {
      const before = Array.from(inter.initialElements?.values() ?? [])
      pushHistory(before)
      syncDelete(Array.from(inter.erasedIds))
      return
    }

    if (
      (inter.mode === 'move' || inter.mode === 'resize' || inter.mode === 'rotate') &&
      inter.initialElements
    ) {
      activeEditingIdsRef.current.clear()
      const moved =
        Math.hypot(
          e.clientX - inter.startClientX,
          e.clientY - inter.startClientY,
        ) > 2
      if (moved) {
        const prev = elementsRef.current.map(
          (el) => inter.initialElements!.get(el.id) ?? el,
        )
        pushHistory(prev)
        const updated = elementsRef.current.filter((el) =>
          inter.initialElements!.has(el.id),
        )
        syncBatch(updated)
      }
      return
    }

    if (inter.mode === 'draw' && draftRef.current) {
      const draft = draftRef.current
      draftRef.current = null
      const b = getElementBounds(draft)
      if (
        draft.kind !== 'pen' &&
        draft.kind !== 'highlighter' &&
        Math.hypot(b.w, b.h) < 4
      ) {
        syncDelete([draft.id])
        paintCanvas()
        return
      }
      const prev = elementsRef.current
      const next = [...prev.filter((el) => el.id !== draft.id), draft]
      pushHistory(prev)
      elementsRef.current = next
      setElements(next)
      syncUpsert(draft)
      if (syncScope?.kind === 'board') {
        void updateWhiteboardMeta(syncScope.boardId, {
          elementCount: next.length,
          updatedAt: Date.now(),
        })
      }
      paintCanvas()
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!canDraw) return
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY)
    const hit = hitElementTop(wx, wy)
    if (
      hit &&
      !hit.locked &&
      (hit.kind === 'text' ||
        hit.kind === 'sticky' ||
        hit.kind === 'rect' ||
        hit.kind === 'rounded-rect' ||
        hit.kind === 'ellipse' ||
        hit.kind === 'diamond' ||
        hit.kind === 'speech-bubble')
    ) {
      const b = getElementBounds(hit)
      setTextEdit({
        elementId: hit.id,
        kind:
          hit.kind === 'text'
            ? 'text'
            : hit.kind === 'sticky'
              ? 'sticky'
              : 'shape',
        wx: b.x,
        wy: b.y,
        w: Math.max(160, b.w),
        h: Math.max(44, b.h),
        value: hit.text ?? '',
        stickyBg: hit.stickyBg,
      })
    } else if (tool === 'hand') {
      fitToContent()
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    if (followPresenter) setFollowPresenter(false)
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY)
    } else {
      setCamera((c) => ({
        ...c,
        panX: c.panX - e.deltaX,
        panY: c.panY - e.deltaY,
      }))
    }
  }

  // Drag-and-drop image upload
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (!canDraw) return
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const { x, y } = screenToWorld(e.clientX, e.clientY)
    void addImageAt(file, x, y)
  }

  // Interactive Minimap click/drag panning (aligned with logical 176x112 minimap)
  const panFromMinimap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const mini = minimapRef.current
    const container = containerRef.current
    if (!mini || !container) return
    const mrect = mini.getBoundingClientRect()
    const crect =
      canvasRef.current?.getBoundingClientRect() ??
      container.getBoundingClientRect()
    const cam = cameraRef.current
    const mw = mrect.width || 176
    const mh = mrect.height || 112
    const viewWorld: Rect = {
      x: -cam.panX / cam.zoom,
      y: -cam.panY / cam.zoom,
      w: crect.width / cam.zoom,
      h: crect.height / cam.zoom,
    }
    const content = getContentBounds(elementsRef.current)
    const minX = Math.min(viewWorld.x, content?.x ?? viewWorld.x) - 200
    const minY = Math.min(viewWorld.y, content?.y ?? viewWorld.y) - 200
    const maxX =
      Math.max(
        viewWorld.x + viewWorld.w,
        content ? content.x + content.w : viewWorld.x + viewWorld.w,
      ) + 200
    const maxY =
      Math.max(
        viewWorld.y + viewWorld.h,
        content ? content.y + content.h : viewWorld.y + viewWorld.h,
      ) + 200
    const spanW = Math.max(100, maxX - minX)
    const spanH = Math.max(100, maxY - minY)
    const scale = Math.min(mw / spanW, mh / spanH)
    const ox = (mw - spanW * scale) / 2 - minX * scale
    const oy = (mh - spanH * scale) / 2 - minY * scale

    const mx = e.clientX - mrect.left
    const my = e.clientY - mrect.top
    const targetWx = (mx - ox) / scale
    const targetWy = (my - oy) / scale
    setCamera((c) => ({
      ...c,
      panX: crect.width / 2 - targetWx * c.zoom,
      panY: crect.height / 2 - targetWy * c.zoom,
    }))
  }

  // ---- Keyboard shortcuts --------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'INPUT' ||
        target?.isContentEditable
      )
        return
      if (e.code === 'Space') {
        setSpacePressed(true)
        return
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
          e.preventDefault()
          undo()
        } else if (
          e.key.toLowerCase() === 'y' ||
          (e.key.toLowerCase() === 'z' && e.shiftKey)
        ) {
          e.preventDefault()
          redo()
        } else if (e.key.toLowerCase() === 'd') {
          e.preventDefault()
          duplicateSelected()
        }
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedIdsRef.current.length > 0) {
          e.preventDefault()
          deleteSelected()
        }
        return
      }
      if (!canDraw) return
      const keyMap: Record<string, InfiniteTool> = {
        v: 'select',
        '1': 'pen',
        '2': 'highlighter',
        '3': 'eraser',
        '4': 'text',
        '5': 'sticky',
        '6': 'line',
        '7': 'arrow',
        '8': 'rect',
        '9': 'ellipse',
        '0': 'laser',
      }
      if (keyMap[e.key.toLowerCase()]) {
        setTool(keyMap[e.key.toLowerCase()])
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [canDraw, deleteSelected, duplicateSelected, redo, undo])

  // ---- Export & Import -----------------------------------------------------
  const downloadBlob = (blob: Blob, filename: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1500)
  }

  const exportPng = (mode: 'view' | 'full') => {
    const rect = containerRef.current?.getBoundingClientRect()
    const cam = cameraRef.current
    const bounds: Rect =
      mode === 'view' && rect
        ? {
            x: -cam.panX / cam.zoom,
            y: -cam.panY / cam.zoom,
            w: rect.width / cam.zoom,
            h: rect.height / cam.zoom,
          }
        : (getContentBounds(elementsRef.current) ?? {
            x: -600,
            y: -400,
            w: 1200,
            h: 800,
          })
    const canvas = renderExportCanvas(elementsRef.current, {
      bounds,
      scale: 1.5,
      theme: boardTheme,
      pattern,
    })
    canvas.toBlob((blob) => {
      if (blob)
        downloadBlob(
          blob,
          `${(title || 'lectern-whiteboard').replace(/[^\w-]+/g, '_')}-${mode}.png`,
        )
    }, 'image/png')
  }

  const exportSvg = () => {
    const svg = exportBoardSvg(elementsRef.current, boardTheme)
    downloadBlob(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      `${(title || 'lectern-whiteboard').replace(/[^\w-]+/g, '_')}.svg`,
    )
  }

  const exportPdf = () => {
    try {
      const bounds = getContentBounds(elementsRef.current) ?? {
        x: -600,
        y: -400,
        w: 1200,
        h: 800,
      }
      const canvas = renderExportCanvas(elementsRef.current, {
        bounds,
        scale: 1.2,
        theme: boardTheme,
        pattern,
      })
      const blob = buildPdf([
        {
          dataUrl: canvas.toDataURL('image/jpeg', 0.92),
          width: canvas.width,
          height: canvas.height,
        },
      ])
      downloadBlob(
        blob,
        `${(title || 'lectern-whiteboard').replace(/[^\w-]+/g, '_')}.pdf`,
      )
    } catch {
      toast.error('Could not export PDF.')
    }
  }

  const exportJson = () => {
    const json = exportBoardJson(elementsRef.current)
    downloadBlob(
      new Blob([json], { type: 'application/json' }),
      `${(title || 'lectern-whiteboard').replace(/[^\w-]+/g, '_')}.json`,
    )
  }

  const importJson = async (file: File) => {
    try {
      const raw = await file.text()
      const imported = parseBoardJson(raw)
      const prev = elementsRef.current
      pushHistory(prev)
      elementsRef.current = imported
      setElements(imported)
      setSelectedIds([])
      if (syncScope) {
        await clearWhiteboardCollection(syncScope)
        await upsertWhiteboardElementsBatch(syncScope, imported)
      }
      setTimeout(fitToContent, 40)
      toast.success(`Imported ${imported.length} elements`)
    } catch {
      toast.error('Could not import whiteboard JSON.')
    }
  }

  const cursor =
    tool === 'hand' || spacePressed || !canDraw
      ? 'grab'
      : tool === 'select'
        ? 'default'
        : tool === 'text'
          ? 'text'
          : tool === 'eraser'
            ? 'cell'
            : 'crosshair'

  const activeShapeIcon =
    SHAPE_TOOLS.find((s) => s.tool === tool)?.icon ??
    SHAPE_TOOLS.find((s) => s.tool === lastShapeTool)?.icon ??
    Square
  const ActiveShapeIcon = activeShapeIcon
  const isShapeActive = SHAPE_TOOLS.some((s) => s.tool === tool)

  const editorScreen = textEdit
    ? {
        sx: textEdit.wx * camera.zoom + camera.panX,
        sy: textEdit.wy * camera.zoom + camera.panY,
      }
    : null

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground',
        className,
      )}
    >
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void addImageAt(f)
          e.target.value = ''
        }}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importJson(f)
          e.target.value = ''
        }}
      />

      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card px-2 py-1.5 text-card-foreground">
        {canDraw ? (
          <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5">
            <ToolButton
              label="Select (V)"
              active={tool === 'select'}
              onClick={() => setTool('select')}
            >
              <MousePointer2 className="size-4" />
            </ToolButton>
            <ToolButton
              label="Hand / Pan (Space)"
              active={tool === 'hand'}
              onClick={() => setTool('hand')}
            >
              <Hand className="size-4" />
            </ToolButton>
            <ToolButton
              label="Pen"
              active={tool === 'pen'}
              onClick={() => setTool('pen')}
            >
              <Pen className="size-4" />
            </ToolButton>
            <ToolButton
              label="Highlighter"
              active={tool === 'highlighter'}
              onClick={() => setTool('highlighter')}
            >
              <Highlighter className="size-4" />
            </ToolButton>
            <ToolButton
              label="Line"
              active={tool === 'line'}
              onClick={() => setTool('line')}
            >
              <Minus className="size-4" />
            </ToolButton>
            <ToolButton
              label="Arrow"
              active={tool === 'arrow'}
              onClick={() => setTool('arrow')}
            >
              <ArrowUpRight className="size-4" />
            </ToolButton>

            {/* Shapes Menu */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Shapes"
                      aria-pressed={isShapeActive}
                      className={cn(
                        'grid size-8 place-items-center rounded-md transition-colors motion-reduce:transition-none',
                        isShapeActive
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-background',
                      )}
                    >
                      <ActiveShapeIcon className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Shapes</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuLabel>Shapes</DropdownMenuLabel>
                {SHAPE_TOOLS.map((s) => (
                  <DropdownMenuItem
                    key={s.tool}
                    onSelect={() => {
                      setLastShapeTool(s.tool)
                      setTool(s.tool)
                    }}
                  >
                    <s.icon className="size-4" /> {s.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Border style</DropdownMenuLabel>
                {(['solid', 'dashed', 'dotted'] as StrokeStyle[]).map((st) => (
                  <DropdownMenuItem
                    key={st}
                    onSelect={() => setStrokeStyle(st)}
                  >
                    <span className="capitalize">{st}</span>
                    {strokeStyle === st && (
                      <span className="ml-auto text-xs text-primary">●</span>
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    setFillColor((f) =>
                      f === 'transparent' ? `${strokeColor}26` : 'transparent',
                    )
                  }
                >
                  {fillColor === 'transparent'
                    ? 'Enable shape fill'
                    : 'Transparent shape fill'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <ToolButton
              label="Text"
              active={tool === 'text'}
              onClick={() => setTool('text')}
            >
              <Type className="size-4" />
            </ToolButton>
            <ToolButton
              label="Sticky note"
              active={tool === 'sticky'}
              onClick={() => setTool('sticky')}
            >
              <StickyNote className="size-4" />
            </ToolButton>
            <ToolButton
              label="Upload image"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-4" />
            </ToolButton>
            <ToolButton
              label="Laser pointer"
              active={tool === 'laser'}
              onClick={() => setTool('laser')}
            >
              <Sparkles className="size-4" />
            </ToolButton>
            <ToolButton
              label="Eraser"
              active={tool === 'eraser'}
              onClick={() => setTool('eraser')}
            >
              <Eraser className="size-4" />
            </ToolButton>

            {/* Quick Templates */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Templates"
                      className="grid size-8 place-items-center rounded-md hover:bg-background"
                    >
                      <LayoutTemplate className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Quick templates</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuLabel>Insert template</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => insertTemplate('flowchart')}>
                  Flowchart
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => insertTemplate('mindmap')}>
                  Mind Map
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => insertTemplate('kanban')}>
                  Kanban Board
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => insertTemplate('matrix2x2')}>
                  2×2 Matrix
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => insertTemplate('coordGrid')}>
                  Coordinate Grid
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <span className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            View only. Your teacher controls who can draw.
          </span>
        )}

        {/* Color swatches, width, opacity */}
        {canDraw && (
          <div className="flex flex-wrap items-center gap-1.5">
            {tool === 'sticky' ? (
              <div className="flex items-center gap-1" aria-label="Sticky note colour">
                {STICKY_COLORS.map((sc) => (
                  <button
                    key={sc.bg}
                    type="button"
                    aria-label={`Sticky ${sc.name}`}
                    onClick={() => setStickyColor(sc.bg)}
                    className={cn(
                      'size-5 rounded border border-black/15 transition-transform',
                      stickyColor === sc.bg && 'scale-110 ring-2 ring-ring',
                    )}
                    style={{ background: sc.bg }}
                  />
                ))}
              </div>
            ) : (
              <div
                className="flex items-center gap-1"
                role="radiogroup"
                aria-label="Colour"
              >
                {BOARD_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={strokeColor === c}
                    aria-label={`Colour ${c}`}
                    onClick={() => setStrokeColor(c)}
                    className={cn(
                      'size-5 rounded-full border border-black/15 transition-transform motion-reduce:transition-none',
                      strokeColor === c &&
                        'scale-110 ring-2 ring-ring ring-offset-1 ring-offset-card',
                    )}
                    style={{ background: c }}
                  />
                ))}
                <label
                  className="relative grid size-5 cursor-pointer place-items-center overflow-hidden rounded-full border border-border text-[9px] font-bold"
                  title="Custom color"
                >
                  <span className="sr-only">Custom colour</span>
                  <input
                    type="color"
                    value={strokeColor}
                    onChange={(e) => setStrokeColor(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                  <span
                    className="size-full rounded-full"
                    style={{
                      background:
                        'conic-gradient(#c94a38, #d9822b, #236446, #2c6fb3, #7c4dad, #c94a38)',
                    }}
                  />
                </label>
              </div>
            )}

            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="sr-only">Stroke width</span>
              <input
                type="range"
                min={1}
                max={20}
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="w-14 accent-primary"
                aria-label="Stroke width"
              />
            </label>

            <label className="hidden items-center gap-1 text-xs text-muted-foreground xl:flex">
              <span>Op</span>
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round(opacity * 100)}
                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                className="w-12 accent-primary"
                aria-label="Opacity"
              />
            </label>

            <div className="flex items-center rounded-lg bg-muted p-0.5">
              <ToolButton
                label="Undo (Ctrl+Z)"
                onClick={undo}
                disabled={historySizes.undo === 0}
              >
                <Undo2 className="size-4" />
              </ToolButton>
              <ToolButton
                label="Redo (Ctrl+Y)"
                onClick={redo}
                disabled={historySizes.redo === 0}
              >
                <Redo2 className="size-4" />
              </ToolButton>
              <ToolButton
                label="Clear board"
                onClick={() => setClearConfirmOpen(true)}
                disabled={elements.length === 0}
              >
                <Trash2 className="size-4" />
              </ToolButton>
            </div>
          </div>
        )}

        {/* Right utilities: Boards, Allow Annotate, Follow Presenter, Background, Theme, Add Frame/Space, Export, Close */}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {isTeacher && onOpenBoardPicker && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={onOpenBoardPicker}
              title="Switch or start a saved whiteboard"
            >
              <FolderKanban className="size-3.5 shrink-0" />
              <span className="hidden max-w-28 truncate sm:inline">
                {title || 'Boards'}
              </span>
            </Button>
          )}

          {isTeacher && onToggleParticipantsAnnotate && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(allowParticipantsAnnotate)}
                  aria-label="Allow participants to annotate"
                  onClick={() =>
                    onToggleParticipantsAnnotate(!allowParticipantsAnnotate)
                  }
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors motion-reduce:transition-none',
                    allowParticipantsAnnotate
                      ? 'border-primary/40 bg-primary/12 text-primary'
                      : 'border-border bg-muted/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Users className="size-3.5 shrink-0" />
                  <span className="hidden lg:inline">
                    {allowParticipantsAnnotate ? 'Annotate: On' : 'View-only'}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {allowParticipantsAnnotate
                  ? 'Participants can draw & edit — click to set view-only'
                  : 'Participants are view-only — click to allow annotating'}
              </TooltipContent>
            </Tooltip>
          )}

          {!isTeacher && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={followPresenter}
                  aria-label="Follow presenter view"
                  onClick={() => setFollowPresenter((f) => !f)}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors motion-reduce:transition-none',
                    followPresenter
                      ? 'border-primary/40 bg-primary/12 text-primary'
                      : 'border-border bg-muted/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Eye className="size-3.5 shrink-0" />
                  <span className="hidden sm:inline">
                    {followPresenter ? 'Following' : 'Follow presenter'}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {followPresenter
                  ? 'Synced to presenter viewport — pan freely to stop following'
                  : 'Lock your view to follow the presenter'}
              </TooltipContent>
            </Tooltip>
          )}

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label="Board background"
                  >
                    <Grid2X2 className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Background grid</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Background</DropdownMenuLabel>
              {(
                [
                  ['dots', 'Infinite dot grid'],
                  ['grid', 'Square grid'],
                  ['lined', 'Ruled / lined'],
                  ['blank', 'Blank canvas'],
                ] as [BoardPattern, string][]
              ).map(([p, lbl]) => (
                <DropdownMenuItem key={p} onSelect={() => persistPattern(p)}>
                  {lbl}
                  {pattern === p && (
                    <span className="ml-auto text-xs text-primary">●</span>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  persistBoardTheme(boardTheme === 'dark' ? 'light' : 'dark')
                }
              >
                {boardTheme === 'dark' ? (
                  <>
                    <Sun className="size-4" /> Light board surface
                  </>
                ) : (
                  <>
                    <Moon className="size-4" /> Dark board surface
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {isTeacher && (
            <ToolButton label="Add page" onClick={addSection}>
              <FilePlus2 className="size-4" />
            </ToolButton>
          )}

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
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Export</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => exportPng('view')}>
                PNG (Current view)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportPng('full')}>
                PNG (Full board)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={exportSvg}>
                SVG vector
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={exportPdf}>
                PDF document
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={exportJson}>
                Save board JSON
              </DropdownMenuItem>
              {canDraw && (
                <DropdownMenuItem
                  onSelect={() => jsonInputRef.current?.click()}
                >
                  <Upload className="size-4" /> Import board JSON
                </DropdownMenuItem>
              )}
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

      {/* Selection floating action bar */}
      {canDraw && selectedElements.length > 0 && (
        <div className="flex items-center gap-1 border-b border-border bg-muted/60 px-3 py-1 text-xs">
          <span className="mr-1 font-medium text-muted-foreground">
            {selectedElements.length} selected
          </span>
          <Button
            size="xs"
            variant="ghost"
            className="gap-1"
            onClick={duplicateSelected}
          >
            <Copy className="size-3.5" /> Duplicate
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="gap-1"
            onClick={toggleLockSelected}
          >
            {selectedElements.every((e) => e.locked) ? (
              <>
                <LockOpen className="size-3.5" /> Unlock
              </>
            ) : (
              <>
                <Lock className="size-3.5" /> Lock
              </>
            )}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="gap-1"
            onClick={() => reorderSelected('front')}
          >
            <BringToFront className="size-3.5" /> Forward
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="gap-1"
            onClick={() => reorderSelected('back')}
          >
            <SendToBack className="size-3.5" /> Back
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto gap-1 text-destructive hover:text-destructive"
            onClick={deleteSelected}
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
        </div>
      )}

      {/* Infinite Canvas Viewport — full-viewport stage container */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className="absolute inset-0 h-full w-full touch-none select-none overflow-hidden"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          role="img"
          aria-label="Infinite whiteboard canvas"
        >
          <canvas
            ref={canvasRef}
            className="absolute inset-0 block h-full w-full"
          />

        {/* Inline text / sticky editor */}
        {textEdit && editorScreen && (
          <textarea
            autoFocus
            aria-label="Text"
            defaultValue={textEdit.value}
            className="absolute z-20 resize rounded-lg border-2 border-primary p-2 font-medium leading-snug shadow-lg outline-none"
            style={{
              left: editorScreen.sx,
              top: editorScreen.sy,
              width: Math.max(160, textEdit.w * camera.zoom),
              height: Math.max(48, textEdit.h * camera.zoom),
              fontSize:
                (textEdit.kind === 'sticky' ? 16 : Math.max(18, strokeWidth * 5)) *
                camera.zoom,
              background:
                textEdit.kind === 'sticky'
                  ? textEdit.stickyBg || stickyColor
                  : boardTheme === 'dark'
                    ? 'rgba(23,31,27,0.95)'
                    : 'rgba(250,249,245,0.96)',
              color:
                textEdit.kind === 'sticky'
                  ? '#1f2924'
                  : strokeColor,
            }}
            onBlur={(e) => commitTextEdit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setTextEdit(null)
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                commitTextEdit((e.target as HTMLTextAreaElement).value)
              }
            }}
            placeholder={
              textEdit.kind === 'sticky'
                ? 'Write sticky note…'
                : 'Type text (Ctrl+Enter to finish)'
            }
          />
        )}

        {/* Bottom-right Navigation HUD & Interactive Minimap */}
        <div
          className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {showMinimap && (
            <div className="overflow-hidden rounded-lg border border-border bg-card/95 shadow-md backdrop-blur">
              <canvas
                ref={minimapRef}
                width={176}
                height={112}
                className="block h-[112px] w-[176px] cursor-crosshair"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  panFromMinimap(e)
                }}
                onPointerMove={(e) => {
                  if (e.buttons === 1) panFromMinimap(e)
                }}
              />
            </div>
          )}
          <div className="flex items-center gap-0.5 rounded-xl border border-border bg-card/95 p-1 text-card-foreground shadow-md backdrop-blur">
            <ToolButton label="Zoom out" onClick={() => zoomAt(1 / 1.25)}>
              <Minus className="size-3.5" />
            </ToolButton>
            <button
              type="button"
              onClick={resetView}
              className="min-w-12 rounded-md px-1.5 py-1 text-xs font-medium tabular-nums hover:bg-muted"
              title="Reset zoom to 100%"
            >
              {Math.round(camera.zoom * 100)}%
            </button>
            <ToolButton label="Zoom in" onClick={() => zoomAt(1.25)}>
              <Plus className="size-3.5" />
            </ToolButton>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <ToolButton label="Fit to content" onClick={fitToContent}>
              <Maximize2 className="size-3.5" />
            </ToolButton>
            <ToolButton label="Reset view" onClick={resetView}>
              <RotateCcw className="size-3.5" />
            </ToolButton>
            <button
              type="button"
              onClick={() => setShowMinimap((m) => !m)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                showMinimap
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-muted',
              )}
              aria-label="Toggle minimap"
            >
              Map
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Clear Board Confirmation Dialog */}
      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear the entire whiteboard?</DialogTitle>
            <DialogDescription>
              This removes all {elements.length} objects from the board for
              everyone. You can still press Undo if you change your mind.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setClearConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={clearBoardConfirmed}>
              Clear board
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
