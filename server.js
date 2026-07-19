import 'dotenv/config'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { db, uploadsDir } from './db.js'
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
app.use('/uploads', express.static(uploadsDir))

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

export { app, db, uploadsDir, executeTool, contentToOpenAI, tagPieceWithProvider }
