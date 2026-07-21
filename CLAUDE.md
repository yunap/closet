# CLAUDE.md

See [README.md](README.md) for what the app does, tech stack, and setup.

## Dev servers

Two independent server/frontend pairs are defined in `.claude/launch.json`:

- **`wardrobe-api`** (port 3001) / **`wardrobe-web`** (port 5173) — the real dev pair, backed by the owner's actual `wardrobe.db`. Use this only when the owner wants to see something against real data.
- **`sandbox-api`** (port 3098) / **`sandbox-web`** (port 5174) — a separate, durable sandbox for verifying UI/UX changes live in the browser. Default to this pair for browser verification.

### Sandbox details

- Data lives at `~/.wardrobe-sandbox/` (owner's home dir, outside the repo — deliberately immune to `git clean`/`reset` in this working directory). Contains `legacy-wardrobe.db`, `system.db`, `users/`, `legacy-uploads/`.
- `sandbox-api` runs `server.js` in dev mode, pointed at that directory via `WARDROBE_DB_PATH` / `WARDROBE_SYSTEM_DB_PATH` / `WARDROBE_USERS_DIR` / `WARDROBE_UPLOADS_DIR` env vars.
- `sandbox-web` runs vite with `VITE_API_PROXY_TARGET=http://localhost:3098` (the proxy target is configurable via that env var; falls back to `localhost:3001` if unset, so the real dev pair is unaffected).
- Login: `burned-id-1@example.com` / `tourdemo123`.
- Start both the same way as the real pair: `preview_start({name: "sandbox-api"})` and `preview_start({name: "sandbox-web"})`.
- This exists so UI changes can be verified against **live source** (not a stale `npm run build` output) on a **durable** database (not an ephemeral `/tmp` path) without ever touching the real `wardrobe.db`.
- `sandbox-api` also sets `WARDROBE_MOCK_AI=true`, so every stylist/critique/outfit-generation call (and image generation) returns a canned response instead of a real, billed provider call — see `styling-engine/mockAiHandler.js`. Outfit-generation mocks pull real pieces from the sandbox's own wardrobe so resulting cards/thumbnails resolve to actual photos. This makes it safe to click through Critique/Ask/Create-outfits flows freely while verifying UI in the sandbox. `wardrobe-api` never sets this flag — real dev pair always makes real calls as before.
