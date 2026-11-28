// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { ControlBar } from '@/components/meeting/control-bar'
import {
  toggleDocumentFullscreen,
  useFullscreenContainer,
} from './use-fullscreen-container'

function setMockFullscreenElement(el: HTMLElement | null) {
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    value: el,
  })
}

function FullscreenProbe() {
  const container = useFullscreenContainer()
  return (
    <div data-testid="fs-state">{container ? container.tagName : 'none'}</div>
  )
}

describe('useFullscreenContainer & fullscreen More menu', () => {
  afterEach(() => {
    setMockFullscreenElement(null)
    vi.restoreAllMocks()
  })

  it('tracks fullscreenchange and webkitfullscreenchange reactively', () => {
    render(<FullscreenProbe />)
    expect(screen.getByTestId('fs-state').textContent).toBe('none')

    act(() => {
      setMockFullscreenElement(document.documentElement)
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(screen.getByTestId('fs-state').textContent).toBe('HTML')

    act(() => {
      setMockFullscreenElement(null)
      document.dispatchEvent(new Event('webkitfullscreenchange'))
    })
    expect(screen.getByTestId('fs-state').textContent).toBe('none')
  })

  it('toggles fullscreen on document.documentElement and exits cleanly', async () => {
    const req = vi.fn(async () => {
      setMockFullscreenElement(document.documentElement)
    })
    const exit = vi.fn(async () => {
      setMockFullscreenElement(null)
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: req,
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exit,
    })

    const entered = await toggleDocumentFullscreen()
    expect(entered).toBe(true)
    expect(req).toHaveBeenCalledTimes(1)

    const exited = await toggleDocumentFullscreen()
    expect(exited).toBe(true)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('portals More menu into the fullscreen container and executes every More option', () => {
    const fsHost = document.createElement('div')
    document.body.appendChild(fsHost)
    setMockFullscreenElement(fsHost)

    const handlers = {
      onPanel: vi.fn(),
      onOpenBreakout: vi.fn(),
      onToggleCaptions: vi.fn(),
      onCopyLink: vi.fn(),
      onToggleBlur: vi.fn(),
      onToggleView: vi.fn(),
      onFullscreen: vi.fn(),
      onSettings: vi.fn(),
      onShortcuts: vi.fn(),
      onToggleRecording: vi.fn(),
      onMuteAll: vi.fn(),
      onToggleLock: vi.fn(),
      onEnd: vi.fn(),
    }

    render(
      <TooltipProvider>
        <ControlBar
          title="Physics 101"
          duration="01:12"
          participantCount={2}
          micOn
          camOn
          blurOn={false}
          sharing={false}
          shareSupported
          canShare
          whiteboardOpen={false}
          canWhiteboard
          handRaised={false}
          recording={false}
          recordingSupported
          captionsOn={false}
          captionsSupported
          locked={false}
          panel={null}
          unread={0}
          peopleBadge={0}
          view="gallery"
          isModerator
          isHost
          isFullscreen
          portalContainer={fsHost}
          onToggleMic={() => {}}
          onToggleCam={() => {}}
          onToggleShare={() => {}}
          onToggleWhiteboard={() => {}}
          onToggleHand={() => {}}
          onReaction={() => {}}
          onLeave={() => {}}
          {...handlers}
        />
      </TooltipProvider>,
    )

    const openMore = () => {
      const btn = screen.getByLabelText('More options')
      fireEvent.pointerDown(btn, { button: 0, ctrlKey: false })
      fireEvent.click(btn)
    }

    openMore()
    const exitFsItem = screen.getByRole('menuitem', {
      name: /Exit full screen/i,
    })
    // Verify Radix Portal rendered inside the active fullscreen container!
    expect(fsHost.contains(exitFsItem)).toBe(true)
    fireEvent.click(exitFsItem)
    expect(handlers.onFullscreen).toHaveBeenCalledTimes(1)

    const cases: Array<[RegExp, () => void]> = [
      [/Live polls/i, () => expect(handlers.onPanel).toHaveBeenCalledWith('polls')],
      [/Shared class notes/i, () => expect(handlers.onPanel).toHaveBeenCalledWith('notes')],
      [/Breakout rooms/i, () => expect(handlers.onOpenBreakout).toHaveBeenCalledTimes(1)],
      [/Live captions/i, () => expect(handlers.onToggleCaptions).toHaveBeenCalledTimes(1)],
      [/Meeting details/i, () => expect(handlers.onPanel).toHaveBeenCalledWith('info')],
      [/Copy invite link/i, () => expect(handlers.onCopyLink).toHaveBeenCalledTimes(1)],
      [/Enable background blur/i, () => expect(handlers.onToggleBlur).toHaveBeenCalledTimes(1)],
      [/Speaker view/i, () => expect(handlers.onToggleView).toHaveBeenCalledTimes(1)],
      [/Audio and video settings/i, () => expect(handlers.onSettings).toHaveBeenCalledTimes(1)],
      [/Keyboard shortcuts/i, () => expect(handlers.onShortcuts).toHaveBeenCalledTimes(1)],
      [/Record locally/i, () => expect(handlers.onToggleRecording).toHaveBeenCalledTimes(1)],
      [/Mute all students/i, () => expect(handlers.onMuteAll).toHaveBeenCalledTimes(1)],
      [/Lock meeting/i, () => expect(handlers.onToggleLock).toHaveBeenCalledTimes(1)],
      [/End class for everyone/i, () => expect(handlers.onEnd).toHaveBeenCalledTimes(1)],
    ]

    for (const [pattern, verify] of cases) {
      openMore()
      const item = screen.getByRole('menuitem', { name: pattern })
      expect(fsHost.contains(item)).toBe(true)
      fireEvent.click(item)
      verify()
    }

    document.body.removeChild(fsHost)
  })
})
