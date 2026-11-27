import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Crop,
  Download,
  FlipHorizontal2,
  FlipVertical2,
  GitBranchPlus,
  Group,
  ImageUp,
  Layers,
  Lock,
  LockOpen,
  Palette,
  RotateCw,
  SlidersHorizontal,
  Trash2,
  Ungroup,
} from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  isConnectableShape,
  type AlignmentKind,
  type LayerDirection,
} from './geometry-utils'
import { BOARD_COLORS, type BoardElement } from './infinite-engine'

export interface SelectionToolbarProps {
  selectedElements: BoardElement[]
  /** Screen coordinates relative to canvas container */
  anchor: { x: number; y: number }
  containerWidth: number
  containerHeight: number
  hasClipboard: boolean
  onDelete: () => void
  onDuplicate: () => void
  onCopy: () => void
  onPaste: () => void
  onToggleLock: () => void
  onReorder: (dir: LayerDirection) => void
  onRotate90: () => void
  onFlip: (axis: 'x' | 'y') => void
  onOpacityChange: (opacity: number) => void
  onStartCrop: (el: BoardElement) => void
  onReplaceImage: (el: BoardElement) => void
  onDownloadImage: (el: BoardElement) => void
  onStyleImage: (
    el: BoardElement,
    patch: { borderRadius?: number; borderWidth?: number; borderColor?: string },
  ) => void
  onGroupToggle: () => void
  onAlign: (align: AlignmentKind) => void
  onDistribute: (axis: 'horizontal' | 'vertical') => void
  onAddMindMapBranch: (el: BoardElement) => void
}

/**
 * Zoom-style floating context toolbar anchored cleanly above selected whiteboard
 * object(s), styled strictly with Lectern's theme tokens.
 */
