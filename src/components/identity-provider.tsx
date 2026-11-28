import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth'

import {
  clearAllSessionParticipants,
  clearScopedHostKeys,
} from '@/lib/host-keys'
import { generateMeetingId, isModernMeetingId } from '@/lib/meeting'
import { clearPrefs, loadPrefs, savePrefs } from '@/lib/prefs'
import {
  AVATAR_COLOR_SWATCHES,
  clearProfile,
  saveProfile,
  type AvailabilityStatus,
  type ProfileRole,
} from '@/lib/profile'
import {
  purgeLegacyUnscopedStorage,
  setActiveStorageUid,
} from '@/lib/storage-scope'
import {
  analyticsPromise,
  auth,
  beginAuthTransition,
  clearCachedClientUid,
  endAuthTransition,
  resetAuthInit,
  resetFirestoreNotice,
} from '@/services/firebase'
import { clearLocalMeetingCaches } from '@/services/firestore-meetings'
import {
  getUserAccountDoc,
  saveUserAccountDoc,
  type AccountRole,
  type FirestoreUserDoc,
} from '@/services/firestore-users'

export type AuthStatus = 'loading' | 'loggedOut' | 'guest' | 'authenticated'
export type SessionRole = 'teacher' | 'student' | 'guest'

export interface LecternUser {
  id: string
  name: string
  email: string | null
  role: SessionRole
  isGuest: boolean
  isAnonymous: boolean
  subjectOrInstitution?: string
  classOrRollNo?: string
  pmi?: string | null
}

export interface RegisterAccountInput {
  role: AccountRole
  fullName: string
  email: string
  password: string
  subjectOrInstitution?: string
  classOrRollNo?: string
}

export interface IdentityState {
  /** Signed-in Teacher, Student, or explicit Guest user; null when logged out. */
  user: LecternUser | null
  /** Explicit session state: loading, loggedOut, guest, or authenticated. */
  authStatus: AuthStatus
  /** Role of current session ('teacher' | 'student' | 'guest') or null when logged out. */
  role: SessionRole | null
  /** True only when explicitly in a Guest session. */
  isGuest: boolean
  /** Firebase UID when signed in (registered or guest), or '' when logged out. */
  clientUid: string
  ready: boolean
  signInAccount: (email: string, password: string) => Promise<LecternUser>
  registerAccount: (input: RegisterAccountInput) => Promise<LecternUser>
  signInAsGuest: (displayNameInput?: string) => Promise<LecternUser>
  renameGuest: (nextName: string) => void
  updateAccountProfile: (patch: {
    displayName?: string
    roleLabel?: ProfileRole
    status?: AvailabilityStatus
    avatarColor?: string
    avatarPhoto?: string | null
    subjectOrInstitution?: string
    classOrRollNo?: string
  }) => Promise<void>
  regeneratePmi: () => Promise<string | null>
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const GUEST_SESSION_KEY = 'lectern-guest-session'

interface GuestSessionRecord {
  uid: string
  displayName: string
  role: 'guest'
  isGuest: true
}

function loadGuestSession(expectedUid?: string): GuestSessionRecord | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(GUEST_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<GuestSessionRecord>
    if (parsed.isGuest !== true || !parsed.uid) return null
    if (expectedUid && parsed.uid !== expectedUid) return null
    return {
      uid: parsed.uid,
      displayName: (parsed.displayName ?? '').trim() || 'Guest',
      role: 'guest',
      isGuest: true,
    }
  } catch {
    return null
  }
}

function saveGuestSession(uid: string, name: string): GuestSessionRecord {
  const rec: GuestSessionRecord = {
    uid,
    displayName: name.trim() || 'Guest',
    role: 'guest',
    isGuest: true,
  }
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(rec))
    } catch {
      // ignore
    }
  }
  return rec
}

