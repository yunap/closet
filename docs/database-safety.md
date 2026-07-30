# Database safety

The project-root `wardrobe.db` is live owner data. Importing `db.js` from a standalone script no
longer opens that file implicitly.

## Standalone diagnostics

Every diagnostic, probe, migration, or one-off script must choose its database before importing
`db.js`:

```js
process.env.WARDROBE_DB_PATH = '/tmp/wardrobe-probe/wardrobe.db'
const { db } = await import('../db.js')
```

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
