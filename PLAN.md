# Plan

Done:

- [x] Theme, fonts, root shell, dark/light hook
- [x] Local media hooks, speaking detection, screen capture, network status, meeting ID helpers
- [x] Home page: start instant class, join by link/ID, schedule (with .ics), class list for signed-in teachers
- [x] Teacher accounts (Netlify Identity): login, signup, sign out; emailed links (confirmation, password reset, invite) are processed on page load by `IdentityProvider` + `AuthCallbackHandler`, with `/reset-password` for setting a new password
- [x] Netlify Database (Drizzle): `meetings`, `participants`; server functions in `src/lib/meetings.functions.ts`
- [x] Lobby `/join/$meetingId`: name, passcode, camera/mic preview, device pickers, permission errors
- [x] Meeting `/meet/$meetingId`: join state machine (passcode, waiting room, locked, rejected, removed, ended)
- [x] Meeting UI: adaptive gallery, speaker view, pin, fullscreen, control bar, side panel (chat/people/details), mobile sheet
- [x] Peer-to-peer WebRTC mesh (`src/lib/mesh/mesh-room.ts` + `use-mesh-adapter.tsx`): DB-backed signalling via `syncRoom`, fixed transceivers, data channels, reconnection, device switching, STUN with optional TURN. Replaced LiveKit (no account needed; sized for small classes)
- [x] Host controls: waiting room admit/reject, mute, mute all, remove, lock, co-host, student permissions, end for everyone
- [x] Chat (everyone/private/announcements), reactions, raise hand, notifications
- [x] Whiteboard: tools, colours, sizes, undo/redo, zoom/pan, pages, PNG/PDF export, teacher-controlled drawing, sync over data channel
- [x] Whiteboard import: paste / drop / pick images (anyone who can draw) and PDFs (teacher; each page becomes a locked board page). Large messages are chunked over the data channel in `mesh-room.ts`
- [x] Recording (tab capture to WebM, host only), keyboard shortcuts

Remaining / ideas:

- [ ] Server-side recording (would need a media server; tab recording covers the current need)
- [ ] An SFU if classes grow beyond ~6 people (mesh bandwidth grows per participant)
- [ ] Breakout rooms, polls (explicitly out of scope for now)
