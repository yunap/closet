# Spec 33: Multiuser web platform — auth, per-user tenancy, and the deferred BYOK

> ## ⚠️ HISTORICAL ARCHIVE — NOT A DESIGN AUTHORITY
>
> This spec is a **frozen record of intent at the time it was written**. It spans generations of an
> app that has been redesigned several times, and decisions in it have been revisited, reversed, or
> deleted since.
>
> **The `Status:` line below is frozen at authoring time and is frequently WRONG today.** Several
> specs marked "Proposed. Not implemented." shipped long ago (spec 29, 32 and 33 all say this, and
> all are merged).
>
> **Authority order when this disagrees with anything (owner ruling, 2026-07-30):**
> **1. the code** — what actually runs · **2. ratified docs**
> ([occasion profiles](../occasion_profiles_ratification.md), [style constitution](../style_constitution.md),
> the three maps) · **3. this archive** — only *why* something was once done that way.
>
> A decision made from fresh evidence — a live run, a measurement — **stands**. "An old spec decided
> otherwise" is an **unverified claim, not a finding**. Record the disagreement and let testing
> settle it; do not revert working behaviour on the strength of this file.
>
> Read [docs/specs/README.md](README.md) before acting on anything below.


**Status:** Written 2026-07-19; open questions RULED same day (one-time invite codes; $20 ceiling; video import hidden; device management deferred).
**Platform ruling encoded (owner, 2026-07-18):** multiuser WEB app — owner is a 30-year web developer; Electron/desktop dropped. This spec absorbs spec 32's deferred Part 4 (BYOK): "key handling belongs to that platform spec's auth/tenancy design."
**Owner ruling encoded (2026-07-19):** "I hate migrating, let's do this right" — in-process multitenancy done properly now, NOT process-per-user as a stopgap. And it must keep running on the owner's local machine: no Postgres, no Redis, no external auth provider, no infra dependency of any kind. Graduating to a VPS later is copying a directory.

## The shape (read first)

**Tenancy = one SQLite file per user.** `data/users/{userId}/wardrobe.db` plus a per-user uploads directory. This is deliberate, not a shortcut:

- Every migration marker in `db.js` (`seeded`, `constitution_migrated`, `legacy_todos_fresh_cleanup`) already assumes one-DB-one-user.
- Spec 32 already made profile + constitution per-DB data; the hermeticity work proved the app runs cleanly against any DB file (`WARDROBE_DB_PATH`).
- The alternative (shared Postgres, `user_id` on every table) touches every query in ~21k lines for scale that doesn't exist. Per-user files also make backup/export/delete-my-data trivially `rsync`/`rm -r`.

**The real work is not the DB file — it's that the process is architecturally single-tenant**, in two load-bearing ways this spec exists to fix:

1. `db.js:13` is a module-level `new Database(...)` singleton imported by 8 modules (`server.js`, `routes/{crud,ai,importer}.js`, `styling-engine/{rules,tools,core,promptRuntime}.js`), with ~250 `db.prepare(...)` call sites.
2. `styling-engine/promptRuntime.js` exposes the personalized prompts as **process-global live ESM bindings** (`export let STYLIST_SYSTEM` etc., refreshed by `refreshPrompts()`). With two users in one process this is a correctness bug: user B gets user A's constitution. Consumers: `core.js`, `provider.js`, `tools.js`, `routes/crud.js`, `routes/ai.js`.

## The safety rail

Same discipline as specs 29 and 32:

- **Yuna's instance is user #1, byte-identical.** The adoption step (Part 3) moves her existing `wardrobe.db` + `uploads/` into `data/users/1/` by copy — zero schema change, and a real-DB content diff (NOT mtime — WAL blindness lesson from spec 32) proves it untouched.
- **The spec 32 prompt-equivalence snapshots stay green** through the promptRuntime refactor. They were built for exactly this: the words move again (process-global → per-request), the bytes must not.
- **Hermeticity guard extends, not weakens:** tests run under an injected test-user context; `hermeticity_guard.test.js`'s structural rule (db-reaching imports must set `WARDROBE_DB_PATH`) adapts to the new resolution path.

## Part 1 — Request context: un-singleton the process (no auth yet)

The multitenancy refactor, landed and proven BEFORE any auth exists. One implicit "default user" so behavior is unchanged.

