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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Diamond,
  Download,
  Eraser,
  Eye,
  FilePlus2,
  FileUp,
  FolderKanban,
  Frame,
  Grid2X2,
  Hand,
  Highlighter,
  ImagePlus,
  LayoutTemplate,
  Magnet,
  Maximize2,
  MessageCircle,
  Minus,
  Moon,
  MousePointer2,
  Navigation,
  Pen,
  PenTool,
  Pencil,
  Plus,
  RectangleHorizontal,
  Redo2,
  RotateCcw,
  Sigma,
  Sparkles,
  Square,
  Star,
  StickyNote,
  Sun,
  Table2,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Upload,
  Users,
  Wand2,
  X,
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
  subscribeWhiteboardPresence,
  updateWhiteboardMeta,
  updateWhiteboardPresence,
  upsertWhiteboardElement,
  upsertWhiteboardElementsBatch,
} from '@/services/firestore-meetings'
import { newPage, type WbOp, type WbPage } from './engine'
import { FramesSidebar } from './frames-sidebar'
import {
  alignElements,
  computeSnapAndGuides,
  createMindMapBranch,
  distributeElements,
  findNearestAnchor,
  getElementAnchorPoints,
  isConnectableShape,
  recognizeSmartShape,
  reorderElementsZ,
  updateAttachedConnectors,
  type AlignmentGuide,
  type AlignmentKind,
  type LayerDirection,
} from './geometry-utils'
import { ImageCropOverlay } from './image-crop-overlay'
import {
  BOARD_COLORS,
  MATH_SYMBOLS,
  STICKY_COLORS,
  createTemplateElements,
  drawBoardElement,
  drawInfiniteBackground,
  exportBoardJson,
  exportBoardSvg,
  getContentBounds,
  getElementBounds,
  getVisibleElements,
  hitTestElement,
  makeElementId,
  parseBoardJson,
  rectsIntersect,
  renderExportCanvas,
  resizeElementToBounds,
  resolveDeckPageImage,
  translateElement,
  type BoardElement,
  type BoardPattern,
  type BoardTheme,
  type Camera,
  type ElementKind,
  type InfiniteTool,
  type LaserTrail,
  type PenPreset,
  type Rect,
  type StrokeStyle,
  type TemplateKind,
} from './infinite-engine'
import { buildPdf } from './pdf'
import {
  PdfImportDialog,
  type PdfImportConfirmPayload,
} from './pdf-import-dialog'
import { parsePdfFile, type ParsedPdfSession } from './pdf-importer'
import { RichTextInlineEditor, type RichTextDraft } from './rich-text-editor'
import {
  CanvasContextMenu,
  SelectionFloatingToolbar,
} from './selection-toolbar'
import { TableInlineEditor } from './table-editor'

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
  onCameraBroadcast?: (
    cx: number,
    cy: number,
    zoom: number,
    force?: boolean,
    panX?: number,
    panY?: number,
  ) => void
  remotePresenterCamera?: {
    cx: number
    cy: number
    zoom: number
    at: number
    force?: boolean
  } | null
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
  {
    tool: 'rounded-rect',
    label: 'Rounded rectangle',
    icon: RectangleHorizontal,
  },
  { tool: 'ellipse', label: 'Circle / Ellipse', icon: Circle },
  { tool: 'triangle', label: 'Triangle', icon: Triangle },
  { tool: 'diamond', label: 'Diamond', icon: Diamond },
  { tool: 'star', label: 'Star', icon: Star },
  { tool: 'speech-bubble', label: 'Speech bubble', icon: MessageCircle },
]

const PEN_PRESETS: {
  id: PenPreset
  label: string
  desc: string
  icon: typeof Pen
}[] = [
  { id: 'smooth', label: 'Smooth Pen', desc: 'Crisp vector ink', icon: Pen },
  {
    id: 'calligraphy',
    label: 'Calligraphy / Fountain',
    desc: 'Velocity-sensitive nib',
    icon: PenTool,
  },
  {
    id: 'marker',
    label: 'Marker / Chisel Tip',
    desc: 'Bold translucent chisel',
    icon: Highlighter,
  },
  {
    id: 'pencil',
    label: 'Pencil / Sketch',
    desc: 'Textured graphite feel',
    icon: Pencil,
  },
  {
    id: 'smart-shape',
    label: 'Smart Shape Pen',
    desc: 'Auto-snaps rough shapes',
    icon: Wand2,
  },
]

const THICKNESS_DOTS = [2, 4, 8, 14]
const MIN_ZOOM = 0.1
const MAX_ZOOM = 5.0

