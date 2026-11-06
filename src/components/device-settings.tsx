import { Camera, Mic, Volume2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DeviceLists } from '@/lib/use-local-media'

export interface DeviceSelection {
  cameraId?: string
  micId?: string
  speakerId?: string
}

function labelFor(device: MediaDeviceInfo, index: number, kind: string) {
  return device.label || `${kind} ${index + 1}`
}

/** Camera, microphone and speaker pickers shared by the lobby and the meeting. */
export function DeviceSettings({
  devices,
  value,
  onChange,
  idPrefix = 'device',
}: {
  devices: DeviceLists
  value: DeviceSelection
  onChange: (next: DeviceSelection) => void
  idPrefix?: string
}) {
  const speakersSupported =
    typeof HTMLMediaElement !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype
  const rows: {
    key: keyof DeviceSelection
    label: string
    icon: typeof Mic
    list: MediaDeviceInfo[]
    kind: string
    disabled?: boolean
    note?: string
  }[] = [
    {
      key: 'cameraId',
      label: 'Camera',
      icon: Camera,
      list: devices.cameras,
      kind: 'Camera',
    },
    {
      key: 'micId',
      label: 'Microphone',
      icon: Mic,
      list: devices.microphones,
      kind: 'Microphone',
    },
    {
      key: 'speakerId',
      label: 'Speaker',
      icon: Volume2,
      list: devices.speakers,
      kind: 'Speaker',
      disabled: !speakersSupported,
      note: speakersSupported
        ? undefined
        : 'Speaker selection is handled by your system on this browser.',
    },
  ]
  return (
    <div className="grid gap-4">
      {rows.map((row) => {
        const Icon = row.icon
        const id = `${idPrefix}-${row.key}`
        const hasList = row.list.length > 0
        return (
          <div key={row.key} className="space-y-1.5">
            <Label htmlFor={id} className="flex items-center gap-1.5">
              <Icon className="size-3.5 text-muted-foreground" /> {row.label}
            </Label>
            <Select
              value={
                value[row.key] ??
                (hasList ? row.list[0].deviceId || 'default' : 'none')
              }
              onValueChange={(v) =>
                onChange({
                  ...value,
                  [row.key]: v === 'default' ? undefined : v,
                })
              }
              disabled={row.disabled || !hasList}
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue
                  placeholder={
                    hasList
                      ? `Choose ${row.label.toLowerCase()}`
                      : 'No device found'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {hasList ? (
                  row.list.map((d, i) => (
                    <SelectItem
                      key={d.deviceId || i}
                      value={d.deviceId || 'default'}
                    >
                      {labelFor(d, i, row.kind)}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="none" disabled>
                    No device found
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {row.note && (
              <p className="text-xs text-muted-foreground">{row.note}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