export function SelectionFloatingToolbar({
  selectedElements,
  anchor,
  containerWidth,
  containerHeight,
  hasClipboard,
  onDelete,
  onDuplicate,
  onCopy,
  onPaste,
  onToggleLock,
  onReorder,
  onRotate90,
  onFlip,
  onOpacityChange,
  onStartCrop,
  onReplaceImage,
  onDownloadImage,
  onStyleImage,
  onGroupToggle,
  onAlign,
  onDistribute,
  onAddMindMapBranch,
}: SelectionToolbarProps) {
  if (selectedElements.length === 0) return null

  const single = selectedElements.length === 1 ? selectedElements[0] : null
  const isSingleImage = single?.kind === 'image'
  const isMulti = selectedElements.length >= 2
  const allLocked = selectedElements.every((e) => e.locked)
  const sharedGroupId =
    isMulti &&
    selectedElements[0].groupId &&
    selectedElements.every((e) => e.groupId === selectedElements[0].groupId)
      ? selectedElements[0].groupId
      : null
  const avgOpacity = Math.round(
    (selectedElements.reduce((s, e) => s + (e.opacity ?? 1), 0) /
      selectedElements.length) *
      100,
  )

  // Clamp toolbar cleanly inside the viewport bounds
  const estWidth = isSingleImage ? 460 : isMulti ? 440 : 350
  const left = Math.max(
    12,
    Math.min(
      Math.max(12, containerWidth - estWidth - 12),
      anchor.x - estWidth / 2,
    ),
  )
  const top = Math.max(
    10,
    Math.min(Math.max(10, containerHeight - 58), anchor.y - 52),
  )

  return (
    <div
      role="toolbar"
      aria-label="Selected object actions"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      style={{ left, top }}
      className="absolute z-30 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-0.5 rounded-xl border border-border bg-card/95 px-1.5 py-1 text-card-foreground shadow-lg backdrop-blur-md"
    >
      {/* Dedicated Single-Image Controls */}
      {isSingleImage && single && (
        <>
          <ActionIconBtn
            label="Crop image"
            disabled={Boolean(single.locked)}
            onClick={() => onStartCrop(single)}
          >
            <Crop className="size-3.5" />
          </ActionIconBtn>
          <ActionIconBtn
            label="Replace image"
            disabled={Boolean(single.locked)}
            onClick={() => onReplaceImage(single)}
          >
            <ImageUp className="size-3.5" />
          </ActionIconBtn>
          <ActionIconBtn
            label="Download image PNG"
            onClick={() => onDownloadImage(single)}
          >
            <Download className="size-3.5" />
          </ActionIconBtn>

          {/* Image Style Menu (Border width, color, rounded corners) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Image style"
                title="Image border & rounded corners"
                className="grid size-7 place-items-center rounded-md text-foreground hover:bg-muted"
              >
                <Palette className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 p-2.5">
              <DropdownMenuLabel className="px-0 pt-0 text-xs">
                Image Style
              </DropdownMenuLabel>
              <div className="space-y-2.5 text-xs">
                <div>
                  <div className="mb-1 flex justify-between text-muted-foreground">
                    <span>Corner radius</span>
                    <span className="tabular-nums">
                      {single.borderRadius ?? 0}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={48}
                    value={single.borderRadius ?? 0}
                    onChange={(e) =>
                      onStyleImage(single, {
                        borderRadius: Number(e.target.value),
                      })
                    }
                    className="w-full accent-primary"
                  />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-muted-foreground">
                    <span>Border width</span>
                    <span className="tabular-nums">
                      {single.borderWidth ?? 0}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={12}
                    value={single.borderWidth ?? 0}
                    onChange={(e) =>
                      onStyleImage(single, {
                        borderWidth: Number(e.target.value),
                        borderColor: single.borderColor || '#236446',
                      })
                    }
                    className="w-full accent-primary"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-muted-foreground">
                    Border color
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {BOARD_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Border color ${c}`}
                        onClick={() =>
                          onStyleImage(single, {
                            borderColor: c,
                            borderWidth: Math.max(2, single.borderWidth ?? 0),
                          })
                        }
                        className={cn(
                          'size-5 rounded-full border border-black/15',
                          single.borderColor === c && 'ring-2 ring-ring',
                        )}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <Divider />
        </>
      )}

      {/* Mind Map Quick Branch on single connectable shape/sticky */}
      {single && isConnectableShape(single) && single.kind !== 'image' && (
        <>
          <ActionIconBtn
            label="Add mind map branch"
            onClick={() => onAddMindMapBranch(single)}
          >
            <GitBranchPlus className="size-3.5" />
          </ActionIconBtn>
          <Divider />
        </>
      )}

      {/* Multi-selection Group / Align / Distribute */}
      {isMulti && (
        <>
          <ActionIconBtn
            label={sharedGroupId ? 'Ungroup selected' : 'Group selected'}
            onClick={onGroupToggle}
          >
            {sharedGroupId ? (
              <Ungroup className="size-3.5" />
            ) : (
              <Group className="size-3.5" />
            )}
          </ActionIconBtn>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Align and distribute"
                title="Align & Distribute"
                className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium hover:bg-muted"
              >
                <AlignStartHorizontal className="size-3.5" />
                <span className="hidden sm:inline">Align</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Align</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => onAlign('left')}>
                <AlignStartVertical className="size-3.5" /> Align Left
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAlign('center')}>
                <AlignCenterVertical className="size-3.5" /> Align Center
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAlign('right')}>
                <AlignEndVertical className="size-3.5" /> Align Right
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onAlign('top')}>
                <AlignStartHorizontal className="size-3.5" /> Align Top
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAlign('middle')}>
                <AlignCenterHorizontal className="size-3.5" /> Align Middle
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAlign('bottom')}>
                <AlignEndHorizontal className="size-3.5" /> Align Bottom
              </DropdownMenuItem>
              {selectedElements.length >= 3 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Distribute</DropdownMenuLabel>
                  <DropdownMenuItem
                    onSelect={() => onDistribute('horizontal')}
                  >
                    <AlignHorizontalSpaceAround className="size-3.5" />{' '}
                    Distribute Horizontally
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onDistribute('vertical')}>
                    <AlignVerticalSpaceAround className="size-3.5" /> Distribute
                    Vertically
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Divider />
        </>
      )}

      {/* Transform: Rotate 90°, Flip H/V, Opacity */}
      <ActionIconBtn
        label="Rotate 90 degrees"
        disabled={allLocked}
        onClick={onRotate90}
      >
        <RotateCw className="size-3.5" />
      </ActionIconBtn>
      <ActionIconBtn
        label="Flip horizontal"
        disabled={allLocked}
        onClick={() => onFlip('x')}
      >
        <FlipHorizontal2 className="size-3.5" />
      </ActionIconBtn>
      <ActionIconBtn
        label="Flip vertical"
        disabled={allLocked}
        onClick={() => onFlip('y')}
      >
        <FlipVertical2 className="size-3.5" />
      </ActionIconBtn>

      {/* Opacity popover */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Object opacity"
            title={`Opacity ${avgOpacity}%`}
            className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <SlidersHorizontal className="size-3" />
            <span>{avgOpacity}%</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-48 p-3">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="font-medium">Opacity</span>
            <span className="tabular-nums text-muted-foreground">
              {avgOpacity}%
            </span>
          </div>
          <input
            type="range"
            min={10}
            max={100}
            value={avgOpacity}
            onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
            className="w-full accent-primary"
            aria-label="Selected object opacity"
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <Divider />

      {/* Full 4-way Layering menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Layer order"
            title="Arrange layer order"
            className="grid size-7 place-items-center rounded-md hover:bg-muted"
          >
            <Layers className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-44">
          <DropdownMenuLabel>Layering</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onReorder('front')}>
            <ArrowUpToLine className="size-3.5" /> Bring to Front
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onReorder('forward')}>
            <ArrowUp className="size-3.5" /> Bring Forward
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onReorder('backward')}>
            <ArrowDown className="size-3.5" /> Send Backward
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onReorder('back')}>
            <ArrowDownToLine className="size-3.5" /> Send to Back
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Copy, Paste, Duplicate, Lock/Unlock, Delete */}
      <ActionIconBtn label="Copy (Ctrl+C)" onClick={onCopy}>
        <ClipboardCopy className="size-3.5" />
      </ActionIconBtn>
      {hasClipboard && (
        <ActionIconBtn label="Paste (Ctrl+V)" onClick={onPaste}>
          <ClipboardPaste className="size-3.5" />
        </ActionIconBtn>
      )}
      <ActionIconBtn label="Duplicate (Ctrl+D)" onClick={onDuplicate}>
        <Copy className="size-3.5" />
      </ActionIconBtn>
      <ActionIconBtn
        label={allLocked ? 'Unlock object' : 'Lock object'}
        active={allLocked}
        onClick={onToggleLock}
      >
        {allLocked ? (
          <LockOpen className="size-3.5" />
        ) : (
          <Lock className="size-3.5" />
        )}
      </ActionIconBtn>

      <Divider />

      <ActionIconBtn
        label="Delete selected"
        danger
        disabled={allLocked}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </ActionIconBtn>
    </div>
  )
}

