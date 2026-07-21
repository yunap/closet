import 'dotenv/config'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { db, userUploadsDir } from './db.js'
import { runWithUser, getCurrentUserId, DEFAULT_USER_ID } from './lib/requestContext.js'
import { getSessionToken } from './lib/cookies.js'
import { resolveSession, isAdmin } from './lib/systemDb.js'
import { executeTool } from './styling-engine/tools.js'
import { contentToOpenAI, mockAiEnabled } from './styling-engine/provider.js'
import { installMockAiHandler } from './styling-engine/mockAiHandler.js'
import { tagPieceWithProvider } from './routes/ai.js'
import authRouter from './routes/auth.js'
import crudRouter from './routes/crud.js'
import importerRouter from './routes/importer.js'
import aiRouter from './routes/ai.js'
import adminRouter from './routes/admin.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001
// Local HTTP is fine as-is. HTTPS/secure-cookie flags activate behind TRUST_PROXY once a
// reverse proxy (Caddy) appears — deployment note, not v1 scope.

// Middlewares
app.use(express.json({ limit: '25mb' }))
app.use(express.urlencoded({ extended: true, limit: '25mb' }))

// register/login/me must be reachable with no session yet, so this is mounted before
// the auth guard below. (Its own /sessions* routes protect themselves individually,
// since they share this router with the unauthenticated ones.)
app.use('/api/auth', authRouter)

// Spec 33 Part 2: resolve the session cookie into a request-scoped user context. This is
// the ONLY place a request's identity is established — no route handler, including
// db.js/userUploadsDir()/promptRuntime.js, may be reached without going through here
// first. An invalid/missing session does NOT fall back to any default user; it simply
// leaves no context, and the guards below refuse to let such a request reach user data.
//
// Test-only bypass: dozens of pre-Part-2 tests (spec 21-32) drive the real HTTP app
// against an isolated WARDROBE_DB_PATH instance with no concept of logging in — they
// predate auth entirely and test unrelated business logic. Rather than thread a login
// flow through every one of them, NODE_ENV=test requests with no session cookie resolve
// to DEFAULT_USER_ID automatically UNLESS WARDROBE_TEST_REQUIRE_AUTH is set, which
// auth_routes.test.js sets to exercise the real unauthenticated-request behavior. This
// can never fire outside NODE_ENV=test, so it doesn't weaken the guard in production.
app.use((req, res, next) => {
  const session = resolveSession(getSessionToken(req))
  if (session) {
    req.wardrobeSession = session
    return runWithUser(session.user_id, next)
  }
  if (process.env.NODE_ENV === 'test' && !process.env.WARDROBE_TEST_REQUIRE_AUTH) {
    req.wardrobeSession = { user_id: DEFAULT_USER_ID, tokenHash: 'test-bypass' }
    return runWithUser(DEFAULT_USER_ID, next)
  }
  next()
})

// Every other /api/* route requires a session — 401, not a redirect (this is the API,
// not the page the browser is showing).
app.use('/api', (req, res, next) => {
  if (!req.wardrobeSession) return res.status(401).json({ error: 'unauthorized' })
  next()
})

// Photos are private per-user data. 404 (not 401) so an unauthenticated probe can't even
// confirm a file exists. No fallback to any default user's uploads dir is possible here —
// userUploadsDir() is only ever called once req.wardrobeSession has already gated entry.
app.use('/uploads', (req, res, next) => {
  if (!req.wardrobeSession) return res.status(404).end()
  express.static(userUploadsDir())(req, res, next)
})

// Spec 34: admin routes get their own guard on top of the regular auth guard above —
// every /api/admin/* request needs a valid session AND the is_admin flag. Non-admins get
// a flat 403, same shape as the missing-session 401 above, not a 404 (a 404 would invite
// probing for what routes exist; a 403 is the honest answer for an authenticated user
// who simply isn't allowed here).
app.use('/api/admin', (req, res, next) => {
  if (!isAdmin(getCurrentUserId())) return res.status(403).json({ error: 'forbidden' })
  next()
})

// Mount API Routers
app.use('/api', crudRouter)
app.use('/api/import', importerRouter)
app.use('/api/ai', aiRouter)
app.use('/api/admin', adminRouter)

// Catch-all: serve the React app shell (production only). Unauthenticated requests get
// the same shell as authenticated ones — no user data lives here — and the client-side
// auth check (mirroring the existing onboarding-redirect pattern) sends them to /login.
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')))
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
  })
}

if (mockAiEnabled()) {
  installMockAiHandler(db)
  console.log('🧪 WARDROBE_MOCK_AI is on — stylist responses are canned, no billed AI calls will be made')
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`\n🧥 Wardrobe app → http://localhost:${PORT}\n`)
  })
}

export { app, db, userUploadsDir, executeTool, contentToOpenAI, tagPieceWithProvider }
