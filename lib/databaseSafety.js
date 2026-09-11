import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

export function isServerEntrypoint(entrypoint, serverPath) {
  if (!entrypoint) return false
  return path.resolve(entrypoint) === path.resolve(serverPath)
}

export function assertDefaultDatabaseAccess({
  explicitDbPath,
  allowLiveDb,
  entrypoint,
  serverPath,
  nodeEnv = process.env.NODE_ENV,
}) {
  if (explicitDbPath) return
  if (isServerEntrypoint(entrypoint, serverPath)) return
  if (allowLiveDb === '1') {
    if (nodeEnv === 'test') {
      throw new Error(
        'Refusing to open the live wardrobe database: WARDROBE_ALLOW_LIVE_DB=1 cannot be used under NODE_ENV=test. ' +
        'Tests must run against an isolated database. Set WARDROBE_DB_PATH to a temporary database path. ' +
        'See docs/database-safety.md.'
      )
    }
    return
  }
  throw new Error(
    'Refusing to open the live wardrobe database outside server.js. ' +
    'Set WARDROBE_DB_PATH to an isolated database (e.g. via createIsolatedDbSnapshot() or a temporary file). ' +
    'For an intentional live-data maintenance operation confirmed by the user, set WARDROBE_ALLOW_LIVE_DB=1 explicitly. ' +
    'See docs/database-safety.md.'
  )
}

export function createIsolatedDbSnapshot({
  sourceDbPath = path.join(process.cwd(), 'wardrobe.db'),
  targetDir,
  prefix = 'wardrobe-isolated-',
} = {}) {
  const dir = targetDir || fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', prefix))
  const destDb = path.join(dir, 'wardrobe.db')
  if (fs.existsSync(sourceDbPath)) {
    fs.copyFileSync(sourceDbPath, destDb)
    for (const suffix of ['-wal', '-shm']) {
      const srcSidecar = sourceDbPath + suffix
      if (fs.existsSync(srcSidecar)) {
        fs.copyFileSync(srcSidecar, destDb + suffix)
      }
    }
  }
  return {
    dbPath: destDb,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {}
    },
  }
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function createRotatingSqliteBackup(db, {
  dbPath,
  backupDir = path.join(path.dirname(dbPath), 'backups', 'wardrobe'),
  now = new Date(),
  retain = 10,
} = {}) {
  if (!dbPath) throw new Error('dbPath is required for a wardrobe backup')
  fs.mkdirSync(backupDir, { recursive: true })

  const timestamp = now.toISOString().replaceAll(':', '-')
  const destination = path.join(backupDir, `wardrobe-${timestamp}.db`)
  db.exec(`VACUUM INTO ${sqlString(destination)}`)

  const verification = new Database(destination, { readonly: true, fileMustExist: true })
  try {
    const result = verification.pragma('integrity_check', { simple: true })
    if (result !== 'ok') throw new Error(`Backup integrity check failed: ${result}`)
  } finally {
    verification.close()
  }

  const backups = fs.readdirSync(backupDir)
    .filter(name => /^wardrobe-.*\.db$/.test(name))
    .sort()
  const removeCount = Math.max(0, backups.length - Math.max(1, retain))
  for (const name of backups.slice(0, removeCount)) {
    fs.unlinkSync(path.join(backupDir, name))
  }

  return destination
}