- **`AsyncLocalStorage` request context** (`lib/requestContext.js` or similar): `runWithUser(userId, fn)`; middleware enters it per request. Node's ALS propagates through the whole async chain automatically — including the importer's long-running background phases spawned from a request (they're continuations of that request's async context; add a test pinning that an import session's late writes land in the right user's DB).
- **`db` becomes a Proxy over the context-resolved connection.** `db.js` keeps exporting `db`, but it forwards `prepare`/`exec`/`transaction`/`pragma` to `getDbForUser(contextUserId)`. The ~250 call sites in 8 modules change **not at all** — this is the whole reason for the Proxy. Connection cache keyed by userId (better-sqlite3 handles many open files; sync calls are microseconds; add an idle-eviction cap so 50 users ≠ 50 permanently open handles).
- **Schema + migrations run per-file on first open.** The existing `db.js` bootstrap (CREATE TABLE IF NOT EXISTS + marker-guarded migrations) becomes `initDb(path)`, executed when a user's file is first opened. Fresh users' files are born clean — the fresh-DB guarantees (never receive legacy text, start EMPTY per the demo-wardrobe ruling) hold per user automatically.
- **`uploadsDir` becomes per-user.** It's a string today (~15 `path.join(uploadsDir, ...)` sites across crud/importer/ai/core/tools) — strings can't proxy, so these sites change to a `userUploadsDir()` call resolved from context. This is the one mechanical sweep in the spec; small, greppable, done in one commit.
- **promptRuntime: live bindings → per-user resolved.** `export let STYLIST_SYSTEM` cannot be per-user. Replace with a context-resolving accessor (a `prompts` object with getters, or named getter functions — implementer's choice), backed by a per-user built-prompts cache invalidated by `refreshPrompts(userId)` on any profile/constitution write. The 5 consumer modules change their access pattern; the spec 32 byte-snapshots gate the whole move. `PROFILE_NAME` / `PROFILE_PRONOUNS` follow the same path.
- Multer temp destinations stay in `os.tmpdir()`; final storage lands in the context user's uploads dir.

**Part 1 acceptance:** full suite green with a single injected default user; Yuna's real-DB content diff clean; prompt snapshots byte-identical; the ALS-background-import test passes.

## Part 2 — Auth: boring, local, zero external services

- **`data/system.db`** (the only cross-user store): `users` (id, email, password_hash, created_at), `sessions` (token_hash, user_id, expires_at, last_seen). Nothing else lives here — everything about a user stays in their own file.
- **Email + password.** Hashing via Node's built-in `crypto.scrypt` (no new dependency). Session = 128-bit random token, stored hashed, in an `httpOnly` + `SameSite=Lax` cookie; sliding expiry (~30 days). No password reset flow in v1 (the operator can reset via a CLI script) — no email-sending dependency.
- **Invite-gated signup (owner ruling 2026-07-19: one-time codes, not a shared secret):** an `invites` table in system.db (code, created_by, created_at, used_by, used_at). Codes are single-use — consumed atomically at registration — so the operator knows who invited whom and a leaked code can't fan out. Minted via CLI script in v1 (no invite UI); no unused codes = signup closed.
- **Middleware order:** session cookie → resolve user → `runWithUser` → routes. Unauthenticated: `/api/*` → 401 JSON; app routes → login page. Login/register/logout/`/api/me` endpoints; minimal login UI consistent with the app's existing look.
- **`/uploads` loses its global `express.static`.** Photos are per-user private data: an authenticated handler resolves paths inside the *requesting user's* uploads dir only (with traversal guarding). The frontend's photo URLs don't change shape (`/uploads/{file}`) — the server just resolves them per-session now.
- **Session management (owner ruling 2026-07-19: in v1):** Settings lists the user's active sessions (created, last-seen, current-session marker; store a coarse user-agent label at login) with per-session revoke and revoke-all-others. Revocation deletes the session row — the next request on that cookie 401s.
- **CSRF:** `SameSite=Lax` + JSON-only API (no form posts) is the v1 posture; note it explicitly so it's a ruling, not an accident.
- Local HTTP stays fine. HTTPS/secure-cookie flags activate behind a `TRUST_PROXY` env when a reverse proxy (Caddy) appears — deployment note, not scope.

## Part 3 — Adoption + per-user onboarding

- **`scripts/adopt-db.js` — general-purpose, not owner-only:** adopts ANY existing single-user instance (`--db <path> --uploads <dir> --email <email>`, password prompted) as a new user. **Copies** (not moves — original left in place as its own backup) into `data/users/{id}/`, then verifies with a full content diff. **Must checkpoint the WAL before copying** (open with better-sqlite3, `wal_checkpoint(TRUNCATE)`, close): live-verified 2026-07-19 that a test instance's `-wal` was 11× its main DB — a naive file copy silently loses recent writes (spec 32's WAL-blindness lesson, again). Refuses to adopt the same source twice (marker in the adopted DB). The owner's `wardrobe.db` → user #1 is simply the first invocation; the standing `/tmp/importtest2` test user (spec 31's live import instance) is the second, and doubles as the first real second-tenant for the Part 2 isolation tests.
- **Fresh users flow into the spec 32 wizard unchanged.** The first-run redirect is already server-decided from per-DB state, so it's per-user for free: signup → profile → constitution interview → (optionally) spec 31 import → styling. This is the moment the two prior specs were built for.
- Demo wardrobe stays opt-in per user (the 2026-07-19 ruling holds per-file automatically).

