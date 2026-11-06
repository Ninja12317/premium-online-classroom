# Lectern: live online classroom

A Zoom/Meet-style video classroom for teachers: start a class, share a link, teach with video, screen share, whiteboard and chat.

**Status:** complete live classroom (video, audio, screen share, whiteboard, chat, host controls). See `PLAN.md`.

## Stack

TanStack Start, React 19, Tailwind CSS 4, shadcn/ui, TypeScript, Netlify Identity, Netlify Database, peer-to-peer WebRTC (no media server).

## Run locally

```bash
pnpm install
npm run dev   # http://localhost:3000
```

## External services (needed from milestone 4)

Calls are direct browser-to-browser WebRTC with public STUN, so no media service or API key is needed. Signalling (offer/answer/ICE) goes through Netlify Database. For students behind strict carrier NATs you can optionally set `TURN_URL`, `TURN_USERNAME` and `TURN_CREDENTIAL` to use your own TURN relay.

## Roadmap

See `PLAN.md`.
