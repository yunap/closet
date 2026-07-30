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
}) {
  if (explicitDbPath || allowLiveDb === '1' || isServerEntrypoint(entrypoint, serverPath)) return
  throw new Error(
    'Refusing to open the live wardrobe database outside server.js. ' +
    'Set WARDROBE_DB_PATH to an isolated database. For an intentional live-data operation, ' +
    'set WARDROBE_ALLOW_LIVE_DB=1 explicitly.'
  )
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
