import { useRef, useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import {
  BookOpen,
  Camera,
  Check,
  GraduationCap,
  LogIn,
  LogOut,
  MicOff,
  Moon,
  Pencil,
  Settings,
  Sun,
  Trash2,
  UserRound,
  VideoOff,
} from 'lucide-react'
import { toast } from 'sonner'

import { AuthModal, type AuthModalMode } from '@/components/auth-modal'
import { AvatarBubble } from '@/components/avatar-bubble'
import { BackButton } from '@/components/back-button'
import { useIdentity } from '@/components/identity-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { patchStoredPrefs, useJoinPrefs } from '@/lib/prefs'
import {
  AVAILABILITY_OPTIONS,
  AVATAR_COLOR_SWATCHES,
  resizeAvatarFile,
  statusMeta,
  useUserProfile,
} from '@/lib/profile'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

function AppearanceRow() {
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-xs font-medium text-foreground">
        {isDark ? (
          <Moon className="size-3.5 text-muted-foreground" />
        ) : (
          <Sun className="size-3.5 text-muted-foreground" />
        )}
        Appearance
      </span>
      <div className="inline-flex items-center rounded-lg border bg-muted/60 p-0.5">
        <button
          type="button"
          onClick={() => setTheme('light')}
          aria-pressed={!isDark}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
            !isDark
              ? 'bg-card text-foreground shadow-2xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Sun className="size-3" /> Light
        </button>
        <button
          type="button"
          onClick={() => setTheme('dark')}
          aria-pressed={isDark}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
            isDark
              ? 'bg-card text-foreground shadow-2xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Moon className="size-3" /> Dark
        </button>
      </div>
    </div>
  )
}