## Part 4 — Keys and spend (the deferred BYOK, adapted to tenancy)

Spec 32's Part 4 said key handling belongs here. The multiuser reality reshapes it:

- **v1 default: operator keys, per-user ceiling.** The server's env keys (owner's) serve everyone — correct for invited friends on her machine. But the import pipeline demonstrably runs up real money ($4.70/27 frames, spec 31 verdict), so: per-user cumulative spend tracked in the user's own `app_meta`, accumulated from `provider.js`'s existing `estimatedUsd` machinery (display-only machinery becomes a meter — still no new pricing logic). Env-configurable ceiling (`USER_SPEND_CEILING_USD`, **default $20** — owner ruling 2026-07-19; exempt user #1); at the ceiling, LLM-consuming endpoints return a clear "ask the operator" state, mirroring spec 32's capability-off pattern.
- **Per-user BYOK on top:** Settings fields for a user's own Anthropic/OpenAI keys, stored in their own DB file (their file IS their private store; OS-keychain hardening was a desktop concern that died with the platform ruling). A user's own keys override the operator's for their requests — `provider.js` reads keys from request context instead of module-level env capture. Spend on own keys doesn't count against the ceiling.
- **Degradation rules carry over from spec 32 verbatim:** no Anthropic key available (neither own nor operator's) → routed to the key step, not a crash; no OpenAI key → image rendering capability-off, everything else untouched.
- **Video import: HIDDEN (owner ruling 2026-07-19 — "way too expensive and not great," closing the spec 31 verdict).** The video ingest door disappears from the import UI for everyone; the code path stays (it shares the frame pipeline) behind an env flag (`WARDROBE_ENABLE_VIDEO_IMPORT=1`) for owner experiments only. Not deletion — hiding, so a future cheaper approach (frame dedupe, lower fps) can revive it without re-plumbing.

## Explicitly out of scope

- Open registration, email verification, password-reset emails, OAuth — all need external services or open-internet posture; later.
- Postgres or any shared relational store; cross-user features (sharing, social); admin dashboard beyond CLI scripts.
- Reverse proxy / TLS / deployment automation (one-page RUNNING.md note only).
- Rate limiting beyond the spend ceiling.

## Acceptance

- **Yuna-equivalence:** post-adoption content diff of her DB is byte-identical; every spec 32 prompt snapshot still byte-identical; her styling flows behave unchanged as user #1.
- **Isolation, proven not assumed:** a two-user test drives interleaved requests (including a slow background import for user A while user B chats) and asserts zero cross-contamination — DB rows, uploads, prompts (B's stylist must never utter A's name/constitution), spend attribution.
- **Uploads privacy:** user B requesting user A's photo filename gets 404/403; traversal attempts rejected.
- **Auth basics:** wrong password rejected; expired/garbage session cookie → 401; invite code required when set; scrypt hashes (no plaintext anywhere, including logs).
- **Fresh-user path:** signup → wizard → empty wardrobe → import → styling, all under their own file; demo wardrobe opt-in.
- **Ceiling:** a user at the spend ceiling gets the capability-off response on LLM endpoints; own-key users bypass it; user #1 exempt.
- **Video hidden:** the video ingest door is absent from the import UI (and its endpoint refuses) without `WARDROBE_ENABLE_VIDEO_IMPORT=1`; with the flag, the owner path works as before.
- Suite fully green and hermetic; `hermeticity_guard` extended to the multi-file layout.

## Review rulings (owner, 2026-07-19)

1. **Invite codes: one-time**, minted per invite, tracked in system.db (who invited whom; leaked codes can't fan out).
2. **Ceiling default: $20** (`USER_SPEND_CEILING_USD`).
3. **Video import: hidden** — "way too expensive and not great." UI door removed for all users; code kept behind an owner env flag. This closes the spec 31 cost/value verdict.
4. **Session device management: IN v1** (owner ruling 2026-07-19): Settings lists the user's active sessions (created, last seen, current-session marker) with per-session revoke and a revoke-all-others button.