function clampZoom(z: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

function getHandlePositions(
  b: Rect,
): Record<HandleId, { x: number; y: number }> {
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
  const maxDim = 960
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
  return { dataUrl, width: Math.min(460, w), height: Math.min(460, h) }
}

/**
 * Complete infinite whiteboard with real-time Firestore sync, Zoom-level
 * drawing presets, PDF deck/canvas import, floating object controls,
 * rich inline text, lesson frames, editable tables, smart connectors,
 * snap alignment guides, and presenter camera sync.
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
  const replaceImgInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef({ width: 0, height: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 1000, height: 640 })

  const [elements, setElements] = useState<BoardElement[]>([])
  const elementsRef = useRef<BoardElement[]>(elements)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedIdsRef = useRef<string[]>(selectedIds)
  const [clipboard, setClipboard] = useState<BoardElement[]>([])

  const [tool, setTool] = useState<InfiniteTool>('pen')
  const [penPreset, setPenPreset] = useState<PenPreset>('smooth')
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
  const [snapToGrid, setSnapToGrid] = useState(false)
  const [framesOpen, setFramesOpen] = useState(false)

  // Table insertion picker state
  const [tableRowsPick, setTableRowsPick] = useState(3)
  const [tableColsPick, setTableColsPick] = useState(3)
  const [editingTableId, setEditingTableId] = useState<string | null>(null)

  // Image crop / replace state
  const [croppingId, setCroppingId] = useState<string | null>(null)
  const replaceTargetIdRef = useRef<string | null>(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
  } | null>(null)

  // PDF import dialog state
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false)
  const [pdfLoadingFile, setPdfLoadingFile] = useState(false)
  const [pdfSession, setPdfSession] = useState<ParsedPdfSession | null>(null)
  const [pdfImporting, setPdfImporting] = useState(false)
  const [pdfProgress, setPdfProgress] = useState<{
    done: number
    total: number
  } | null>(null)

  const [camera, setCamera] = useState<Camera>({ panX: 0, panY: 0, zoom: 1 })
  const cameraRef = useRef<Camera>(camera)
  const [followPresenter, setFollowPresenter] = useState(false)
  const [fsLasers, setFsLasers] = useState<LaserTrail[]>([])
  const [fsPresenterCam, setFsPresenterCam] = useState<{
    cx: number
    cy: number
    zoom: number
    at: number
    force?: boolean
  } | null>(null)
  const lastForcedCamAtRef = useRef<number>(0)

  const [spacePressed, setSpacePressed] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [showMinimap, setShowMinimap] = useState(true)
  const [sectionCount, setSectionCount] = useState(1)
  const [renderTick, setRenderTick] = useState(0)

  const lastStreamSyncRef = useRef(0)
  const lastCamBroadcastRef = useRef(0)
  const lastFsLaserEmitRef = useRef(0)
  const lastFsLaserAtRef = useRef(0)
  const lastPresenceAtByUidRef = useRef<Map<string, number>>(new Map())
  const lastTextSyncRef = useRef(0)
  const liveTextMetaRef = useRef<{
    id: string
    isNew: boolean
    zIndex: number
    createdAt: number
    deckId?: string
    deckPage?: number
  } | null>(null)
  const activeEditingIdsRef = useRef<Set<string>>(new Set())

  // Alignment guides & connector anchor hover indicators drawn on canvas
  const guidesRef = useRef<AlignmentGuide[]>([])
  const hoveredAnchorRef = useRef<{ x: number; y: number } | null>(null)

  // Undo / Redo snapshot history
  const undoStackRef = useRef<BoardElement[][]>([])
  const redoStackRef = useRef<BoardElement[][]>([])
  const [historySizes, setHistorySizes] = useState({ undo: 0, redo: 0 })

  // Rich inline text / sticky editor
  const [textEdit, setTextEdit] = useState<RichTextDraft | null>(null)

  // Local laser trail points
  const localLaserRef = useRef<{ x: number; y: number; at: number }[]>([])
  const lastLaserEmitRef = useRef(0)

  // Active pointer interaction
  const draftRef = useRef<BoardElement | null>(null)
  const lastDrawSampleRef = useRef<{ x: number; y: number; t: number } | null>(
    null,
  )
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
  const pinchStartRef = useRef<{
    dist: number
    zoom: number
    cx: number
    cy: number
    panX: number
    panY: number
  } | null>(null)

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
    const triggerInstantRepaint = () => {
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => setRenderTick((t) => t + 1))
      }
    }
    const unsubEls = subscribeWhiteboardElements<BoardElement>(
      syncScope,
      (remote) => {
        const activeIds = activeEditingIdsRef.current
        const draftId = draftRef.current?.id
        if (activeIds.size === 0 && !draftId) {
          elementsRef.current = remote
          setElements(remote)
          triggerInstantRepaint()
          return
        }
        const localById = new Map(elementsRef.current.map((e) => [e.id, e]))
        const merged = remote
          .filter((e) => e.id !== draftId)
          .map((e) => (activeIds.has(e.id) ? (localById.get(e.id) ?? e) : e))
        elementsRef.current = merged
        setElements(merged)
        triggerInstantRepaint()
      },
    )
    const unsubMeta =
      syncScope.kind === 'board'
        ? subscribeWhiteboardMeta(syncScope.boardId, (meta) => {
            if (meta.backgroundType) setPattern(meta.backgroundType)
            if (meta.boardTheme) setBoardTheme(meta.boardTheme)
            if (meta.presenterCamera && meta.presenterCamera.by !== author) {
              setFsPresenterCam({
                cx: meta.presenterCamera.cx,
                cy: meta.presenterCamera.cy,
                zoom: meta.presenterCamera.zoom,
                at: meta.presenterCamera.at,
                force: meta.presenterCamera.force,
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
            triggerInstantRepaint()
          })
        : () => {}
    const unsubPresence =
      syncScope.kind === 'board'
        ? subscribeWhiteboardPresence(syncScope.boardId, (docs) => {
            const nowTs = Date.now()
            let changed = false
            setFsLasers((prev) => {
              let next = prev
              for (const p of docs) {
                if (p.uid === author) continue
                const prevAt = lastPresenceAtByUidRef.current.get(p.uid) ?? 0
                if (
                  !p.active ||
                  p.laserX === null ||
                  p.laserY === null ||
                  nowTs - p.at > 2500
                ) {
                  continue
                }
                if (p.at <= prevAt) continue
                lastPresenceAtByUidRef.current.set(p.uid, p.at)
                changed = true
                const others = next.filter((x) => x.id !== p.uid)
                const cur = next.find((x) => x.id === p.uid)
                const pts = [
                  ...(cur?.points.filter((pt) => nowTs - pt.at < 1500) ?? []),
                  { x: p.laserX, y: p.laserY, at: nowTs },
                ]
                next = [...others, { id: p.uid, name: p.name, points: pts }]
              }
              return changed ? next : prev
            })
            if (changed) triggerInstantRepaint()
          })
        : () => {}
    return () => {
      unsubEls()
      unsubMeta()
      unsubPresence()
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
      if (syncScope && ids.length > 0)
        void deleteWhiteboardElements(syncScope, ids)
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
    onCameraBroadcast?.(cx, cy, camera.zoom, false, camera.panX, camera.panY)
    if (syncScope?.kind === 'board') {
      void updateWhiteboardMeta(syncScope.boardId, {
        presenterCamera: {
          cx,
          cy,
          zoom: camera.zoom,
          by: author,
          at: now,
          force: false,
        },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, isTeacher, author, syncKey, onCameraBroadcast])

  const bringEveryoneToMe = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const cam = cameraRef.current
    const cx = (rect.width / 2 - cam.panX) / cam.zoom
    const cy = (rect.height / 2 - cam.panY) / cam.zoom
    const now = Date.now()
    onCameraBroadcast?.(cx, cy, cam.zoom, true, cam.panX, cam.panY)
    if (syncScope?.kind === 'board') {
      void updateWhiteboardMeta(syncScope.boardId, {
        presenterCamera: {
          cx,
          cy,
          zoom: cam.zoom,
          by: author,
          at: now,
          force: true,
        },
      })
    }
    toast.success('Brought everyone to your current view')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [author, onCameraBroadcast, syncKey])

  // Apply Follow Presenter viewport OR forced "Bring Everyone to Me" camera jump
  const latestPresenterCam = useMemo(() => {
    if (remotePresenterCamera && fsPresenterCam) {
      return remotePresenterCamera.at >= fsPresenterCam.at
        ? remotePresenterCamera
        : fsPresenterCam
    }
    return remotePresenterCamera ?? fsPresenterCam
  }, [remotePresenterCamera, fsPresenterCam])

  useEffect(() => {
    if (isTeacher || !latestPresenterCam) return
    const isForcedJump =
      Boolean(latestPresenterCam.force) &&
      latestPresenterCam.at > lastForcedCamAtRef.current
    if (!followPresenter && !isForcedJump) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    if (isForcedJump) {
      lastForcedCamAtRef.current = latestPresenterCam.at
      toast.info('Presenter brought your view to this section')
    }
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

  // ---- Coordinate conversions ----------------------------------------------
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

  const getViewportCenterWorld = useCallback(() => {
    const rect =
      canvasRef.current?.getBoundingClientRect() ??
      containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
    return {
      x: (rect.width / 2 - cameraRef.current.panX) / cameraRef.current.zoom,
      y: (rect.height / 2 - cameraRef.current.panY) / cameraRef.current.zoom,
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

  const jumpToRect = useCallback((bounds: Rect, pad = 72) => {
    const rect =
      canvasRef.current?.getBoundingClientRect() ??
      containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const { width, height } = rect
    const zoom = clampZoom(
      Math.min(
        (width - pad * 2) / Math.max(40, bounds.w),
        (height - pad * 2) / Math.max(40, bounds.h),
        1.5,
      ),
    )
    setCamera({
      zoom,
      panX: width / 2 - (bounds.x + bounds.w / 2) * zoom,
      panY: height / 2 - (bounds.y + bounds.h / 2) * zoom,
    })
  }, [])

  const fitToContent = useCallback(() => {
    const bounds = getContentBounds(elementsRef.current)
    if (!bounds) {
      resetView()
      return
    }
    jumpToRect(bounds, 72)
  }, [jumpToRect, resetView])

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

  // Detect if a point falls inside an Interactive PDF Deck (for per-page annotations)
  const findEnclosingPdfDeck = useCallback((wx: number, wy: number) => {
    const decks = elementsRef.current.filter((e) => e.kind === 'pdf-deck')
    for (const d of decks) {
      const b = getElementBounds(d)
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) {
        return d
      }
    }
    return null
  }, [])

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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawInfiniteBackground(ctx, cssW, cssH, cam, pattern, boardTheme)

    ctx.translate(cam.panX, cam.panY)
    ctx.scale(cam.zoom, cam.zoom)

    const visible = getVisibleElements(elementsRef.current)
    const sorted = [...visible].sort((a, b) => a.zIndex - b.zIndex)
    for (const el of sorted) {
      const deckImg =
        el.kind === 'pdf-deck'
          ? resolveDeckPageImage(elementsRef.current, el)
          : undefined
      drawBoardElement(ctx, el, () => setRenderTick((t) => t + 1), deckImg)
    }
    if (draftRef.current) {
      drawBoardElement(ctx, draftRef.current)
    }

    // Smart alignment guides while moving objects
    if (guidesRef.current.length > 0) {
      const invZ = 1 / cam.zoom
      ctx.save()
      ctx.strokeStyle = '#c94a38'
      ctx.lineWidth = 1.2 * invZ
      ctx.setLineDash([4 * invZ, 3 * invZ])
      for (const g of guidesRef.current) {
        ctx.beginPath()
        if (g.axis === 'x') {
          ctx.moveTo(g.pos, g.from)
          ctx.lineTo(g.pos, g.to)
        } else {
          ctx.moveTo(g.from, g.pos)
          ctx.lineTo(g.to, g.pos)
        }
        ctx.stroke()
      }
      ctx.restore()
    }

    // Smart connector anchor dots when using line or arrow tool
    if ((tool === 'line' || tool === 'arrow') && canDraw) {
      const invZ = 1 / cam.zoom
      ctx.save()
      for (const el of sorted) {
        if (!isConnectableShape(el)) continue
        const anchors = getElementAnchorPoints(el)
        for (const pt of Object.values(anchors)) {
          ctx.fillStyle = 'rgba(35,100,70,0.28)'
          ctx.strokeStyle = '#236446'
          ctx.lineWidth = 1.2 * invZ
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, 4 * invZ, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
      }
      if (hoveredAnchorRef.current) {
        ctx.fillStyle = '#236446'
        ctx.beginPath()
        ctx.arc(
          hoveredAnchorRef.current.x,
          hoveredAnchorRef.current.y,
          6.5 * invZ,
          0,
          Math.PI * 2,
        )
        ctx.fill()
      }
      ctx.restore()
    }

    // Selection outlines & resize/rotate handles
    const selSet = new Set(selectedIdsRef.current)
    const selectedEls = sorted.filter((e) => selSet.has(e.id))
    if (selectedEls.length > 0 && canDraw && !croppingId) {
      const invZ = 1 / cam.zoom
      ctx.save()
      ctx.strokeStyle = '#236446'
      ctx.lineWidth = 1.5 * invZ
      ctx.setLineDash([5 * invZ, 4 * invZ])
      for (const el of selectedEls) {
        const b = getElementBounds(el)
        ctx.strokeRect(
          b.x - 4 * invZ,
          b.y - 4 * invZ,
          b.w + 8 * invZ,
          b.h + 8 * invZ,
        )
      }
      ctx.setLineDash([])
      if (selectedEls.length === 1 && !selectedEls[0].locked) {
        const b = getElementBounds(selectedEls[0])
        const handles = getHandlePositions(b)
        const r = 5 * invZ
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
    const allLasers: {
      points: { x: number; y: number; at: number }[]
      name?: string
    }[] = [{ points: localLaserRef.current }, ...mergedRemoteLasers]
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

    // Paint Minimap
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
  }, [pattern, boardTheme, canDraw, mergedRemoteLasers, showMinimap, tool, croppingId])

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
        setViewportSize({ width: rect.width, height: rect.height })
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

  // Animate laser fade at 60fps
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

  // ---- Selection & Object Manipulation Actions -----------------------------
  const visibleElements = useMemo(
    () => getVisibleElements(elements),
    [elements],
  )
  const selectedElements = useMemo(
    () => visibleElements.filter((e) => selectedIds.includes(e.id)),
    [visibleElements, selectedIds],
  )
  const frameElements = useMemo(
    () =>
      elements
        .filter((e) => e.kind === 'frame')
        .sort((a, b) => a.createdAt - b.createdAt),
    [elements],
  )
  const pdfDecks = useMemo(
    () => elements.filter((e) => e.kind === 'pdf-deck'),
    [elements],
  )

  const deleteSelected = useCallback(() => {
    if (!canDraw || selectedIdsRef.current.length === 0) return
    const sel = new Set(selectedIdsRef.current)
    const deletable = elementsRef.current.filter(
      (e) => sel.has(e.id) && !e.locked,
    )
    if (deletable.length === 0) return
    const delIds = new Set(deletable.map((e) => e.id))
    // If deleting a pdf-deck, also clean up its child pdf-page docs
    for (const d of deletable) {
      if (d.kind === 'pdf-deck') {
        for (const child of elementsRef.current) {
          if (child.pdfDeckId === d.id) delIds.add(child.id)
        }
      }
    }
    const prev = elementsRef.current
    const next = prev.filter((e) => !delIds.has(e.id))
    pushHistory(prev)
    elementsRef.current = next
    setElements(next)
    setSelectedIds([])
    syncDelete(Array.from(delIds))
  }, [canDraw, pushHistory, syncDelete])

  const copySelected = useCallback(() => {
    if (selectedIdsRef.current.length === 0) return
    const sel = new Set(selectedIdsRef.current)
    const picked = elementsRef.current.filter(
      (e) => sel.has(e.id) && e.kind !== 'pdf-deck',
    )
    if (picked.length === 0) return
    setClipboard(picked)
    toast.success(`Copied ${picked.length} ${picked.length === 1 ? 'item' : 'items'}`)
  }, [])

  const pasteClipboard = useCallback(() => {
    if (!canDraw || clipboard.length === 0) return
    const prev = elementsRef.current
    const maxZ = prev.reduce((m, e) => Math.max(m, e.zIndex), 0)
    let z = maxZ + 1
    const copies = clipboard.map((el) => ({
      ...translateElement(el, 32, 32),
      id: makeElementId(),
      locked: false,
      groupId: undefined,
      zIndex: z++,
      createdAt: Date.now(),
    }))
    const next = [...prev, ...copies]
    pushHistory(prev)
    elementsRef.current = next
    setElements(next)
    setSelectedIds(copies.map((c) => c.id))
    setTool('select')
    syncBatch(copies)
  }, [canDraw, clipboard, pushHistory, syncBatch])

  const duplicateSelected = useCallback(() => {
    if (!canDraw || selectedIdsRef.current.length === 0) return
    const sel = new Set(selectedIdsRef.current)
    const prev = elementsRef.current
    const maxZ = prev.reduce((m, e) => Math.max(m, e.zIndex), 0)
    const copies: BoardElement[] = []
    let z = maxZ + 1
    for (const el of prev) {
      if (!sel.has(el.id) || el.kind === 'pdf-deck') continue
      copies.push({
        ...translateElement(el, 28, 28),
        id: makeElementId(),
        locked: false,
        groupId: undefined,
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
    (dir: LayerDirection) => {
      if (!canDraw || selectedIdsRef.current.length === 0) return
      const prev = elementsRef.current
      const { next, changed } = reorderElementsZ(
        prev,
        selectedIdsRef.current,
        dir,
      )
      if (changed.length === 0) return
      pushHistory(prev)
      elementsRef.current = next
      setElements(next)
      syncBatch(changed)
    },
    [canDraw, pushHistory, syncBatch],
  )

  const rotateSelected90 = useCallback(() => {
    if (!canDraw || selectedIdsRef.current.length === 0) return
    const sel = new Set(selectedIdsRef.current)
    const prev = elementsRef.current
    const changed: BoardElement[] = []
    const next = prev.map((el) => {
      if (!sel.has(el.id) || el.locked) return el
      const updated = {
        ...el,
        rotation: ((el.rotation || 0) + Math.PI / 2) % (Math.PI * 2),
      }
      changed.push(updated)
      return updated
    })
    if (changed.length === 0) return
    pushHistory(prev)
    elementsRef.current = next
    setElements(next)
    syncBatch(changed)
  }, [canDraw, pushHistory, syncBatch])

  const flipSelected = useCallback(
    (axis: 'x' | 'y') => {
      if (!canDraw || selectedIdsRef.current.length === 0) return
      const sel = new Set(selectedIdsRef.current)
      const prev = elementsRef.current
      const changed: BoardElement[] = []
      const next = prev.map((el) => {
        if (!sel.has(el.id) || el.locked) return el
        const updated =
          axis === 'x'
            ? { ...el, flipX: !el.flipX }
            : { ...el, flipY: !el.flipY }
        changed.push(updated)
        return updated
      })
      if (changed.length === 0) return
      pushHistory(prev)
      elementsRef.current = next
      setElements(next)
      syncBatch(changed)
    },
    [canDraw, pushHistory, syncBatch],
  )

  const setSelectedOpacity = useCallback(
    (nextOp: number) => {
      if (!canDraw || selectedIdsRef.current.length === 0) return
      const clamped = Math.max(0.1, Math.min(1, nextOp))
      const sel = new Set(selectedIdsRef.current)
      const prev = elementsRef.current
      const changed: BoardElement[] = []
      const next = prev.map((el) => {
        if (!sel.has(el.id)) return el
        const updated = { ...el, opacity: clamped }
        changed.push(updated)
        return updated
      })
      if (changed.length === 0) return
      elementsRef.current = next
      setElements(next)
      syncBatch(changed)
    },
    [canDraw, syncBatch],
  )

  const toggleGroupSelected = useCallback(() => {
    if (!canDraw || selectedIdsRef.current.length < 2) return
    const sel = new Set(selectedIdsRef.current)
    const prev = elementsRef.current
    const picked = prev.filter((e) => sel.has(e.id))
    const sharedGroup =
      picked[0]?.groupId &&
      picked.every((e) => e.groupId === picked[0].groupId)
    const nextGroupId = sharedGroup ? undefined : `grp_${makeElementId()}`
    const changed: BoardElement[] = []
    const next = prev.map((e) => {
      if (!sel.has(e.id)) return e
      const updated = { ...e, groupId: nextGroupId }
      changed.push(updated)
      return updated
    })
    pushHistory(prev)
    elementsRef.current = next
    setElements(next)
    syncBatch(changed)
    toast.success(sharedGroup ? 'Ungrouped objects' : 'Grouped objects')
  }, [canDraw, pushHistory, syncBatch])

  const handleAlignSelected = useCallback(
    (alignment: AlignmentKind) => {
      if (!canDraw || selectedIdsRef.current.length < 2) return
      const prev = elementsRef.current
      const { next, changed } = alignElements(
        prev,
        selectedIdsRef.current,
        alignment,
      )
      if (changed.length === 0) return
      const { next: withConn, updatedConnectors } = updateAttachedConnectors(
        next,
        new Set(changed.map((c) => c.id)),
      )
      pushHistory(prev)
      elementsRef.current = withConn
      setElements(withConn)
      syncBatch([...changed, ...updatedConnectors])
    },
    [canDraw, pushHistory, syncBatch],
  )

  const handleDistributeSelected = useCallback(
    (axis: 'horizontal' | 'vertical') => {
      if (!canDraw || selectedIdsRef.current.length < 3) return
      const prev = elementsRef.current
      const { next, changed } = distributeElements(
        prev,
        selectedIdsRef.current,
        axis,
      )
      if (changed.length === 0) return
      const { next: withConn, updatedConnectors } = updateAttachedConnectors(
        next,
        new Set(changed.map((c) => c.id)),
      )
      pushHistory(prev)
      elementsRef.current = withConn
      setElements(withConn)
      syncBatch([...changed, ...updatedConnectors])
    },
    [canDraw, pushHistory, syncBatch],
  )

  const handleStyleImage = useCallback(
    (
      el: BoardElement,
      patch: {
        borderRadius?: number
        borderWidth?: number
        borderColor?: string
      },
    ) => {
      const updated = { ...el, ...patch }
      const next = elementsRef.current.map((item) =>
        item.id === el.id ? updated : item,
      )
      elementsRef.current = next
      setElements(next)
      syncUpsert(updated)
    },
    [syncUpsert],
  )

  const handleDownloadImage = useCallback((el: BoardElement) => {
    if (!el.imageDataUrl) return
    const a = document.createElement('a')
    a.href = el.imageDataUrl
    a.download = `lectern-image-${el.id.slice(-4)}.png`
    a.click()
  }, [])

  const handleReplaceImageFile = useCallback(
    async (file: File) => {
      const targetId = replaceTargetIdRef.current
      replaceTargetIdRef.current = null
      if (!targetId || !canDraw) return
      try {
        const { dataUrl } = await compressImageFile(file)
        const prev = elementsRef.current
        const target = prev.find((e) => e.id === targetId)
        if (!target) return
        const updated: BoardElement = { ...target, imageDataUrl: dataUrl }
        const next = prev.map((e) => (e.id === targetId ? updated : e))
        pushHistory(prev)
        elementsRef.current = next
        setElements(next)
        syncUpsert(updated)
        toast.success('Image replaced')
      } catch {
        toast.error('Could not replace image.')
      }
    },
    [canDraw, pushHistory, syncUpsert],
  )

  const handleAddMindMapBranch = useCallback(
    (parent: BoardElement) => {
      if (!canDraw) return
      const prev = elementsRef.current
      const { node, connector } = createMindMapBranch(parent, prev, author)
      const next = [...prev, connector, node]
      pushHistory(prev)
      elementsRef.current = next
      setElements(next)
      setSelectedIds([node.id])
      syncBatch([connector, node])
    },
    [author, canDraw, pushHistory, syncBatch],
  )

  // ---- Frames / Lesson Slides Actions --------------------------------------
  const addPresetFrame = useCallback(
    (ratio: '16:9' | 'A4') => {
      if (!canDraw) return
      const prev = elementsRef.current
      const existingFrames = prev.filter((e) => e.kind === 'frame')
      const w = ratio === '16:9' ? 960 : 720
      const h = ratio === '16:9' ? 540 : 1018
      let fx: number
      let fy: number
      if (existingFrames.length > 0) {
        const last = existingFrames[existingFrames.length - 1]
        const lb = getElementBounds(last)
        fx = lb.x + lb.w + 80
        fy = lb.y
      } else {
        const center = getViewportCenterWorld()
        fx = center.x - w / 2
        fy = center.y - h / 2
      }
      const minZ = prev.reduce((m, e) => Math.min(m, e.zIndex), 1)
      const frame: BoardElement = {
        id: makeElementId(),
        kind: 'frame',
        x: fx,
        y: fy,
        w,
        h,
        rotation: 0,
        strokeColor: '#236446',
        fillColor:
          boardTheme === 'dark'
            ? 'rgba(30,40,35,0.45)'
            : 'rgba(255,255,255,0.65)',
        strokeWidth: 2,
        strokeStyle: 'dashed',
        opacity: 1,
        frameTitle: `Slide ${existingFrames.length + 1}`,
        frameRatio: ratio,
        zIndex: minZ - 1,
        author,
        createdAt: Date.now(),
      }
      const next = [...prev, frame]
      pushHistory(prev)
      elementsRef.current = next
      setElements(next)
      setSelectedIds([frame.id])
      syncUpsert(frame)
      jumpToRect(getElementBounds(frame), 96)
    },
    [author, boardTheme, canDraw, getViewportCenterWorld, jumpToRect, pushHistory, syncUpsert],
  )

  const renameFrame = useCallback(
    (id: string, nextTitle: string) => {
      const prev = elementsRef.current
      const target = prev.find((e) => e.id === id)
      if (!target) return
      const updated = { ...target, frameTitle: nextTitle }
      const next = prev.map((e) => (e.id === id ? updated : e))
      elementsRef.current = next
      setElements(next)
      syncUpsert(updated)
    },
    [syncUpsert],
  )

  const deleteFrame = useCallback(
    (id: string) => {
      const prev = elementsRef.current
      const next = prev.filter((e) => e.id !== id)
      pushHistory(prev)
      elementsRef.current = next
      setElements(next)
      setSelectedIds((s) => s.filter((x) => x !== id))
      syncDelete([id])
    },
    [pushHistory, syncDelete],
  )

  // ---- Editable Table Insertion & Update -----------------------------------
  const insertTable = useCallback(
    (rows: number, cols: number) => {
      if (!canDraw) return
      const center = getViewportCenterWorld()
      const w = Math.max(240, cols * 120)
      const h = Math.max(120, rows * 44)
      const prev = elementsRef.current
      const maxZ = prev.reduce((m, e) => Math.max(m, e.zIndex), 0)
      const cells = Array.from({ length: rows * cols }, (_, idx) =>
        idx < cols ? `Header ${idx + 1}` : '',
      )
      const tableEl: BoardElement = {
        id: makeElementId(),
        kind: 'table',
        x: center.x - w / 2,
        y: center.y - h / 2,
        w,
        h,
        rotation: 0,
        strokeColor: '#236446',
        fillColor: '#ffffff',
        strokeWidth: 1.5,
        strokeStyle: 'solid',
        opacity: 1,
        tableRows: rows,
        tableCols: cols,
        tableCells: cells,
        tableHeaderBg: true,
        fontSize: 14,
        zIndex: maxZ + 1,
        author,
        createdAt: Date.now(),
      }
      const next = [...prev, tableEl]
      pushHistory(prev)
      elementsRef.current = next
      setElements(next)
      setSelectedIds([tableEl.id])
      setEditingTableId(tableEl.id)
      setTool('select')
      syncUpsert(tableEl)
    },
    [author, canDraw, getViewportCenterWorld, pushHistory, syncUpsert],
  )

  const updateTableElement = useCallback(
    (updated: BoardElement) => {
      const next = elementsRef.current.map((e) =>
        e.id === updated.id ? updated : e,
      )
      elementsRef.current = next
      setElements(next)
      syncUpsert(updated)
    },
    [syncUpsert],
  )

  // ---- Math Symbol Quick Insert --------------------------------------------
  const insertMathSymbol = useCallback(
    (sym: string) => {
      if (!canDraw) return
      if (textEdit) {
        setTextEdit((prev) => (prev ? { ...prev, value: prev.value + sym } : prev))
        return
      }
      const center = getViewportCenterWorld()
      const prev = elementsRef.current
      const maxZ = prev.reduce((m, e) => Math.max(m, e.zIndex), 0)
      const el: BoardElement = {
        id: makeElementId(),
        kind: 'text',
        x: center.x - 40,
        y: center.y - 24,
        w: 120,
        h: 48,
        rotation: 0,
        strokeColor,
        fillColor: 'transparent',
        strokeWidth: 2,
        strokeStyle: 'solid',
        opacity: 1,
        text: sym,
        fontSize: 32,
        fontFamily: 'serif',
        zIndex: maxZ + 1,
        author,
        createdAt: Date.now(),
      }
      const next = [...prev, el]
      pushHistory(prev)
      elementsRef.current = next
      setElements(next)
      setSelectedIds([el.id])
      setTool('select')
      syncUpsert(el)
    },
    [author, canDraw, getViewportCenterWorld, pushHistory, strokeColor, syncUpsert, textEdit],
  )

  // ---- Templates & Image Upload --------------------------------------------
  const insertTemplate = useCallback(
    (kind: TemplateKind) => {
      if (!canDraw) return
      const center = getViewportCenterWorld()
      const prev = elementsRef.current
      const maxZ = prev.reduce((m, e) => Math.max(m, e.zIndex), 0)
      const items = createTemplateElements(
        kind,
        center.x,
        center.y,
        author,
        maxZ + 1,
      )
      const next = [...prev, ...items]
      pushHistory(prev)
      elementsRef.current = next
      setElements(next)
      setSelectedIds(items.map((i) => i.id))
      setTool('select')
      syncBatch(items)
      toast.success('Template added to board')
    },
    [author, canDraw, getViewportCenterWorld, pushHistory, syncBatch],
  )

  const addImageAt = useCallback(
    async (file: File, wx?: number, wy?: number) => {
      if (!canDraw) return
      try {
        const { dataUrl, width, height } = await compressImageFile(file)
        const center = getViewportCenterWorld()
        const cx = wx ?? center.x
        const cy = wy ?? center.y
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
    [author, canDraw, getViewportCenterWorld, pushHistory, syncUpsert],
  )

  // ---- PDF File Import & Interactive PDF Deck Page Flipping ----------------
  const openPdfFileForImport = useCallback(
    async (file: File) => {
      if (!canDraw) return
      setPdfDialogOpen(true)
      setPdfLoadingFile(true)
      setPdfSession(null)
      try {
        const session = await parsePdfFile(file)
        setPdfSession(session)
      } catch (err) {
        console.error(err)
        toast.error('Could not read that PDF file. Please try another PDF.')
        setPdfDialogOpen(false)
      } finally {
        setPdfLoadingFile(false)
      }
    },
    [canDraw],
  )

  const closePdfDialog = useCallback(() => {
    pdfSession?.destroy()
    setPdfSession(null)
    setPdfDialogOpen(false)
    setPdfProgress(null)
  }, [pdfSession])

  const confirmPdfImport = useCallback(
    async ({
      session,
      pageIndices,
      layout,
      autoLock,
    }: PdfImportConfirmPayload) => {
      if (!canDraw || pageIndices.length === 0) return
      setPdfImporting(true)
      setPdfProgress({ done: 0, total: pageIndices.length })
      try {
        const rendered = await session.renderPages(pageIndices, (done, total) =>
          setPdfProgress({ done, total }),
        )
        if (rendered.length === 0) return

        const center = getViewportCenterWorld()
        const prev = elementsRef.current
        const minZ = prev.reduce((m, e) => Math.min(m, e.zIndex), 1)
        const now = Date.now()
        const newEls: BoardElement[] = []

        if (layout === 'deck') {
          const first = rendered[0]
          const deckId = makeElementId()
          const deckX = center.x - first.width / 2
          const deckY = center.y - first.height / 2
          const deckFrame: BoardElement = {
            id: deckId,
            kind: 'pdf-deck',
            x: deckX,
            y: deckY,
            w: first.width,
            h: first.height,
            rotation: 0,
            strokeColor: '#236446',
            fillColor: '#ffffff',
            strokeWidth: 2,
            strokeStyle: 'solid',
            opacity: 1,
            pdfDeckId: deckId,
            pdfPageIndex: 0,
            pdfPageCount: rendered.length,
            pdfTitle: session.title,
            locked: autoLock,
            zIndex: minZ - 1,
            author,
            createdAt: now,
          }
          newEls.push(deckFrame)
          rendered.forEach((pg, idx) => {
            newEls.push({
              id: makeElementId(),
              kind: 'pdf-page',
              x: deckX,
              y: deckY,
              w: pg.width,
              h: pg.height,
              rotation: 0,
              strokeColor: '#236446',
              fillColor: '#ffffff',
              strokeWidth: 1,
              strokeStyle: 'solid',
              opacity: 1,
              imageDataUrl: pg.dataUrl,
              pdfDeckId: deckId,
              pdfPageIndex: idx,
              pdfTitle: session.title,
              locked: true,
              zIndex: minZ - 2,
              author,
              createdAt: now + idx + 1,
            })
          })
        } else {
          // Spread all pages on canvas (Row, Column, or Grid)
          const gap = 36
          const cols =
            layout === 'grid'
              ? Math.max(2, Math.ceil(Math.sqrt(rendered.length)))
              : layout === 'row'
                ? rendered.length
                : 1
          const cellW = Math.max(...rendered.map((r) => r.width))
          const cellH = Math.max(...rendered.map((r) => r.height))
          const totalGridW = cols * cellW + (cols - 1) * gap
          const rowsCount = Math.ceil(rendered.length / cols)
          const totalGridH = rowsCount * cellH + (rowsCount - 1) * gap
          const startX = center.x - totalGridW / 2
          const startY = center.y - totalGridH / 2

          rendered.forEach((pg, idx) => {
            const col = idx % cols
            const row = Math.floor(idx / cols)
            newEls.push({
              id: makeElementId(),
              kind: 'pdf-page',
              x: startX + col * (cellW + gap),
              y: startY + row * (cellH + gap),
              w: pg.width,
              h: pg.height,
              rotation: 0,
              strokeColor: '#236446',
              fillColor: '#ffffff',
              strokeWidth: 1,
              strokeStyle: 'solid',
              opacity: 1,
              imageDataUrl: pg.dataUrl,
              pdfPageIndex: pg.pageIndex,
              pdfTitle: session.title,
              locked: autoLock,
              zIndex: minZ - rendered.length + idx,
              author,
              createdAt: now + idx,
            })
          })
        }

        const next = [...prev, ...newEls]
        pushHistory(prev)
        elementsRef.current = next
        setElements(next)
        setSelectedIds([])
        // Batch upsert in small chunks so large PDFs sync smoothly without exceeding batch byte size
        for (let i = 0; i < newEls.length; i += 4) {
          syncBatch(newEls.slice(i, i + 4))
        }
        if (syncScope?.kind === 'board') {
          void updateWhiteboardMeta(syncScope.boardId, {
            elementCount: next.length,
            updatedAt: Date.now(),
          })
        }
        const fitTarget =
          layout === 'deck'
            ? getElementBounds(newEls[0])
            : getContentBounds(newEls)
        if (fitTarget) jumpToRect(fitTarget, 90)
        toast.success(
          layout === 'deck'
            ? `Imported "${session.title}" as Interactive PDF Deck (${rendered.length} pages)`
            : `Placed ${rendered.length} PDF ${rendered.length === 1 ? 'page' : 'pages'} on canvas`,
        )
        closePdfDialog()
      } catch {
        toast.error('Failed to import PDF pages.')
      } finally {
        setPdfImporting(false)
        setPdfProgress(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [author, canDraw, closePdfDialog, getViewportCenterWorld, jumpToRect, pushHistory, syncBatch, syncKey],
  )

  const flipPdfDeckPage = useCallback(
    (deck: BoardElement, delta: number) => {
      const total = Math.max(1, deck.pdfPageCount ?? 1)
      const nextIdx = Math.max(0, Math.min(total - 1, (deck.pdfPageIndex ?? 0) + delta))
      if (nextIdx === (deck.pdfPageIndex ?? 0)) return
      const updated: BoardElement = { ...deck, pdfPageIndex: nextIdx }
      const next = elementsRef.current.map((e) =>
        e.id === deck.id ? updated : e,
      )
      elementsRef.current = next
      setElements(next)
      syncUpsert(updated)
    },
    [syncUpsert],
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

  // ---- Rich Inline Text Live Stream & Commit -------------------------------
  const buildElementFromTextDraft = useCallback(
    (
      draft: RichTextDraft,
      existing?: BoardElement,
    ): BoardElement => {
      const trimmed = draft.value.trimEnd()
      const textDecoration: BoardElement['textDecoration'] =
        draft.underline && draft.strikethrough
          ? 'underline line-through'
          : draft.underline
            ? 'underline'
            : draft.strikethrough
              ? 'line-through'
              : 'none'
      if (existing) {
        return {
          ...existing,
          w: draft.w,
          h:
            existing.kind === 'text'
              ? Math.max(
                  36,
                  (trimmed || ' ').split('\n').length * draft.fontSize * 1.38,
                )
              : existing.h,
          text: trimmed,
          fontFamily: draft.fontFamily,
          fontSize: draft.fontSize,
          fontWeight: draft.fontWeight,
          fontStyle: draft.fontStyle,
          textDecoration,
          textAlign: draft.textAlign,
          textBg: draft.textBg,
          strokeColor:
            existing.kind === 'text' ? draft.color : existing.strokeColor,
        }
      }
      const meta = liveTextMetaRef.current
      const id = draft.elementId || meta?.id || makeElementId()
      const zIndex =
        meta?.zIndex ??
        elementsRef.current.reduce((m, e) => Math.max(m, e.zIndex), 0) + 1
      const createdAt = meta?.createdAt ?? Date.now()
      const deck =
        meta?.deckId !== undefined
          ? { id: meta.deckId, pdfPageIndex: meta.deckPage ?? 0 }
          : findEnclosingPdfDeck(draft.wx, draft.wy)
      if (draft.kind === 'sticky') {
        return {
          id,
          kind: 'sticky',
          x: draft.wx,
          y: draft.wy,
          w: draft.w,
          h: draft.h,
          rotation: 0,
          strokeColor: draft.color,
          fillColor: 'transparent',
          strokeWidth: 2,
          strokeStyle: 'solid',
          opacity,
          text: trimmed || 'Note',
          fontFamily: draft.fontFamily,
          fontSize: draft.fontSize,
          fontWeight: draft.fontWeight,
          fontStyle: draft.fontStyle,
          textAlign: draft.textAlign,
          stickyBg: draft.stickyBg || stickyColor,
          pdfDeckId: deck?.id,
          pdfDeckPage: deck ? (deck.pdfPageIndex ?? 0) : undefined,
          zIndex,
          author,
          createdAt,
        }
      }
      return {
        id,
        kind: 'text',
        x: draft.wx,
        y: draft.wy,
        w: Math.max(140, draft.w),
        h: Math.max(
          36,
          (trimmed || ' ').split('\n').length * draft.fontSize * 1.38,
        ),
        rotation: 0,
        strokeColor: draft.color,
        fillColor: 'transparent',
        strokeWidth,
        strokeStyle: 'solid',
        opacity,
        text: trimmed,
        fontFamily: draft.fontFamily,
        fontSize: draft.fontSize,
        fontWeight: draft.fontWeight,
        fontStyle: draft.fontStyle,
        textDecoration,
        textAlign: draft.textAlign,
        textBg: draft.textBg,
        pdfDeckId: deck?.id,
        pdfDeckPage: deck ? (deck.pdfPageIndex ?? 0) : undefined,
        zIndex,
        author,
        createdAt,
      }
    },
    [author, findEnclosingPdfDeck, opacity, stickyColor, strokeWidth],
  )

  // Stream live typing/formatting edits to Firestore every ~70ms so remote
  // participants see the teacher write in real time.
  const handleTextEditChange = useCallback(
    (nextDraft: RichTextDraft) => {
      setTextEdit(nextDraft)
      const now = Date.now()
      if (now - lastTextSyncRef.current < 70) return
      lastTextSyncRef.current = now
      const existing = nextDraft.elementId
        ? elementsRef.current.find((e) => e.id === nextDraft.elementId)
        : undefined
      if (!existing && nextDraft.kind === 'text' && !nextDraft.value.trim()) {
        return
      }
      const liveEl = buildElementFromTextDraft(nextDraft, existing)
      syncUpsert(liveEl)
    },
    [buildElementFromTextDraft, syncUpsert],
  )

  const cancelTextEdit = useCallback(() => {
    const meta = liveTextMetaRef.current
    liveTextMetaRef.current = null
    if (meta?.id) {
      activeEditingIdsRef.current.delete(meta.id)
      if (meta.isNew) {
        syncDelete([meta.id])
      }
    }
    setTextEdit(null)
  }, [syncDelete])

  const commitTextEdit = useCallback(
    (draft: RichTextDraft) => {
      const meta = liveTextMetaRef.current
      liveTextMetaRef.current = null
      if (draft.elementId) activeEditingIdsRef.current.delete(draft.elementId)
      if (meta?.id) activeEditingIdsRef.current.delete(meta.id)
      setTextEdit(null)
      const trimmed = draft.value.trimEnd()
      const prev = elementsRef.current

      if (draft.elementId && !meta?.isNew) {
        const existing = prev.find((e) => e.id === draft.elementId)
        if (!existing) return
        if (!trimmed && existing.kind === 'text') {
          pushHistory(prev)
          const next = prev.filter((e) => e.id !== draft.elementId)
          elementsRef.current = next
          setElements(next)
          syncDelete([draft.elementId])
          return
        }
        const updated = buildElementFromTextDraft(draft, existing)
        pushHistory(prev)
        const next = prev.map((e) => (e.id === draft.elementId ? updated : e))
        elementsRef.current = next
        setElements(next)
        syncUpsert(updated)
        return
      }

      if (!trimmed && draft.kind === 'text') {
        const dropId = draft.elementId || meta?.id
        if (dropId) syncDelete([dropId])
        return
      }
      const created = buildElementFromTextDraft(draft)
      pushHistory(prev)
      const next = [...prev.filter((e) => e.id !== created.id), created]
      elementsRef.current = next
      setElements(next)
      setSelectedIds([created.id])
      syncUpsert(created)
    },
    [buildElementFromTextDraft, pushHistory, syncDelete, syncUpsert],
  )

  // ---- Pointer Events ------------------------------------------------------
  const hitElementTop = (wx: number, wy: number) => {
    const tol = 8 / cameraRef.current.zoom
    const sorted = [...getVisibleElements(elementsRef.current)].sort(
      (a, b) => b.zIndex - a.zIndex,
    )
    return sorted.find((el) => hitTestElement(el, wx, wy, tol)) ?? null
  }

  const hitHandle = (
    el: BoardElement,
    wx: number,
    wy: number,
  ): HandleId | null => {
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
    if (!hit || hit.locked || hit.kind === 'pdf-deck') return
    interactionRef.current?.erasedIds?.add(hit.id)
    const next = elementsRef.current.filter((e) => e.id !== hit.id)
    elementsRef.current = next
    setElements(next)
    setSelectedIds((s) => s.filter((id) => id !== hit.id))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (contextMenu) setContextMenu(null)
    if (textEdit) {
      commitTextEdit(textEdit)
      return
    }
    if (editingTableId) {
      setEditingTableId(null)
      return
    }
    if (croppingId) return

    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)

    // Multi-touch pinch zoom
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
      const now = Date.now()
      interactionRef.current = {
        mode: 'laser',
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWx: wx,
        startWy: wy,
        startCamera: { ...cameraRef.current },
      }
      localLaserRef.current.push({ x: wx, y: wy, at: now })
      lastFsLaserEmitRef.current = now
      onLaser?.(wx, wy)
      if (syncScope?.kind === 'board') {
        void updateWhiteboardPresence(syncScope.boardId, author, {
          name: authorName || 'Presenter',
          laserX: wx,
          laserY: wy,
          active: true,
          at: now,
        })
      }
      setRenderTick((t) => t + 1)
      return
    }

    if (tool === 'text') {
      e.preventDefault()
      const newId = makeElementId()
      const maxZ = elementsRef.current.reduce(
        (m, el) => Math.max(m, el.zIndex),
        0,
      )
      const deck = findEnclosingPdfDeck(wx, wy)
      liveTextMetaRef.current = {
        id: newId,
        isNew: true,
        zIndex: maxZ + 1,
        createdAt: Date.now(),
        deckId: deck?.id,
        deckPage: deck ? (deck.pdfPageIndex ?? 0) : undefined,
      }
      activeEditingIdsRef.current.add(newId)
      lastTextSyncRef.current = 0
      setTextEdit({
        elementId: newId,
        kind: 'text',
        wx,
        wy,
        w: 300,
        h: 56,
        value: '',
        fontFamily: 'sans',
        fontSize: Math.max(18, strokeWidth * 5),
        fontWeight: 'normal',
        fontStyle: 'normal',
        underline: false,
        strikethrough: false,
        color: strokeColor,
        textBg: 'transparent',
        textAlign: 'left',
      })
      return
    }

    if (tool === 'sticky') {
      const newId = makeElementId()
      const maxZ = elementsRef.current.reduce(
        (m, el) => Math.max(m, el.zIndex),
        0,
      )
      const deck = findEnclosingPdfDeck(wx - 95, wy - 75)
      liveTextMetaRef.current = {
        id: newId,
        isNew: true,
        zIndex: maxZ + 1,
        createdAt: Date.now(),
        deckId: deck?.id,
        deckPage: deck ? (deck.pdfPageIndex ?? 0) : undefined,
      }
      activeEditingIdsRef.current.add(newId)
      lastTextSyncRef.current = 0
      const initialDraft: RichTextDraft = {
        elementId: newId,
        kind: 'sticky',
        wx: wx - 95,
        wy: wy - 75,
        w: 190,
        h: 150,
        value: '',
        stickyBg: stickyColor,
        fontFamily: 'sans',
        fontSize: 16,
        fontWeight: 'normal',
        fontStyle: 'normal',
        underline: false,
        strikethrough: false,
        color: '#1f2924',
        textBg: 'transparent',
        textAlign: 'left',
      }
      setTextEdit(initialDraft)
      syncUpsert(buildElementFromTextDraft(initialDraft))
      return
    }

    if (tool === 'table') {
      insertTable(tableRowsPick, tableColsPick)
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
        // If object belongs to a group, expand selection to whole group
        const groupMembers = hit.groupId
          ? elementsRef.current
              .filter((el) => el.groupId === hit.groupId)
              .map((el) => el.id)
          : [hit.id]

        let nextSel = selectedIdsRef.current
        if (e.shiftKey) {
          const allIn = groupMembers.every((id) => nextSel.includes(id))
          nextSel = allIn
            ? nextSel.filter((id) => !groupMembers.includes(id))
            : Array.from(new Set([...nextSel, ...groupMembers]))
        } else if (!nextSel.includes(hit.id)) {
          nextSel = groupMembers
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

    // Drawing tools (pen, highlighter, line, arrow, shapes, frame)
    const maxZ = elementsRef.current.reduce((m, el) => Math.max(m, el.zIndex), 0)
    const kind = tool as ElementKind
    const isFree = kind === 'pen' || kind === 'highlighter'
    const isLine = kind === 'line' || kind === 'arrow'
    const deck = kind !== 'frame' ? findEnclosingPdfDeck(wx, wy) : null

    let startX = wx
    let startY = wy
    let startAnchor: BoardElement['startAnchor']
    if (isLine) {
      const snapped = findNearestAnchor(
        getVisibleElements(elementsRef.current),
        wx,
        wy,
        new Set(),
        24 / cameraRef.current.zoom,
      )
      if (snapped) {
        startX = snapped.x
        startY = snapped.y
        startAnchor = snapped.anchor
      }
    }

    const draft: BoardElement = {
      id: makeElementId(),
      kind,
      x: startX,
      y: startY,
      w: 0,
      h: 0,
      points: isFree || isLine ? [startX, startY, startX, startY] : undefined,
      pointWidths:
        kind === 'pen' && penPreset === 'calligraphy'
          ? [strokeWidth, strokeWidth]
          : undefined,
      penPreset: kind === 'pen' ? penPreset : undefined,
      startAnchor,
      rotation: 0,
      strokeColor: kind === 'frame' ? '#236446' : strokeColor,
      fillColor:
        kind === 'frame'
          ? boardTheme === 'dark'
            ? 'rgba(30,40,35,0.45)'
            : 'rgba(255,255,255,0.65)'
          : isFree || isLine
            ? 'transparent'
            : fillColor,
      strokeWidth: kind === 'frame' ? 2 : strokeWidth,
      strokeStyle: kind === 'frame' ? 'dashed' : strokeStyle,
      opacity,
      frameTitle:
        kind === 'frame'
          ? `Slide ${elementsRef.current.filter((e) => e.kind === 'frame').length + 1}`
          : undefined,
      frameRatio: kind === 'frame' ? 'custom' : undefined,
      pdfDeckId: deck?.id,
      pdfDeckPage: deck ? (deck.pdfPageIndex ?? 0) : undefined,
      zIndex:
        kind === 'frame'
          ? elementsRef.current.reduce((m, el) => Math.min(m, el.zIndex), 1) - 1
          : maxZ + 1,
      author,
      createdAt: Date.now(),
    }
    draftRef.current = draft
    lastStreamSyncRef.current = 0
    lastDrawSampleRef.current = { x: startX, y: startY, t: Date.now() }
    interactionRef.current = {
      mode: 'draw',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWx: startX,
      startWy: startY,
      startCamera: { ...cameraRef.current },
    }
    paintCanvas()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (
      e.pointerType === 'touch' &&
      activeTouchesRef.current.has(e.pointerId)
    ) {
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

    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY)
    const inter = interactionRef.current

    // Highlight nearest smart connector anchor on hover when using line/arrow
    if (!inter && (tool === 'line' || tool === 'arrow') && canDraw) {
      const snap = findNearestAnchor(
        getVisibleElements(elementsRef.current),
        wx,
        wy,
        new Set(),
        24 / cameraRef.current.zoom,
      )
      hoveredAnchorRef.current = snap ? { x: snap.x, y: snap.y } : null
      paintCanvas()
      return
    }

    if (!inter || inter.pointerId !== e.pointerId) return

    if (inter.mode === 'pan') {
      setCamera({
        ...inter.startCamera,
        panX: inter.startCamera.panX + (e.clientX - inter.startClientX),
        panY: inter.startCamera.panY + (e.clientY - inter.startClientY),
      })
      return
    }

    if (inter.mode === 'laser') {
      const now = Date.now()
      localLaserRef.current.push({ x: wx, y: wy, at: now })
      if (now - lastLaserEmitRef.current > 35) {
        lastLaserEmitRef.current = now
        onLaser?.(wx, wy)
      }
      if (
        syncScope?.kind === 'board' &&
        now - lastFsLaserEmitRef.current >= 60
      ) {
        lastFsLaserEmitRef.current = now
        void updateWhiteboardPresence(syncScope.boardId, author, {
          name: authorName || 'Presenter',
          laserX: wx,
          laserY: wy,
          active: true,
          at: now,
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
      let dx = wx - inter.startWx
      let dy = wy - inter.startWy

      // Smart alignment guides & snap-to-grid
      const movingList = Array.from(inter.initialElements.values())
      const movingIds = new Set(movingList.map((el) => el.id))
      const rawBounds = getContentBounds(
        movingList.map((el) => translateElement(el, dx, dy)),
      )
      if (rawBounds) {
        const others = getVisibleElements(elementsRef.current).filter(
          (el) => !movingIds.has(el.id),
        )
        const snap = computeSnapAndGuides(rawBounds, others, {
          snapToGrid,
          gridStep: 32,
          tolerance: 6 / cameraRef.current.zoom,
        })
        dx += snap.dx
        dy += snap.dy
        guidesRef.current = snap.guides
      }

      const movedEls: BoardElement[] = []
      const translatedList = elementsRef.current.map((el) => {
        const orig = inter.initialElements!.get(el.id)
        if (!orig) return el
        const translated = translateElement(orig, dx, dy)
        movedEls.push(translated)
        return translated
      })
      const { next, updatedConnectors } = updateAttachedConnectors(
        translatedList,
        movingIds,
      )
      elementsRef.current = next
      setElements(next)
      const now = Date.now()
      if (movedEls.length > 0 && now - lastStreamSyncRef.current >= 65) {
        lastStreamSyncRef.current = now
        syncBatch([...movedEls, ...updatedConnectors])
      }
      return
    }

    if (
      inter.mode === 'resize' &&
      inter.initialElements &&
      inter.initialBounds &&
      inter.handleId
    ) {
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
      const updatedList = elementsRef.current.map((el) =>
        el.id === id ? resized : el,
      )
      const { next, updatedConnectors } = updateAttachedConnectors(
        updatedList,
        new Set([id]),
      )
      elementsRef.current = next
      setElements(next)
      const now = Date.now()
      if (now - lastStreamSyncRef.current >= 65) {
        lastStreamSyncRef.current = now
        syncBatch([resized, ...updatedConnectors])
      }
      return
    }

    if (
      inter.mode === 'rotate' &&
      inter.initialElements &&
      inter.initialBounds
    ) {
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
      if (now - lastStreamSyncRef.current >= 65) {
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
        const dist = Math.hypot(wx - lx, wy - ly)
        if (dist < 1.5 / cameraRef.current.zoom) return
        pts.push(wx, wy)
        if (d.kind === 'pen' && d.penPreset === 'calligraphy') {
          const nowT = Date.now()
          const prevSample = lastDrawSampleRef.current
          const dt = Math.max(4, nowT - (prevSample?.t ?? nowT - 16))
          const velocity = dist / dt // px per ms
          // Slower stroke = wider ink deposit, faster stroke = crisp tapered stroke
          const factor = Math.max(0.35, Math.min(1.65, 1.5 - velocity * 0.45))
          const prevW =
            d.pointWidths?.[d.pointWidths.length - 1] ?? d.strokeWidth
          const smoothedW = prevW * 0.6 + d.strokeWidth * factor * 0.4
          d.pointWidths = [...(d.pointWidths ?? []), smoothedW]
          lastDrawSampleRef.current = { x: wx, y: wy, t: nowT }
        }
      } else if (d.kind === 'line' || d.kind === 'arrow') {
        const snap = findNearestAnchor(
          getVisibleElements(elementsRef.current),
          wx,
          wy,
          new Set([d.id]),
          24 / cameraRef.current.zoom,
        )
        const ex = snap ? snap.x : wx
        const ey = snap ? snap.y : wy
        hoveredAnchorRef.current = snap ? { x: snap.x, y: snap.y } : null
        d.endAnchor = snap?.anchor
        d.points = [inter.startWx, inter.startWy, ex, ey]
        d.w = ex - inter.startWx
        d.h = ey - inter.startWy
      } else {
        d.x = Math.min(inter.startWx, wx)
        d.y = Math.min(inter.startWy, wy)
        d.w = Math.abs(wx - inter.startWx)
        d.h = Math.abs(wy - inter.startWy)
      }
      paintCanvas()
      const now = Date.now()
      if (now - lastStreamSyncRef.current >= 65) {
        lastStreamSyncRef.current = now
        syncUpsert({
          ...d,
          points: d.points ? [...d.points] : undefined,
          pointWidths: d.pointWidths ? [...d.pointWidths] : undefined,
        })
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
    guidesRef.current = []
    hoveredAnchorRef.current = null

    if (inter.mode === 'laser') {
      if (syncScope?.kind === 'board') {
        void updateWhiteboardPresence(syncScope.boardId, author, {
          name: authorName || 'Presenter',
          laserX: null,
          laserY: null,
          active: false,
          at: Date.now(),
        })
      }
      return
    }

    if (inter.mode === 'marquee') {
      const m = marqueeRef.current
      marqueeRef.current = null
      if (m && (m.w > 4 || m.h > 4)) {
        const hits = getVisibleElements(elementsRef.current)
          .filter((el) => el.kind !== 'frame' && rectsIntersect(m, getElementBounds(el)))
          .map((el) => el.id)
        setSelectedIds(hits)
      }
      paintCanvas()
      return
    }

    if (
      inter.mode === 'erase' &&
      inter.erasedIds &&
      inter.erasedIds.size > 0
    ) {
      const before = Array.from(inter.initialElements?.values() ?? [])
      pushHistory(before)
      syncDelete(Array.from(inter.erasedIds))
      return
    }

    if (
      (inter.mode === 'move' ||
        inter.mode === 'resize' ||
        inter.mode === 'rotate') &&
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
        const changedIds = new Set(inter.initialElements.keys())
        const updated = elementsRef.current.filter(
          (el) =>
            changedIds.has(el.id) ||
            (el.startAnchor && changedIds.has(el.startAnchor.elementId)) ||
            (el.endAnchor && changedIds.has(el.endAnchor.elementId)),
        )
        syncBatch(updated)
      }
      paintCanvas()
      return
    }

    if (inter.mode === 'draw' && draftRef.current) {
      let draft = draftRef.current
      draftRef.current = null

      // Smart Shape Pen: recognize rough strokes & snap to clean vector shape
      if (
        draft.kind === 'pen' &&
        draft.penPreset === 'smart-shape' &&
        draft.points
      ) {
        const snapped = recognizeSmartShape(draft.points, draft)
        if (snapped) {
          draft = snapped
        }
      }

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
    if (hit && !hit.locked && hit.kind === 'table') {
      setEditingTableId(hit.id)
      return
    }
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
      const dec = hit.textDecoration ?? 'none'
      liveTextMetaRef.current = {
        id: hit.id,
        isNew: false,
        zIndex: hit.zIndex,
        createdAt: hit.createdAt,
        deckId: hit.pdfDeckId,
        deckPage: hit.pdfDeckPage,
      }
      activeEditingIdsRef.current.add(hit.id)
      lastTextSyncRef.current = 0
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
        w: Math.max(180, b.w),
        h: Math.max(48, b.h),
        value: hit.text ?? '',
        stickyBg: hit.stickyBg,
        fontFamily: hit.fontFamily ?? 'sans',
        fontSize: hit.fontSize ?? (hit.kind === 'sticky' ? 16 : 20),
        fontWeight: hit.fontWeight ?? 'normal',
        fontStyle: hit.fontStyle ?? 'normal',
        underline: dec.includes('underline'),
        strikethrough: dec.includes('line-through'),
        color: hit.strokeColor,
        textBg: hit.textBg ?? 'transparent',
        textAlign: hit.textAlign ?? 'left',
      })
    } else if (tool === 'hand') {
      fitToContent()
    }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!canDraw) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY)
    const hit = hitElementTop(wx, wy)
    if (hit && !selectedIdsRef.current.includes(hit.id)) {
      const groupMembers = hit.groupId
        ? elementsRef.current
            .filter((el) => el.groupId === hit.groupId)
            .map((el) => el.id)
        : [hit.id]
      setSelectedIds(groupMembers)
      selectedIdsRef.current = groupMembers
    }
    if (selectedIdsRef.current.length === 0 && clipboard.length === 0) return
    const mx = Math.min(rect.width - 200, Math.max(8, e.clientX - rect.left))
    const my = Math.min(rect.height - 260, Math.max(8, e.clientY - rect.top))
    setContextMenu({ x: mx, y: my })
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

  // Drag-and-drop Image OR PDF upload onto canvas
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (!canDraw) return
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf')
    ) {
      void openPdfFileForImport(file)
      return
    }
    if (file.type.startsWith('image/')) {
      const { x, y } = screenToWorld(e.clientX, e.clientY)
      void addImageAt(file, x, y)
    }
  }

  // Interactive Minimap click/drag panning
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
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      )
        return
      if (e.code === 'Space') {
        setSpacePressed(true)
        return
      }
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault()
          undo()
        } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
          e.preventDefault()
          redo()
        } else if (k === 'd') {
          e.preventDefault()
          duplicateSelected()
        } else if (k === 'c') {
          e.preventDefault()
          copySelected()
        } else if (k === 'v') {
          e.preventDefault()
          pasteClipboard()
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
  }, [
    canDraw,
    copySelected,
    deleteSelected,
    duplicateSelected,
    pasteClipboard,
    redo,
    undo,
  ])

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

  const exportFramesPdf = () => {
    if (frameElements.length === 0) return
    try {
      const pages = frameElements.map((frame) => {
        const b = getElementBounds(frame)
        const canvas = renderExportCanvas(elementsRef.current, {
          bounds: b,
          scale: 1.25,
          theme: boardTheme,
          pattern,
        })
        return {
          dataUrl: canvas.toDataURL('image/jpeg', 0.9),
          width: canvas.width,
          height: canvas.height,
        }
      })
      const blob = buildPdf(pages)
      downloadBlob(
        blob,
        `${(title || 'lectern-slides').replace(/[^\w-]+/g, '_')}-slides.pdf`,
      )
      toast.success(`Exported ${pages.length} slides to PDF`)
    } catch {
      toast.error('Could not export frames to PDF.')
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

  const ActiveShapeIcon =
    SHAPE_TOOLS.find((s) => s.tool === tool)?.icon ??
    SHAPE_TOOLS.find((s) => s.tool === lastShapeTool)?.icon ??
    Square
  const isShapeActive = SHAPE_TOOLS.some((s) => s.tool === tool)
  const ActivePenIcon =
    PEN_PRESETS.find((p) => p.id === penPreset)?.icon ?? Pen

  // Compute floating toolbar anchor above selected object(s)
  const selectionAnchor = useMemo(() => {
    if (selectedElements.length === 0) return null
    const b = getContentBounds(selectedElements)
    if (!b) return null
    return {
      x: (b.x + b.w / 2) * camera.zoom + camera.panX,
      y: b.y * camera.zoom + camera.panY,
    }
  }, [selectedElements, camera])

  const croppingElement = croppingId
    ? (elements.find((e) => e.id === croppingId) ?? null)
    : null
  const editingTable = editingTableId
    ? (elements.find((e) => e.id === editingTableId) ?? null)
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
        ref={replaceImgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleReplaceImageFile(f)
          e.target.value = ''
        }}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void openPdfFileForImport(f)
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

            {/* Pen button + Expandable Pen Submenu */}
            <div className="flex items-center">
              <ToolButton
                label="Pen"
                active={tool === 'pen'}
                onClick={() => setTool('pen')}
              >
                <ActivePenIcon className="size-4" />
              </ToolButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Pen styles and presets"
                    title="Pen styles, stroke type & thickness"
                    className={cn(
                      'grid h-8 w-4 place-items-center rounded-md transition-colors hover:bg-background',
                      tool === 'pen' && 'text-primary',
                    )}
                  >
                    <ChevronDown className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64 p-1.5">
                  <DropdownMenuLabel className="text-xs">
                    Pen Tip &amp; Mode
                  </DropdownMenuLabel>
                  {PEN_PRESETS.map((preset) => (
                    <DropdownMenuItem
                      key={preset.id}
                      onSelect={() => {
                        setPenPreset(preset.id)
                        setTool('pen')
                      }}
                      className="flex items-center gap-2"
                    >
                      <preset.icon className="size-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium">{preset.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {preset.desc}
                        </p>
                      </div>
                      {penPreset === preset.id && (
                        <span className="text-xs text-primary">●</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">
                    Stroke Style
                  </DropdownMenuLabel>
                  <div className="grid grid-cols-3 gap-1 px-1.5 pb-1.5">
                    {(['solid', 'dashed', 'dotted'] as StrokeStyle[]).map(
                      (st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setStrokeStyle(st)}
                          className={cn(
                            'rounded-md border px-2 py-1 text-[11px] capitalize transition-colors',
                            strokeStyle === st
                              ? 'border-primary bg-primary/12 font-medium text-primary'
                              : 'border-border hover:bg-muted',
                          )}
                        >
                          {st}
                        </button>
                      ),
                    )}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">
                    Thickness &amp; Opacity
                  </DropdownMenuLabel>
                  <div className="space-y-2 px-1.5 pb-1.5">
                    <div className="flex items-center justify-between gap-1.5">
                      {THICKNESS_DOTS.map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          aria-label={`Thickness ${sz}px`}
                          onClick={() => setStrokeWidth(sz)}
                          className={cn(
                            'grid size-7 place-items-center rounded-md border transition-colors',
                            strokeWidth === sz
                              ? 'border-primary bg-primary/12'
                              : 'border-border hover:bg-muted',
                          )}
                        >
                          <span
                            className="rounded-full bg-foreground"
                            style={{
                              width: Math.min(16, sz + 2),
                              height: Math.min(16, sz + 2),
                            }}
                          />
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="w-12">Size {strokeWidth}</span>
                      <input
                        type="range"
                        min={1}
                        max={24}
                        value={strokeWidth}
                        onChange={(e) => setStrokeWidth(Number(e.target.value))}
                        className="flex-1 accent-primary"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="w-12">
                        Op {Math.round(opacity * 100)}%
                      </span>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={Math.round(opacity * 100)}
                        onChange={(e) =>
                          setOpacity(Number(e.target.value) / 100)
                        }
                        className="flex-1 accent-primary"
                      />
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <ToolButton
              label="Highlighter"
              active={tool === 'highlighter'}
              onClick={() => setTool('highlighter')}
            >
              <Highlighter className="size-4" />
            </ToolButton>
            <ToolButton
              label="Line (Smart Connector)"
              active={tool === 'line'}
              onClick={() => setTool('line')}
            >
              <Minus className="size-4" />
            </ToolButton>
            <ToolButton
              label="Arrow (Smart Connector)"
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

            {/* Editable Table Picker */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Insert table"
                      className="grid size-8 place-items-center rounded-md hover:bg-background"
                    >
                      <Table2 className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Insert table</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-52 p-3">
                <DropdownMenuLabel className="px-0 pt-0 text-xs">
                  Insert Editable Table
                </DropdownMenuLabel>
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Rows</span>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-6"
                        onClick={() =>
                          setTableRowsPick((r) => Math.max(1, r - 1))
                        }
                      >
                        <Minus className="size-3" />
                      </Button>
                      <span className="w-6 text-center font-medium tabular-nums">
                        {tableRowsPick}
                      </span>
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-6"
                        onClick={() =>
                          setTableRowsPick((r) => Math.min(10, r + 1))
                        }
                      >
                        <Plus className="size-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Columns</span>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-6"
                        onClick={() =>
                          setTableColsPick((c) => Math.max(1, c - 1))
                        }
                      >
                        <Minus className="size-3" />
                      </Button>
                      <span className="w-6 text-center font-medium tabular-nums">
                        {tableColsPick}
                      </span>
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-6"
                        onClick={() =>
                          setTableColsPick((c) => Math.min(8, c + 1))
                        }
                      >
                        <Plus className="size-3" />
                      </Button>
                    </div>
                  </div>
                  <Button
                    size="xs"
                    className="w-full"
                    onClick={() => insertTable(tableRowsPick, tableColsPick)}
                  >
                    Insert {tableRowsPick}×{tableColsPick} Table
                  </Button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Frame / Lesson Slide tool */}
            <ToolButton
              label="Draw Lesson Frame"
              active={tool === 'frame'}
              onClick={() => setTool('frame')}
            >
              <Frame className="size-4" />
            </ToolButton>

            <ToolButton
              label="Upload image"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-4" />
            </ToolButton>
            <ToolButton
              label="Import PDF"
              onClick={() => pdfInputRef.current?.click()}
            >
              <FileUp className="size-4" />
            </ToolButton>

            {/* Quick Math & Symbols Picker */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Math symbols and coordinate plane"
                      className="grid size-8 place-items-center rounded-md hover:bg-background"
                    >
                      <Sigma className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Math symbols &amp; graph grid
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-60 p-2">
                <DropdownMenuLabel className="px-1 pt-0 text-xs">
                  Math &amp; Science Symbols
                </DropdownMenuLabel>
                <div className="grid grid-cols-6 gap-1">
                  {MATH_SYMBOLS.map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => insertMathSymbol(sym)}
                      className="grid size-8 place-items-center rounded-md border border-transparent text-sm font-medium hover:border-border hover:bg-muted"
                    >
                      {sym}
                    </button>
                  ))}
                </div>
                <DropdownMenuSeparator className="my-2" />
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={() => insertTemplate('coordGrid')}
                >
                  <Grid2X2 className="size-3.5" /> Insert Coordinate Plane
                </Button>
              </DropdownMenuContent>
            </DropdownMenu>

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

        {/* Color swatches, width, undo/redo, clear */}
        {canDraw && (
          <div className="flex flex-wrap items-center gap-1.5">
            {tool === 'sticky' ? (
              <div
                className="flex items-center gap-1"
                aria-label="Sticky note colour"
              >
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
                className="w-12 accent-primary"
                aria-label="Stroke width"
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
                label="Snap to grid"
                active={snapToGrid}
                onClick={() => setSnapToGrid((s) => !s)}
              >
                <Magnet className="size-4" />
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

        {/* Right utilities: Slides, Bring Everyone, Boards, Annotate, Follow, Background, Export, Close */}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <button
            type="button"
            aria-pressed={framesOpen}
            aria-label="Lesson slides and frames"
            onClick={() => setFramesOpen((o) => !o)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors',
              framesOpen
                ? 'border-primary/40 bg-primary/12 text-primary'
                : 'border-border bg-muted/60 text-muted-foreground hover:text-foreground',
            )}
          >
            <Frame className="size-3.5 shrink-0" />
            <span className="hidden sm:inline">
              Slides{frameElements.length > 0 ? ` (${frameElements.length})` : ''}
            </span>
          </button>

          {isTeacher && (onCameraBroadcast || syncScope?.kind === 'board') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="h-8 gap-1.5 px-2 text-xs"
                  aria-label="Bring everyone to my view"
                  onClick={bringEveryoneToMe}
                >
                  <Navigation className="size-3.5 text-primary" />
                  <span className="hidden xl:inline">Bring everyone</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Jump all students immediately to your current viewport &amp;
                zoom
              </TooltipContent>
            </Tooltip>
          )}

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
              {frameElements.length > 0 && (
                <DropdownMenuItem onSelect={exportFramesPdf}>
                  Export Slides ({frameElements.length}) to PDF
                </DropdownMenuItem>
              )}
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

      {/* Infinite Canvas Viewport */}
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
          onContextMenu={onContextMenu}
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

          {/* Interactive PDF Deck Page Flipper Overlays */}
          {pdfDecks.map((deck) => {
            const b = getElementBounds(deck)
            const sx = (b.x + b.w / 2) * camera.zoom + camera.panX
            const sy = (b.y + b.h) * camera.zoom + camera.panY + 8
            const page = (deck.pdfPageIndex ?? 0) + 1
            const total = Math.max(1, deck.pdfPageCount ?? 1)
            return (
              <div
                key={deck.id}
                onPointerDown={(e) => e.stopPropagation()}
                style={{ left: sx, top: sy }}
                className="absolute z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1 text-xs text-card-foreground shadow-md backdrop-blur"
              >
                <button
                  type="button"
                  aria-label="Previous PDF page"
                  disabled={page <= 1}
                  onClick={() => flipPdfDeckPage(deck, -1)}
                  className="grid size-6 place-items-center rounded-full hover:bg-muted disabled:opacity-35"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="min-w-20 text-center font-medium tabular-nums">
                  Page {page} / {total}
                </span>
                <button
                  type="button"
                  aria-label="Next PDF page"
                  disabled={page >= total}
                  onClick={() => flipPdfDeckPage(deck, 1)}
                  className="grid size-6 place-items-center rounded-full hover:bg-muted disabled:opacity-35"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            )
          })}

          {/* Zoom-Style Floating Selection Toolbar */}
          {canDraw &&
            selectionAnchor &&
            selectedElements.length > 0 &&
            !textEdit &&
            !croppingElement &&
            !editingTable && (
              <SelectionFloatingToolbar
                selectedElements={selectedElements}
                anchor={selectionAnchor}
                containerWidth={viewportSize.width}
                containerHeight={viewportSize.height}
                hasClipboard={clipboard.length > 0}
                onDelete={deleteSelected}
                onDuplicate={duplicateSelected}
                onCopy={copySelected}
                onPaste={pasteClipboard}
                onToggleLock={toggleLockSelected}
                onReorder={reorderSelected}
                onRotate90={rotateSelected90}
                onFlip={flipSelected}
                onOpacityChange={setSelectedOpacity}
                onStartCrop={(el) => setCroppingId(el.id)}
                onReplaceImage={(el) => {
                  replaceTargetIdRef.current = el.id
                  replaceImgInputRef.current?.click()
                }}
                onDownloadImage={handleDownloadImage}
                onStyleImage={handleStyleImage}
                onGroupToggle={toggleGroupSelected}
                onAlign={handleAlignSelected}
                onDistribute={handleDistributeSelected}
                onAddMindMapBranch={handleAddMindMapBranch}
              />
            )}

          {/* Right-Click Context Menu */}
          {contextMenu && canDraw && (
            <CanvasContextMenu
              pos={contextMenu}
              hasSelection={selectedElements.length > 0}
              allLocked={
                selectedElements.length > 0 &&
                selectedElements.every((e) => e.locked)
              }
              hasClipboard={clipboard.length > 0}
              onClose={() => setContextMenu(null)}
              onCopy={copySelected}
              onPaste={pasteClipboard}
              onDuplicate={duplicateSelected}
              onToggleLock={toggleLockSelected}
              onReorder={reorderSelected}
              onDelete={deleteSelected}
            />
          )}

          {/* Interactive Image Crop Mode */}
          {croppingElement && (
            <ImageCropOverlay
              element={croppingElement}
              camera={camera}
              onCancel={() => setCroppingId(null)}
              onApply={(res) => {
                const prev = elementsRef.current
                const updated: BoardElement = {
                  ...croppingElement,
                  x: res.x,
                  y: res.y,
                  w: res.w,
                  h: res.h,
                  imageDataUrl: res.dataUrl,
                }
                const next = prev.map((e) =>
                  e.id === croppingElement.id ? updated : e,
                )
                pushHistory(prev)
                elementsRef.current = next
                setElements(next)
                syncUpsert(updated)
                setCroppingId(null)
                toast.success('Image cropped')
              }}
            />
          )}

          {/* Full Rich Text Inline Editor */}
          {textEdit && (
            <RichTextInlineEditor
              draft={textEdit}
              camera={camera}
              boardTheme={boardTheme}
              containerWidth={viewportSize.width}
              onChange={handleTextEditChange}
              onCommit={commitTextEdit}
              onCancel={cancelTextEdit}
            />
          )}

          {/* Inline Editable Table Overlay */}
          {editingTable && (
            <TableInlineEditor
              table={editingTable}
              camera={camera}
              onUpdate={updateTableElement}
              onClose={() => setEditingTableId(null)}
            />
          )}

          {/* Collapsible Lesson Slides / Frames Navigator Sidebar */}
          {framesOpen && (
            <FramesSidebar
              frames={frameElements}
              canDraw={canDraw}
              onJumpToFrame={(f) => jumpToRect(getElementBounds(f), 90)}
              onAddFrame={addPresetFrame}
              onRenameFrame={renameFrame}
              onDeleteFrame={deleteFrame}
              onExportFramesPdf={exportFramesPdf}
              onClose={() => setFramesOpen(false)}
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

      {/* PDF Import Dialog */}
      <PdfImportDialog
        open={pdfDialogOpen}
        session={pdfSession}
        loadingFile={pdfLoadingFile}
        importing={pdfImporting}
        importProgress={pdfProgress}
        onClose={closePdfDialog}
        onConfirm={(payload) => void confirmPdfImport(payload)}
      />

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
