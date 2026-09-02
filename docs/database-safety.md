# Database safety

The project-root `wardrobe.db` is live owner data. Importing `db.js` from a standalone script no
longer opens that file implicitly.

## Standalone diagnostics

Every diagnostic, probe, migration, or one-off script must choose its isolated database or
multi-user root before importing `db.js`:

```js
process.env.WARDROBE_DB_PATH = '/tmp/wardrobe-probe/wardrobe.db'
const { db } = await import('../db.js')
```

`WARDROBE_USERS_DIR` is the equivalent explicit isolation mechanism for multi-user diagnostics and
tests.

Use a copied database when real garment data is required. Do not point destructive or fixture-based
diagnostics at the live file. An intentional live-data maintenance operation must opt in with
`WARDROBE_ALLOW_LIVE_DB=1`; that flag is an acknowledgement, not a default for scripts.

The application server remains allowed to open the default database through `server.js`. Tests keep
using their existing temporary `WARDROBE_DB_PATH` pattern.

## Automatic recovery snapshots

When `server.js` opens the default live database, it creates a consistent SQLite snapshot with
`VACUUM INTO`, opens the snapshot read-only, and requires `PRAGMA integrity_check` to return `ok`.
Snapshots are written to:

```text
backups/wardrobe/wardrobe-<ISO timestamp>.db
```

The newest ten snapshots are retained. The backup directory is gitignored. These snapshots protect
against accidental later writes; they do not replace external machine backups.

To inspect a snapshot without modifying it:

```bash
sqlite3 -readonly backups/wardrobe/<snapshot>.db 'PRAGMA integrity_check;'
```

## Copying the live DB: bring the WAL, or you read the past

The databases run in WAL mode, so a committed write lives in `wardrobe.db-wal` until SQLite
checkpoints it into `wardrobe.db`. **Copying only the main file silently gives you a stale
snapshot** — not an error, not an empty result, just older values that look entirely current.
This has already cost one wrong conclusion: a diagnostic read `wardrobe.db` alone while the
`-wal` held several hours of newer writes, and reported a garment edit as "never saved".

Always copy the sidecars alongside it:

```bash
cp wardrobe.db "$TMP/copy.db"
cp wardrobe.db-wal "$TMP/copy.db-wal" 2>/dev/null
cp wardrobe.db-shm "$TMP/copy.db-shm" 2>/dev/null
```

`scratch/measure_freeform_turns.js`, `scratch/report_ai_spend.js` and
`scratch/report_freeform_threads.js` already do this in JS — copy their loop rather than
re-deriving it:

```js
fs.copyFileSync(live, copy)
for (const suffix of ['-wal', '-shm']) {
  if (fs.existsSync(live + suffix)) fs.copyFileSync(live + suffix, copy + suffix)
}
```

Cheapest sanity check when a value looks wrong or stale: compare `ls -la wardrobe.db*` timestamps.
A `-wal` newer than the `.db` means uncheckpointed writes exist, and a main-file-only copy will
not contain them.
