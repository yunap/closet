import 'dotenv/config'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { db, userUploadsDir } from './db.js'
import { runWithUser, DEFAULT_USER_ID } from './lib/requestContext.js'
import { executeTool } from './styling-engine/tools.js'
import { contentToOpenAI } from './styling-engine/provider.js'
import { tagPieceWithProvider } from './routes/ai.js'
import crudRouter from './routes/crud.js'
import importerRouter from './routes/importer.js'
import aiRouter from './routes/ai.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001

// Middlewares
app.use(express.json({ limit: '25mb' }))
app.use(express.urlencoded({ extended: true, limit: '25mb' }))
// Spec 33 Part 1: every request runs inside a user context before anything else touches
// it — including static file serving below, since the uploads dir is now per-user. No
// auth exists yet (Part 2), so this is unconditionally the default user.
app.use((req, res, next) => runWithUser(DEFAULT_USER_ID, next))
app.use('/uploads', (req, res, next) => express.static(userUploadsDir())(req, res, next))

// Mount API Routers
app.use('/api', crudRouter)
app.use('/api/import', importerRouter)
app.use('/api/ai', aiRouter)

// Catch-all: serve React app (production only)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')))
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
  })
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`\n🧥 Wardrobe app → http://localhost:${PORT}\n`)
  })
}

export { app, db, userUploadsDir, executeTool, contentToOpenAI, tagPieceWithProvider }
