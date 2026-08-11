#!/usr/bin/env node

// No model or network calls occur here. Default mode is read-only; --apply writes only recovered
// evidence envelopes and their existing canonical feedback mirrors.
const apply = process.argv.includes('--apply')
if (!apply && process.argv.some(arg => arg.startsWith('--') && arg !== '--dry-run')) {
  console.error('Usage: node scratch/backfill_positive_board_evidence.js [--dry-run|--apply]')
  process.exit(2)
}

process.env.WARDROBE_ALLOW_LIVE_DB ||= '1'
const { backfillPositiveSavedBoardEvidence } = await import('../routes/crud.js')
const result = backfillPositiveSavedBoardEvidence({ apply })
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...result }, null, 2))