export function CanvasContextMenu({
  pos,
  hasSelection,
  allLocked,
  hasClipboard,
  onClose,
  onCopy,
  onPaste,
  onDuplicate,
  onToggleLock,
  onReorder,
  onDelete,
}: {
  pos: { x: number; y: number }
  hasSelection: boolean
  allLocked: boolean
  hasClipboard: boolean
  onClose: () => void
  onCopy: () => void
  onPaste: () => void
  onDuplicate: () => void
  onToggleLock: () => void
  onReorder: (dir: LayerDirection) => void
  onDelete: () => void
}) {
  return (
    <div
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
      style={{ left: pos.x, top: pos.y }}
      className="absolute z-40 w-48 rounded-xl border border-border bg-popover p-1 text-xs text-popover-foreground shadow-lg"
    >
      {hasSelection && (
        <>
          <CtxItem
            icon={ClipboardCopy}
            label="Copy"
            shortcut="Ctrl+C"
            onClick={() => {
              onCopy()
              onClose()
            }}
          />
          <CtxItem
            icon={Copy}
            label="Duplicate"
            shortcut="Ctrl+D"
            onClick={() => {
              onDuplicate()
              onClose()
            }}
          />
        </>
      )}
      {hasClipboard && (
        <CtxItem
          icon={ClipboardPaste}
          label="Paste"
          shortcut="Ctrl+V"
          onClick={() => {
            onPaste()
            onClose()
          }}
        />
      )}
      {hasSelection && (
        <>
          <div className="my-1 h-px bg-border" />
          <CtxItem
            icon={ArrowUpToLine}
            label="Bring to Front"
            onClick={() => {
              onReorder('front')
              onClose()
            }}
          />
          <CtxItem
            icon={ArrowUp}
            label="Bring Forward"
            onClick={() => {
              onReorder('forward')
              onClose()
            }}
          />
          <CtxItem
            icon={ArrowDown}
            label="Send Backward"
            onClick={() => {
              onReorder('backward')
              onClose()
            }}
          />
          <CtxItem
            icon={ArrowDownToLine}
            label="Send to Back"
            onClick={() => {
              onReorder('back')
              onClose()
            }}
          />
          <div className="my-1 h-px bg-border" />
          <CtxItem
            icon={allLocked ? LockOpen : Lock}
            label={allLocked ? 'Unlock' : 'Lock'}
            onClick={() => {
              onToggleLock()
              onClose()
            }}
          />
          {!allLocked && (
            <CtxItem
              icon={Trash2}
              label="Delete"
              shortcut="Del"
              danger
              onClick={() => {
                onDelete()
                onClose()
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

function CtxItem({
  icon: Icon,
  label,
  shortcut,
  danger,
  onClick,
}: {
  icon: typeof Copy
  label: string
  shortcut?: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted',
        danger && 'text-destructive hover:bg-destructive/10',
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="flex-1">{label}</span>
      {shortcut && (
        <span className="text-[10px] text-muted-foreground">{shortcut}</span>
      )}
    </button>
  )
}

function ActionIconBtn({
  label,
  active,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  danger?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-7 place-items-center rounded-md transition-colors disabled:opacity-40',
        active
          ? 'bg-primary text-primary-foreground'
          : danger
            ? 'text-destructive hover:bg-destructive/10'
            : 'text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px bg-border" />
}