function clearGuestSession() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(GUEST_SESSION_KEY)
    sessionStorage.removeItem(GUEST_SESSION_KEY)
  } catch {
    // ignore
  }
}

function profileRoleForAccount(role: AccountRole): ProfileRole {
  return role === 'student' ? 'Student' : 'Teacher'
}

const IdentityContext = createContext<IdentityState | null>(null)

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LecternUser | null>(null)
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading')
  const [clientUid, setClientUid] = useState<string>('')
  const [ready, setReady] = useState(false)
  const lastUidRef = useRef<string | null>(null)
  const pendingGuestNameRef = useRef<string | null>(null)

  const resetAllProfileMemory = useCallback(() => {
    clearLocalMeetingCaches()
    clearAllSessionParticipants()
    purgeLegacyUnscopedStorage()
  }, [])

  const hydrateRegisteredUser = useCallback(
    async (fbUser: FirebaseUser): Promise<LecternUser> => {
      if (lastUidRef.current && lastUidRef.current !== fbUser.uid) {
        resetAllProfileMemory()
      }
      lastUidRef.current = fbUser.uid
      clearGuestSession()
      purgeLegacyUnscopedStorage()
      setActiveStorageUid(fbUser.uid)

      let docData = await getUserAccountDoc(fbUser.uid)

      if (!docData) {
        const fallbackName =
          fbUser.displayName?.trim() ||
          fbUser.email?.split('@')[0] ||
          'Teacher'
        const generatedPmi = generateMeetingId()
        const created: FirestoreUserDoc = {
          uid: fbUser.uid,
          role: 'teacher',
          displayName: fallbackName,
          email: fbUser.email ?? '',
          pmi: generatedPmi,
          status: 'available',
          avatarColor: AVATAR_COLOR_SWATCHES[0].value,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        await saveUserAccountDoc(fbUser.uid, created)
        docData = created
      }

      const effectiveName =
        docData.displayName ||
        fbUser.displayName?.trim() ||
        fbUser.email?.split('@')[0] ||
        (docData.role === 'student' ? 'Student' : 'Teacher')

      let effectivePmi = docData.pmi ?? null
      if (
        docData.role === 'teacher' &&
        (!effectivePmi || !isModernMeetingId(effectivePmi))
      ) {
        effectivePmi = generateMeetingId()
        void saveUserAccountDoc(fbUser.uid, { pmi: effectivePmi })
      }

      saveProfile({
        displayName: effectiveName,
        role: profileRoleForAccount(docData.role),
        status: docData.status ?? 'available',
        avatarColor: docData.avatarColor || AVATAR_COLOR_SWATCHES[0].value,
        pmi: docData.role === 'teacher' ? (effectivePmi ?? '') : '',
        subjectOrInstitution: docData.subjectOrInstitution,
        classOrRollNo: docData.classOrRollNo,
      })

      const mapped: LecternUser = {
        id: fbUser.uid,
        name: effectiveName,
        email: fbUser.email ?? docData.email ?? null,
        role: docData.role,
        isGuest: false,
        isAnonymous: false,
        subjectOrInstitution: docData.subjectOrInstitution,
        classOrRollNo: docData.classOrRollNo,
        pmi: docData.role === 'teacher' ? effectivePmi : null,
      }
      setUser(mapped)
      setClientUid(fbUser.uid)
      setAuthStatus('authenticated')
      resetFirestoreNotice()
      return mapped
    },
    [resetAllProfileMemory],
  )

  const applyLoggedOutState = useCallback(() => {
    lastUidRef.current = null
    setActiveStorageUid(null)
    setUser(null)
    setClientUid('')
    setAuthStatus('loggedOut')
    resetFirestoreNotice()
  }, [])

  const refresh = useCallback(async () => {
    const current = auth.currentUser
    if (!current) {
      applyLoggedOutState()
      return
    }
    if (current.isAnonymous) {
      const guest = loadGuestSession(current.uid)
      if (!guest) {
        applyLoggedOutState()
        return
      }
      lastUidRef.current = current.uid
      setActiveStorageUid(current.uid)
      setClientUid(current.uid)
      setUser({
        id: current.uid,
        name: guest.displayName,
        email: null,
        role: 'guest',
        isGuest: true,
        isAnonymous: true,
        pmi: null,
      })
      setAuthStatus('guest')
      return
    }
    await hydrateRegisteredUser(current)
  }, [applyLoggedOutState, hydrateRegisteredUser])

  const signInAccount = useCallback(
    async (email: string, password: string): Promise<LecternUser> => {
      beginAuthTransition()
      try {
        resetAllProfileMemory()
        const cred = await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        )
        return await hydrateRegisteredUser(cred.user)
      } finally {
        endAuthTransition()
      }
    },
    [hydrateRegisteredUser, resetAllProfileMemory],
  )

  const registerAccount = useCallback(
    async (input: RegisterAccountInput): Promise<LecternUser> => {
      beginAuthTransition()
      try {
        resetAllProfileMemory()
        const cleanName = input.fullName.trim()
        const cleanEmail = input.email.trim()
        const cred = await createUserWithEmailAndPassword(
          auth,
          cleanEmail,
          input.password,
        )
      if (cleanName) {
        await updateProfile(cred.user, { displayName: cleanName })
      }
      lastUidRef.current = cred.user.uid
      clearGuestSession()
      setActiveStorageUid(cred.user.uid)

      const pmi = input.role === 'teacher' ? generateMeetingId() : null
      const now = Date.now()
      const userDoc: FirestoreUserDoc = {
        uid: cred.user.uid,
        role: input.role,
        displayName:
          cleanName || (input.role === 'student' ? 'Student' : 'Teacher'),
        email: cleanEmail,
        subjectOrInstitution:
          input.role === 'teacher'
            ? input.subjectOrInstitution?.trim() || undefined
            : undefined,
        classOrRollNo:
          input.role === 'student'
            ? input.classOrRollNo?.trim() || undefined
            : undefined,
        pmi,
        status: 'available',
        avatarColor: AVATAR_COLOR_SWATCHES[0].value,
        createdAt: now,
        updatedAt: now,
      }
      await saveUserAccountDoc(cred.user.uid, userDoc)

      saveProfile({
        displayName: userDoc.displayName,
        role: profileRoleForAccount(input.role),
        status: 'available',
        avatarColor: AVATAR_COLOR_SWATCHES[0].value,
        avatarPhoto: null,
        pmi: pmi ?? '',
        subjectOrInstitution: userDoc.subjectOrInstitution,
        classOrRollNo: userDoc.classOrRollNo,
      })

      const mapped: LecternUser = {
        id: cred.user.uid,
        name: userDoc.displayName,
        email: cleanEmail,
        role: input.role,
        isGuest: false,
        isAnonymous: false,
        subjectOrInstitution: userDoc.subjectOrInstitution,
        classOrRollNo: userDoc.classOrRollNo,
        pmi,
      }
        setUser(mapped)
        setClientUid(cred.user.uid)
        setAuthStatus('authenticated')
        resetFirestoreNotice()
        return mapped
      } finally {
        endAuthTransition()
      }
    },
    [resetAllProfileMemory],
  )

  /**
   * Fresh Guest session guarantee:
   * Always signs out any stale Firebase session first, purges local caches,
   * creates a brand-new anonymous UID, and starts with 0 classrooms, 0 chats,
   * 0 whiteboards, and 0 recordings.
   */
  const signInAsGuest = useCallback(
    async (displayNameInput?: string): Promise<LecternUser> => {
      const cleanName = (displayNameInput ?? '').trim() || 'Guest'
      pendingGuestNameRef.current = cleanName
      beginAuthTransition()
      try {
        const existingAnon =
          auth.currentUser &&
          auth.currentUser.isAnonymous &&
          !loadGuestSession(auth.currentUser.uid)
            ? auth.currentUser
            : null

        if (!existingAnon) {
          resetAuthInit()
          if (auth.currentUser) {
            try {
              await firebaseSignOut(auth)
            } catch {
              // ignore
            }
          }
        }
        clearGuestSession()
        clearScopedHostKeys(lastUidRef.current)
        resetAllProfileMemory()
        clearProfile()
        clearPrefs()
        if (!existingAnon) {
          clearCachedClientUid()
          setActiveStorageUid(null)
        }

        const fbUser = existingAnon ?? (await signInAnonymously(auth)).user
        lastUidRef.current = fbUser.uid
        setActiveStorageUid(fbUser.uid)

        saveGuestSession(fbUser.uid, cleanName)
        savePrefs({ ...loadPrefs(), name: cleanName })
        saveProfile({
          displayName: cleanName,
          role: 'Participant',
          status: 'available',
          avatarPhoto: null,
          pmi: '',
        })
        const mapped: LecternUser = {
          id: fbUser.uid,
          name: cleanName,
          email: null,
          role: 'guest',
          isGuest: true,
          isAnonymous: true,
          pmi: null,
        }
        setUser(mapped)
        setClientUid(fbUser.uid)
        setAuthStatus('guest')
        resetFirestoreNotice()
        return mapped
      } finally {
        pendingGuestNameRef.current = null
        endAuthTransition()
      }
    },
    [resetAllProfileMemory],
  )

  const renameGuest = useCallback((nextName: string) => {
    const clean = nextName.trim() || 'Guest'
    const uid = auth.currentUser?.uid
    if (uid) saveGuestSession(uid, clean)
    savePrefs({ ...loadPrefs(), name: clean })
    saveProfile({ displayName: clean })
    setUser((prev) => (prev && prev.isGuest ? { ...prev, name: clean } : prev))
  }, [])

  const updateAccountProfile = useCallback(
    async (patch: {
      displayName?: string
      roleLabel?: ProfileRole
      status?: AvailabilityStatus
      avatarColor?: string
      avatarPhoto?: string | null
      subjectOrInstitution?: string
      classOrRollNo?: string
    }) => {
      const profilePatch: Record<string, unknown> = {}
      if (patch.displayName !== undefined) {
        profilePatch.displayName = patch.displayName.trim()
      }
      if (patch.roleLabel !== undefined) profilePatch.role = patch.roleLabel
      if (patch.status !== undefined) profilePatch.status = patch.status
      if (patch.avatarColor !== undefined) {
        profilePatch.avatarColor = patch.avatarColor
      }
      if (patch.avatarPhoto !== undefined) {
        profilePatch.avatarPhoto = patch.avatarPhoto
      }
      if (patch.subjectOrInstitution !== undefined) {
        profilePatch.subjectOrInstitution = patch.subjectOrInstitution
      }
      if (patch.classOrRollNo !== undefined) {
        profilePatch.classOrRollNo = patch.classOrRollNo
      }
      saveProfile(profilePatch)

      const current = auth.currentUser
      if (current && !current.isAnonymous) {
        if (patch.displayName && patch.displayName.trim()) {
          try {
            await updateProfile(current, {
              displayName: patch.displayName.trim(),
            })
          } catch {
            // Non-blocking
          }
        }
        await saveUserAccountDoc(current.uid, {
          ...(patch.displayName !== undefined
            ? { displayName: patch.displayName.trim() }
            : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.avatarColor !== undefined
            ? { avatarColor: patch.avatarColor }
            : {}),
          ...(patch.subjectOrInstitution !== undefined
            ? { subjectOrInstitution: patch.subjectOrInstitution }
            : {}),
          ...(patch.classOrRollNo !== undefined
            ? { classOrRollNo: patch.classOrRollNo }
            : {}),
        })
      }

      setUser((prev) =>
        prev
          ? {
              ...prev,
              name:
                patch.displayName !== undefined
                  ? patch.displayName.trim() || prev.name
                  : prev.name,
              subjectOrInstitution:
                patch.subjectOrInstitution !== undefined
                  ? patch.subjectOrInstitution
                  : prev.subjectOrInstitution,
              classOrRollNo:
                patch.classOrRollNo !== undefined
                  ? patch.classOrRollNo
                  : prev.classOrRollNo,
            }
          : prev,
      )
    },
    [],
  )

  const regeneratePmi = useCallback(async (): Promise<string | null> => {
    if (!user || user.role !== 'teacher') return null
    const nextPmi = generateMeetingId()
    saveProfile({ pmi: nextPmi })
    if (auth.currentUser && !auth.currentUser.isAnonymous) {
      await saveUserAccountDoc(auth.currentUser.uid, { pmi: nextPmi })
    }
    setUser((prev) => (prev ? { ...prev, pmi: nextPmi } : prev))
    return nextPmi
  }, [user])

  const signOut = useCallback(async () => {
    const prevUid = auth.currentUser?.uid ?? lastUidRef.current
    beginAuthTransition()
    try {
      resetAuthInit()
      try {
        await firebaseSignOut(auth)
      } catch {
        // Continue clearing local state even if offline
      }
      clearGuestSession()
      clearScopedHostKeys(prevUid)
      clearProfile()
      clearPrefs()
      clearCachedClientUid()
      resetAllProfileMemory()
      applyLoggedOutState()
    } finally {
      endAuthTransition()
    }
  }, [applyLoggedOutState, resetAllProfileMemory])

  useEffect(() => {
    let active = true
    purgeLegacyUnscopedStorage()
    void analyticsPromise

    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (!active) return
      if (!fbUser) {
        if (pendingGuestNameRef.current !== null) return
        clearGuestSession()
        clearLocalMeetingCaches()
        applyLoggedOutState()
        setReady(true)
        return
      }
      if (fbUser.isAnonymous) {
        const pendingName = pendingGuestNameRef.current
        const guest =
          loadGuestSession(fbUser.uid) ??
          (pendingName !== null
            ? saveGuestSession(fbUser.uid, pendingName)
            : null)
        if (guest) {
          if (lastUidRef.current && lastUidRef.current !== fbUser.uid) {
            clearLocalMeetingCaches()
          }
          lastUidRef.current = fbUser.uid
          setActiveStorageUid(fbUser.uid)
          setClientUid(fbUser.uid)
          setUser({
            id: fbUser.uid,
            name: guest.displayName,
            email: null,
            role: 'guest',
            isGuest: true,
            isAnonymous: true,
            pmi: null,
          })
          setAuthStatus('guest')
        } else {
          // Unconfirmed or stale anonymous session — treat as clean logged out
          clearGuestSession()
          clearLocalMeetingCaches()
          applyLoggedOutState()
        }
        setReady(true)
        return
      }
      void hydrateRegisteredUser(fbUser).finally(() => {
        if (active) setReady(true)
      })
    })

    return () => {
      active = false
      unsub()
    }
  }, [applyLoggedOutState, hydrateRegisteredUser])

  return (
    <IdentityContext.Provider
      value={{
        user,
        authStatus,
        role: user?.role ?? null,
        isGuest: user?.isGuest ?? false,
        clientUid,
        ready,
        signInAccount,
        registerAccount,
        signInAsGuest,
        renameGuest,
        updateAccountProfile,
        regeneratePmi,
        refresh,
        signOut,
      }}
    >
      {children}
    </IdentityContext.Provider>
  )
}

export function useIdentity() {
  const state = useContext(IdentityContext)
  if (!state) throw new Error('IdentityProvider is required')
  return state
}

export function displayName(user: LecternUser | null) {
  if (!user) return ''
  return user.name || user.email?.split('@')[0] || ''
}
