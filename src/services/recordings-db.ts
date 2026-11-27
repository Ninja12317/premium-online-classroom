/**
 * Local IndexedDB storage for class recordings captured via MediaRecorder,
 * strictly isolated per Firebase UID (`ownerUid`) so switching accounts or
 * entering a fresh Guest session never leaks another profile's recordings.
 */

import { getActiveStorageUid } from '@/lib/storage-scope'

export interface StoredRecording {
  id: string
  ownerUid: string
  meetingId: string
  title: string
  createdAt: number
  durationSec: number
  sizeBytes: number
  mimeType: string
  blob: Blob
}

export type RecordingMeta = Omit<StoredRecording, 'blob'>

const DB_NAME = 'lectern-recordings-db'
const STORE_NAME = 'recordings'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open DB'))
  })
}

export async function saveRecording(
  rec: Omit<StoredRecording, 'ownerUid'> & { ownerUid?: string },
): Promise<void> {
  const ownerUid = rec.ownerUid || getActiveStorageUid() || ''
  if (!ownerUid) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ ...rec, ownerUid })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save recording'))
  })
  db.close()
}

/** Lists only recordings belonging strictly to `ownerUid` (returns [] when logged out). */
export async function listRecordings(
  ownerUid?: string | null,
): Promise<StoredRecording[]> {
  const uid = ownerUid !== undefined ? ownerUid : getActiveStorageUid()
  if (!uid) return []
  try {
    const db = await openDb()
    const rows = await new Promise<StoredRecording[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).getAll()
      req.onsuccess = () => resolve((req.result as StoredRecording[]) ?? [])
      req.onerror = () => reject(req.error)
    })
    db.close()
    return rows
      .filter((r) => Boolean(r.ownerUid) && r.ownerUid === uid)
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export async function renameRecording(
  id: string,
  title: string,
  ownerUid?: string | null,
): Promise<void> {
  const uid = ownerUid !== undefined ? ownerUid : getActiveStorageUid()
  if (!uid) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const row = getReq.result as StoredRecording | undefined
      if (row && row.ownerUid === uid) {
        row.title = title
        store.put(row)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function deleteRecording(
  id: string,
  ownerUid?: string | null,
): Promise<void> {
  const uid = ownerUid !== undefined ? ownerUid : getActiveStorageUid()
  if (!uid) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const row = getReq.result as StoredRecording | undefined
      if (!row || row.ownerUid === uid) {
        store.delete(id)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
