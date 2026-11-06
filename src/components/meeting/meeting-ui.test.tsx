import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { ControlBar } from './control-bar'
import { SidePanel } from './side-panel'
import { Stage } from './stage'
import { Whiteboard } from './whiteboard/whiteboard'
import { applyOp, hitStroke, newPage, type Stroke } from './whiteboard/engine'
import type { TileModel } from './types'

const tiles: TileModel[] = [
  {
    id: 'me',
    name: 'Teacher',
    role: 'host',
    isLocal: true,
    micOn: true,
    camOn: false,
    speaking: false,
    handRaised: false,
    quality: 'good',
    sharing: false,
  },
  {
    id: 'p1',
    name: 'Priya',
    role: 'student',
    isLocal: false,
    micOn: false,
    camOn: false,
    speaking: true,
    handRaised: true,
    quality: 'fair',
    sharing: false,
  },
  {
    id: 'p2',
    name: 'Mateo',
    role: 'cohost',
    isLocal: false,
    micOn: true,
    camOn: false,
    speaking: false,
    handRaised: false,
    quality: 'poor',
    sharing: true,
  },
]

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('meeting UI', () => {
  it('renders the stage in gallery and speaker views', () => {
    const { rerender } = wrap(
      <Stage
        tiles={tiles}
        renderVideo={() => null}
        presentation={null}
        view="gallery"
        pinnedId={null}
        onPin={() => {}}
        activeSpeakerId="p1"
      />,
    )
    expect(screen.getByText('Priya')).toBeInTheDocument()
    expect(screen.getByLabelText('Hand raised')).toBeInTheDocument()
    rerender(
      <TooltipProvider>
        <Stage
          tiles={tiles}
          renderVideo={() => null}
          presentation={null}
          view="speaker"
          pinnedId="p2"
          onPin={() => {}}
          activeSpeakerId="p1"
        />
      </TooltipProvider>,
    )
    expect(screen.getByLabelText('Other participants')).toBeInTheDocument()
    expect(screen.getByLabelText('Pinned')).toBeInTheDocument()
  })

  it('fires control bar actions', () => {
    const onToggleMic = vi.fn()
    const onLeave = vi.fn()
    wrap(
      <ControlBar
        title="Algebra"
        duration="00:10"
        participantCount={3}
        micOn
        camOn={false}
        sharing={false}
        shareSupported
        canShare
        whiteboardOpen={false}
        canWhiteboard
        handRaised={false}
        recording={false}
        recordingSupported={false}
        locked={false}
        panel={null}
        unread={2}
        peopleBadge={1}
        view="gallery"
        isModerator
        isHost
        onToggleMic={onToggleMic}
        onToggleCam={() => {}}
        onToggleShare={() => {}}
        onToggleWhiteboard={() => {}}
        onToggleHand={() => {}}
        onPanel={() => {}}
        onReaction={() => {}}
        onToggleView={() => {}}
        onFullscreen={() => {}}
        onSettings={() => {}}
        onShortcuts={() => {}}
        onToggleRecording={() => {}}
        onToggleLock={() => {}}
        onMuteAll={() => {}}
        onCopyLink={() => {}}
        onLeave={onLeave}
        onEnd={() => {}}
      />,
    )
    fireEvent.click(screen.getByLabelText('Mute'))
    expect(onToggleMic).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText('Leave class'))
    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('sends chat messages and shows the waiting room', () => {
    const onSend = vi.fn()
    const onAdmit = vi.fn()
    const { rerender } = wrap(
      <SidePanel
        tab="chat"
        onTab={() => {}}
        onClose={() => {}}
        localId="me"
        isModerator
        isHost
        messages={[
          {
            id: 'a',
            authorId: 'p1',
            authorName: 'Priya',
            text: 'Hello!',
            at: Date.now(),
            kind: 'message',
          },
        ]}
        onSend={onSend}
        canChat
        canPrivate
        tiles={tiles}
        waiting={[
          {
            identity: 'w1',
            name: 'Sofia',
            requestedAt: new Date().toISOString(),
          },
        ]}
        onAdmit={onAdmit}
        onAdmitAll={() => {}}
        onModerate={() => {}}
        onMuteAll={() => {}}
        settings={{
          locked: false,
          waitingRoom: true,
          allowStudentScreenShare: false,
          allowStudentDraw: false,
          allowChat: true,
          allowPrivateChat: true,
        }}
        onSettings={() => {}}
        meeting={{
          meetingId: 'abc-defg-hij',
          title: 'Algebra',
          hostName: 'Teacher',
          hasPasscode: true,
          scheduledAt: null,
          durationMin: 60,
          startedAt: null,
          endedAt: null,
          locked: false,
          waitingRoom: true,
          allowStudentScreenShare: false,
          allowStudentDraw: false,
          allowChat: true,
          allowPrivateChat: true,
        }}
        passcode="123456"
        duration="00:10"
        quality="good"
        realtime
      />,
    )
    expect(screen.getByText('Hello!')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Welcome' },
    })
    fireEvent.click(screen.getByLabelText('Send'))
    expect(onSend).toHaveBeenCalledWith('Welcome', null, false)

    rerender(
      <TooltipProvider>
        <SidePanel
          tab="people"
          onTab={() => {}}
          onClose={() => {}}
          localId="me"
          isModerator
          isHost
          messages={[]}
          onSend={onSend}
          canChat
          canPrivate
          tiles={tiles}
          waiting={[
            {
              identity: 'w1',
              name: 'Sofia',
              requestedAt: new Date().toISOString(),
            },
          ]}
          onAdmit={onAdmit}
          onAdmitAll={() => {}}
          onModerate={() => {}}
          onMuteAll={() => {}}
          settings={{
            locked: false,
            waitingRoom: true,
            allowStudentScreenShare: false,
            allowStudentDraw: false,
            allowChat: true,
            allowPrivateChat: true,
          }}
          onSettings={() => {}}
          meeting={{
            meetingId: 'abc-defg-hij',
            title: 'Algebra',
            hostName: 'Teacher',
            hasPasscode: true,
            scheduledAt: null,
            durationMin: 60,
            startedAt: null,
            endedAt: null,
            locked: false,
            waitingRoom: true,
            allowStudentScreenShare: false,
            allowStudentDraw: false,
            allowChat: true,
            allowPrivateChat: true,
          }}
          passcode="123456"
          duration="00:10"
          quality="good"
          realtime
        />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getByText('Admit'))
    expect(onAdmit).toHaveBeenCalledWith('w1', true)
    expect(screen.getByText('Waiting room (1)')).toBeInTheDocument()
  })

  it('renders the whiteboard toolbar for teachers and view-only for students', () => {
    const { rerender } = wrap(<Whiteboard canDraw isTeacher author="me" />)
    expect(screen.getByLabelText('Pen')).toBeInTheDocument()
    expect(screen.getByLabelText('Add page')).toBeInTheDocument()
    rerender(
      <TooltipProvider>
        <Whiteboard canDraw={false} isTeacher={false} author="p1" />
      </TooltipProvider>,
    )
    expect(screen.getByText(/View only/)).toBeInTheDocument()
  })
})