export function ProfileMenu({
  onOpenSettings,
}: {
  onOpenSettings?: () => void
}) {
  const {
    user,
    authStatus,
    isGuest,
    renameGuest,
    updateAccountProfile,
    signOut: doSignOut,
  } = useIdentity()
  const router = useRouter()
  const navigate = useNavigate()
  const profile = useUserProfile()
  const prefs = useJoinPrefs()

  const [open, setOpen] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('signin')
  const [editOpen, setEditOpen] = useState(false)

  // Quick guest rename state
  const [renamingGuest, setRenamingGuest] = useState(false)
  const [guestNameDraft, setGuestNameDraft] = useState('')

  // Edit profile modal draft state (Teacher / Student)
  const [draftName, setDraftName] = useState('')
  const [draftExtra, setDraftExtra] = useState('')
  const [draftColor, setDraftColor] = useState(AVATAR_COLOR_SWATCHES[0].value)
  const [draftPhoto, setDraftPhoto] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function openAuth(mode: AuthModalMode) {
    setOpen(false)
    setAuthModalMode(mode)
    setAuthModalOpen(true)
  }

  async function handleSignOut(guestExit = false) {
    setOpen(false)
    setRenamingGuest(false)
    try {
      await doSignOut()
      await router.invalidate()
      toast.success(guestExit ? 'Exited guest session' : 'Signed out')
    } catch {
      toast.error('Could not sign out. Try again.')
    }
  }

  // -------------------------------------------------------------------------
  // 1. LOGGED-OUT TOP-RIGHT CORNER (no stale avatar, no stale name/status)
  // -------------------------------------------------------------------------
  if (authStatus === 'loggedOut' || !user) {
    return (
      <>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-1 h-9 gap-1.5 rounded-full border-border/80 bg-card/90 px-3 text-xs font-medium text-foreground shadow-2xs hover:bg-muted/70"
            >
              <UserRound className="size-4 text-primary" />
              <span>Sign In</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-[min(18.5rem,calc(100vw-1.5rem))] rounded-2xl border-border/80 bg-popover p-0 text-popover-foreground shadow-xl"
          >
            <div className="p-2">
              <button
                type="button"
                onClick={() => openAuth('signin')}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <LogIn className="size-4 text-primary" />
                Sign In
              </button>
              <button
                type="button"
                onClick={() => openAuth('teacher')}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <GraduationCap className="size-4 text-primary" />
                Create Teacher Account
              </button>
              <button
                type="button"
                onClick={() => openAuth('student')}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <BookOpen className="size-4 text-primary" />
                Create Student Account
              </button>
              <Separator className="my-1.5" />
              <button
                type="button"
                onClick={() => openAuth('guest')}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <UserRound className="size-4 text-muted-foreground" />
                Continue as Guest
              </button>
            </div>
            <Separator />
            <div className="px-4 py-3">
              <AppearanceRow />
            </div>
          </PopoverContent>
        </Popover>

        <AuthModal
          open={authModalOpen}
          onOpenChange={setAuthModalOpen}
          initialMode={authModalMode}
        />
      </>
    )
  }

  // -------------------------------------------------------------------------
  // 2. GUEST-MODE TOP-RIGHT CORNER DROPDOWN
  // -------------------------------------------------------------------------
  if (authStatus === 'guest' || isGuest) {
    const guestLabel = user.name || 'Guest'

    function submitGuestRename(e: React.FormEvent) {
      e.preventDefault()
      renameGuest(guestNameDraft)
      setRenamingGuest(false)
      toast.success('Display name updated')
    }

    return (
      <>
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) setRenamingGuest(false)
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Guest menu for ${guestLabel}`}
              className="ml-1 inline-flex h-9 items-center gap-2 rounded-full border border-border/80 bg-card/90 py-1 pl-1 pr-2.5 text-left text-sm text-foreground shadow-2xs transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <AvatarBubble
                name={guestLabel}
                seed={user.id}
                className="size-7 text-[11px]"
              />
              <span className="hidden max-w-28 truncate text-xs font-medium sm:inline">
                {guestLabel}
              </span>
              <Badge
                variant="secondary"
                className="hidden rounded-md px-1.5 py-0 text-[10px] font-medium md:inline-flex"
              >
                Guest
              </Badge>
            </button>
          </PopoverTrigger>

          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-[min(19.5rem,calc(100vw-1.5rem))] rounded-2xl border-border/80 bg-popover p-0 text-popover-foreground shadow-xl"
          >
            <div className="p-4 pb-3">
              <div className="flex items-start gap-3">
                <AvatarBubble
                  name={guestLabel}
                  seed={user.id}
                  className="size-10 text-sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-display text-sm font-semibold text-foreground">
                      {guestLabel}
                    </p>
                    <Badge
                      variant="secondary"
                      className="shrink-0 rounded-md px-1.5 py-0 text-[10px] font-medium"
                    >
                      Guest
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Temporary guest session
                  </p>
                </div>
              </div>

              {renamingGuest ? (
                <form
                  onSubmit={submitGuestRename}
                  className="mt-3 flex items-center gap-1.5"
                >
                  <Input
                    autoFocus
                    value={guestNameDraft}
                    onChange={(e) => setGuestNameDraft(e.target.value)}
                    placeholder="Display name"
                    maxLength={60}
                    className="h-8 text-xs"
                  />
                  <Button type="submit" size="xs">
                    Save
                  </Button>
                </form>
              ) : (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setGuestNameDraft(guestLabel)
                    setRenamingGuest(true)
                  }}
                  className="mt-3 w-full gap-1.5 rounded-xl"
                >
                  <Pencil className="size-3" /> Rename display name
                </Button>
              )}
            </div>

            <Separator />

            <div className="px-4 py-3">
              <AppearanceRow />
            </div>

            <Separator />

            <div className="flex flex-col gap-1 p-2">
              <button
                type="button"
                onClick={() => openAuth('signin')}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <LogIn className="size-4 text-primary" />
                Sign In / Create Account
              </button>
              <button
                type="button"
                onClick={() => void handleSignOut(true)}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                <LogOut className="size-4" />
                Exit Guest Session
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <AuthModal
          open={authModalOpen}
          onOpenChange={setAuthModalOpen}
          initialMode={authModalMode}
        />
      </>
    )
  }

  // -------------------------------------------------------------------------
  // 3. LOGGED-IN (TEACHER / STUDENT) PROFILE DROPDOWN (NO PMI HERE)
  // -------------------------------------------------------------------------
  const effectiveName = user.name || profile.displayName || 'User'
  const roleBadge = user.role === 'student' ? 'Student' : 'Teacher'
  const currentStatus = statusMeta(profile.status)

  function openEditModal() {
    setDraftName(effectiveName)
    setDraftExtra(
      user?.role === 'student'
        ? (user.classOrRollNo ?? profile.classOrRollNo ?? '')
        : (user?.subjectOrInstitution ?? profile.subjectOrInstitution ?? ''),
    )
    setDraftColor(profile.avatarColor || AVATAR_COLOR_SWATCHES[0].value)
    setDraftPhoto(profile.avatarPhoto)
    setOpen(false)
    setEditOpen(true)
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (savingProfile) return
    setSavingProfile(true)
    try {
      const cleanName = draftName.trim() || roleBadge
      await updateAccountProfile({
        displayName: cleanName,
        avatarColor: draftColor,
        avatarPhoto: draftPhoto,
        ...(user?.role === 'student'
          ? { classOrRollNo: draftExtra.trim() || undefined }
          : { subjectOrInstitution: draftExtra.trim() || undefined }),
      })
      toast.success('Profile updated')
      setEditOpen(false)
    } finally {
      setSavingProfile(false)
    }
  }

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image file.')
      return
    }
    setUploadingPhoto(true)
    try {
      const dataUrl = await resizeAvatarFile(file)
      setDraftPhoto(dataUrl)
    } catch {
      toast.error('Could not load that image. Try another photo.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  function handleOpenAllSettings() {
    setOpen(false)
    if (onOpenSettings) {
      onOpenSettings()
    } else {
      try {
        sessionStorage.setItem('lectern-open-tab', 'settings')
      } catch {
        // ignore
      }
      void navigate({ to: '/' })
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Profile menu for ${effectiveName} (${currentStatus.label})`}
            className="ml-1 inline-flex h-9 items-center gap-2 rounded-full border border-border/80 bg-card/90 py-1 pl-1 pr-2 text-left text-sm text-foreground shadow-2xs transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:pr-3"
          >
            <span className="relative inline-flex shrink-0">
              <AvatarBubble
                name={effectiveName}
                color={profile.avatarColor}
                photo={profile.avatarPhoto}
                className="size-7 text-[11px]"
              />
              <span
                aria-hidden
                className={cn(
                  'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card',
                  currentStatus.dotClass,
                )}
              />
            </span>
            <span className="hidden max-w-28 truncate text-xs font-medium sm:inline lg:max-w-32">
              {effectiveName}
            </span>
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[min(20.5rem,calc(100vw-1.5rem))] rounded-2xl border-border/80 bg-popover p-0 text-popover-foreground shadow-xl"
        >
          {/* Profile Header */}
          <div className="flex items-start gap-3 p-4 pb-3">
            <div className="relative shrink-0">
              <AvatarBubble
                name={effectiveName}
                color={profile.avatarColor}
                photo={profile.avatarPhoto}
                className="size-11 text-sm"
              />
              <span
                aria-label={currentStatus.label}
                className={cn(
                  'absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-popover',
                  currentStatus.dotClass,
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate font-display text-sm font-semibold text-foreground">
                  {effectiveName}
                </p>
                <Badge
                  variant="secondary"
                  className="shrink-0 rounded-md px-1.5 py-0 text-[10px] font-medium"
                >
                  {roleBadge}
                </Badge>
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    currentStatus.dotClass,
                  )}
                />
                <span className="truncate">
                  {user.email ?? currentStatus.label}
                </span>
              </p>
            </div>
          </div>

          <div className="px-4 pb-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openEditModal}
              className="h-8 w-full justify-center gap-1.5 rounded-xl text-xs"
            >
              <Pencil className="size-3.5" /> Edit profile & avatar
            </Button>
          </div>

          <Separator />

          {/* Availability Status Picker */}
          <div className="px-4 py-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Status
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {AVAILABILITY_OPTIONS.map((opt) => {
                const active = profile.status === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => void updateAccountProfile({ status: opt.id })}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
                      active
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        opt.dotClass,
                      )}
                    />
                    <span className="truncate">{opt.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <Separator />

          {/* Quick Preferences */}
          <div className="space-y-2.5 px-4 py-3">
            <AppearanceRow />

            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor="profile-mute-join"
                className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground"
              >
                <MicOff className="size-3.5 text-muted-foreground" />
                Mute mic on join
              </Label>
              <Switch
                id="profile-mute-join"
                checked={!prefs.micOn}
                onCheckedChange={(muted) =>
                  patchStoredPrefs({ micOn: !muted })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor="profile-cam-join"
                className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground"
              >
                <VideoOff className="size-3.5 text-muted-foreground" />
                Turn off camera on join
              </Label>
              <Switch
                id="profile-cam-join"
                checked={!prefs.camOn}
                onCheckedChange={(off) => patchStoredPrefs({ camOn: !off })}
              />
            </div>
          </div>

          <Separator />

          {/* Footer Links */}
          <div className="flex flex-col gap-1 p-2">
            <button
              type="button"
              onClick={handleOpenAllSettings}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Settings className="size-4 text-muted-foreground" />
              All Settings
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut(false)}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut className="size-4" />
              Sign Out
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Edit Profile Modal (no PMI here; PMI lives in Settings & Meetings) */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2.5 pr-6">
              <BackButton
                onClick={() => setEditOpen(false)}
                ariaLabel="Close profile editor"
                className="size-9 min-h-9 min-w-9 sm:hidden"
              />
              <div>
                <DialogTitle>Edit Profile</DialogTitle>
                <DialogDescription>
                  Update how your name and avatar appear across classes, chat,
                  and whiteboards.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={(e) => void handleSaveProfile(e)} className="space-y-5">
            {/* Avatar Customization */}
            <div className="flex flex-col items-center gap-3 rounded-2xl border bg-muted/40 p-4">
              <AvatarBubble
                name={draftName.trim() || roleBadge}
                color={draftColor}
                photo={draftPhoto}
                className="size-20 text-2xl shadow-sm"
              />
              <div className="flex flex-wrap items-center justify-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handlePhotoSelected(e)}
                  className="hidden"
                />
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={uploadingPhoto}
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-1.5"
                >
                  <Camera className="size-3.5" />
                  {uploadingPhoto
                    ? 'Loading…'
                    : draftPhoto
                      ? 'Change photo'
                      : 'Upload photo'}
                </Button>
                {draftPhoto && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => setDraftPhoto(null)}
                    className="gap-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" /> Remove photo
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                {AVATAR_COLOR_SWATCHES.map((swatch) => {
                  const selected = !draftPhoto && draftColor === swatch.value
                  return (
                    <button
                      key={swatch.id}
                      type="button"
                      onClick={() => {
                        setDraftColor(swatch.value)
                        setDraftPhoto(null)
                      }}
                      title={swatch.label}
                      aria-label={`Avatar color ${swatch.label}`}
                      aria-pressed={selected}
                      className={cn(
                        'grid size-7 place-items-center rounded-full text-white transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        selected &&
                          'ring-2 ring-foreground ring-offset-2 ring-offset-card',
                      )}
                      style={{ background: swatch.value }}
                    >
                      {selected && <Check className="size-3.5" />}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-profile-name">Display name</Label>
              <Input
                id="edit-profile-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Your name in class"
                maxLength={60}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-profile-extra">
                {user.role === 'student'
                  ? 'Class / Roll No.'
                  : 'Subject / Institution'}{' '}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="edit-profile-extra"
                value={draftExtra}
                onChange={(e) => setDraftExtra(e.target.value)}
                placeholder={
                  user.role === 'student'
                    ? 'e.g. Grade 10-A · Roll 14'
                    : 'e.g. Mathematics · St. Xavier’s'
                }
                maxLength={80}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingProfile}>
                {savingProfile ? 'Saving…' : 'Save profile'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
