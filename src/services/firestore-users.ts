import { doc, getDoc, setDoc } from 'firebase/firestore'

import { generateMeetingId, isModernMeetingId } from '@/lib/meeting'
import type { AvailabilityStatus } from '@/lib/profile'
import {
  db,
  isPermissionDeniedError,
  reportFirestorePermissionError,
} from '@/services/firebase'

export type AccountRole = 'teacher' | 'student'

export interface FirestoreUserDoc {
  uid: string
  role: AccountRole
  displayName: string
  email: string
  subjectOrInstitution?: string
  classOrRollNo?: string
  pmi?: string | null
  status?: AvailabilityStatus
  avatarColor?: string
  createdAt: number
  updatedAt: number
}

/**
 * Reads `users/{uid}` from Cloud Firestore. Auto-migrates any legacy
 * letter-only PMI on teacher accounts to the modern `LEC-XXXX-XXXX` format.
 */
export async function getUserAccountDoc(
  uid: string,
): Promise<FirestoreUserDoc | null> {
  if (!uid) return null
  try {
    const ref = doc(db, 'users', uid)
    const snap = await getDoc(ref)
    if (!snap.exists()) return null
    const raw = snap.data() as Partial<FirestoreUserDoc>
    const role: AccountRole = raw.role === 'student' ? 'student' : 'teacher'
    let pmi = typeof raw.pmi === 'string' ? raw.pmi : null

    // Auto-migrate legacy letter-only PMI (or missing PMI) on teacher accounts
    if (role === 'teacher' && (!pmi || !isModernMeetingId(pmi))) {
      pmi = generateMeetingId()
      void setDoc(
        ref,
        { pmi, updatedAt: Date.now() },
        { merge: true },
      ).catch(() => {})
    }

    return {
      uid,
      role,
      displayName: String(raw.displayName ?? '').trim(),
      email: String(raw.email ?? '').trim(),
      subjectOrInstitution:
        typeof raw.subjectOrInstitution === 'string'
          ? raw.subjectOrInstitution
          : undefined,
      classOrRollNo:
        typeof raw.classOrRollNo === 'string' ? raw.classOrRollNo : undefined,
      pmi,
      status: raw.status,
      avatarColor:
        typeof raw.avatarColor === 'string' ? raw.avatarColor : undefined,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    }
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      reportFirestorePermissionError(`users/${uid}`, err)
    }
    return null
  }
}

/** Persists or merges a registered user's account profile into `users/{uid}`. */
export async function saveUserAccountDoc(
  uid: string,
  data: Partial<FirestoreUserDoc>,
): Promise<void> {
  if (!uid) return
  try {
    const clean: Record<string, unknown> = {
      uid,
      updatedAt: Date.now(),
    }
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) clean[k] = v
    }
    await setDoc(doc(db, 'users', uid), clean, { merge: true })
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      reportFirestorePermissionError(`users/${uid}`, err)
    }
  }
}