describe('whiteboard engine', () => {
  it('applies add, remove, clear and page ops immutably', () => {
    const page = newPage()
    const stroke: Stroke = {
      id: 's1',
      tool: 'pen',
      color: '#000',
      size: 4,
      points: [0, 0, 10, 10],
      author: 'me',
    }
    const added = applyOp([page], { type: 'add', page: page.id, stroke })
    expect(added[0].strokes).toHaveLength(1)
    expect(page.strokes).toHaveLength(0)
    const again = applyOp(added, { type: 'add', page: page.id, stroke })
    expect(again[0].strokes).toHaveLength(1)
    const removed = applyOp(added, {
      type: 'remove',
      page: page.id,
      ids: ['s1'],
    })
    expect(removed[0].strokes).toHaveLength(0)
    const second = newPage()
    const withPage = applyOp(added, {
      type: 'page-add',
      page: second,
      after: page.id,
    })
    expect(withPage).toHaveLength(2)
    expect(
      applyOp(withPage, { type: 'page-remove', page: second.id }),
    ).toHaveLength(1)
    expect(
      applyOp([page], { type: 'page-remove', page: page.id }),
    ).toHaveLength(1)
    expect(
      applyOp(added, { type: 'clear', page: page.id })[0].strokes,
    ).toHaveLength(0)
  })

  it('hit-tests strokes for the eraser', () => {
    const line: Stroke = {
      id: 'l',
      tool: 'line',
      color: '#000',
      size: 2,
      points: [0, 0, 100, 0],
      author: 'me',
    }
    expect(hitStroke(line, 50, 2, 4)).toBe(true)
    expect(hitStroke(line, 50, 40, 4)).toBe(false)
    const rect: Stroke = {
      id: 'r',
      tool: 'rect',
      color: '#000',
      size: 2,
      points: [10, 10, 50, 50],
      author: 'me',
    }
    expect(hitStroke(rect, 30, 30, 2)).toBe(true)
    expect(hitStroke(rect, 80, 80, 2)).toBe(false)
  })
})
