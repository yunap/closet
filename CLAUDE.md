# CLAUDE.md

See [README.md](README.md) for what the app does, tech stack, and setup.

## Dev servers

Two independent server/frontend pairs are defined in `.claude/launch.json`:

- **`wardrobe-api`** (port 3001) / **`wardrobe-web`** (port 5173) — the real dev pair, backed by the owner's actual `wardrobe.db`. Use this only when the owner wants to see something against real data.
- **`sandbox-api`** (port 3098) / **`sandbox-web`** (port 5174) — a separate, durable sandbox for verifying UI/UX changes live in the browser. Default to this pair for browser verification.

### Sandbox details

- Data lives at `~/.wardrobe-sandbox/` (owner's home dir, outside the repo — deliberately immune to `git clean`/`reset` in this working directory). Contains `legacy-wardrobe.db`, `system.db`, `users/`, `legacy-uploads/`.
- `sandbox-api` runs `server.js` in dev mode, pointed at that directory via `WARDROBE_DB_PATH` / `WARDROBE_SYSTEM_DB_PATH` / `WARDROBE_USERS_DIR` / `WARDROBE_UPLOADS_DIR` env vars.
- `sandbox-web` runs vite with `VITE_API_PROXY_TARGET=http://localhost:3098` (the proxy target is configurable via that env var; falls back to `localhost:3001` if unset, so the real dev pair is unaffected). It also sets `VITE_STYLIST_DEBUG=true`, which surfaces the Stylist chat's dev-only engine internals (styling engine trace, generation timing/token telemetry, raw gate-rejection detail on "needs review" cards) — see `StylistChat.jsx`'s `STYLIST_DEBUG_ENABLED`. `wardrobe-web` leaves this unset, so those internals stay hidden on the real dev pair by default.
- **`sandbox-web-asuser`** (port 5176) is the same sandbox web server with `VITE_STYLIST_DEBUG`
  left unset, so the Stylist renders exactly as a real user sees it. Use it whenever the question
  is "what does the owner actually see" — most importantly when preparing evidence for an expert
  panel, since `sandbox-web` shows dev-only engine internals that no user ever sees and a reviewer
  will otherwise critique them as product. It shares `sandbox-api`, so both can run at once and
  the same thread can be compared side by side.
- Login: `burned-id-1@example.com` / `tourdemo123`.
- **Before any sandbox testing session, always restart both servers fresh — never attach to
  whatever is already bound to ports 3098/5174.** The owner's own local servers commonly point
  at those same ports without `WARDROBE_MOCK_AI` set, so a process already listening there is
  not evidence of anything — it can just as easily be the owner's own dev server as a
  previously-launched mocked sandbox. Unconditionally:
  ```
  lsof -nP -iTCP:3098 -sTCP:LISTEN | awk 'NR>1{print $2}' | xargs -r kill
  lsof -nP -iTCP:5174 -sTCP:LISTEN | awk 'NR>1{print $2}' | xargs -r kill
  ```
  then `preview_start({name: "sandbox-api"})` and `preview_start({name: "sandbox-web"})` to
  relaunch both from `.claude/launch.json`'s documented command (which sets
  `WARDROBE_MOCK_AI=true`). Do this every time a sandbox testing session begins, even if you
  believe you already verified the flag earlier in the same conversation — do not rely on a
  process someone else may have restarted, replaced, or pointed elsewhere since. Do not delete
  or otherwise clean up chat threads/data the resulting testing generates in the sandbox DB;
  restarting the *server processes* is not the same as touching sandbox data.
- This exists so UI changes can be verified against **live source** (not a stale `npm run build` output) on a **durable** database (not an ephemeral `/tmp` path) without ever touching the real `wardrobe.db`.
- `sandbox-api` also sets `WARDROBE_MOCK_AI=true`, so every stylist/critique/outfit-generation call (and image generation) returns a canned response instead of a real, billed provider call — see `styling-engine/mockAiHandler.js`. Outfit-generation mocks pull real pieces from the sandbox's own wardrobe so resulting cards/thumbnails resolve to actual photos. This makes it safe to click through Critique/Ask/Create-outfits flows freely while verifying UI in the sandbox — **but only because you just restarted both servers per the rule above; a process you merely found running is not guaranteed to have it.** `wardrobe-api` never sets this flag — real dev pair always makes real calls as before. Feedback-only actions (verdict/reason chips, saves, navigation) never call the model and are always safe regardless of the flag; only actions that hit a stylist/critique/image-generation endpoint carry cost.
