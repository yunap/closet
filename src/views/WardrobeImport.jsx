// Spec 31 Phase 3 — the batch import UI. One stepper driving the pipeline:
// upload (folder/ZIP/Takeout/video) → analyze (classify → detect → cluster → match)
// → cost preflight (the gate: nothing expensive runs unapproved) → review queue
// (accept / merge / not mine / skip — accept lands PROVISIONAL, merges are permanent).
// Every dropped item count from the server is surfaced verbatim (no silent caps).
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px', marginBottom: 16 }
const primaryBtn = { padding: '9px 18px', borderRadius: 10, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const quietBtn = { padding: '8px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }
const mutedText = { color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.5 }

const COUNT_LABELS = {
  imagesIngested: 'photos imported',
  framesSampled: 'video frames sampled',
  metadataFilesIgnored: 'metadata files ignored',
  unsupportedSkipped: 'unsupported files skipped',
  unreadableSkipped: 'unreadable files skipped',
  blurryFramesDropped: 'blurry frames dropped',
  videosSkippedNoFfmpeg: 'videos skipped (no ffmpeg)',
  videosFailed: 'videos failed to sample'
}

const STAGES = [
  { key: 'classify', label: 'Classify' },
  { key: 'detect', label: 'Detect garments' },
  { key: 'cluster', label: 'Group duplicates' },
  { key: 'match', label: 'Match to wardrobe' }
]

function StageBar({ stage, counts, totalImages }) {
  const stageIndex = STAGES.findIndex(s => s.key === stage)
  const activeIndex = stage === 'done' ? STAGES.length : stageIndex
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
      <style>{'@keyframes import-stage-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .5 } }'}</style>
      {STAGES.map((s, i) => {
        const status = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending'
        let fill = 1
        if (status === 'pending') fill = 0
        else if (status === 'active') {
          if (s.key === 'classify' && totalImages) fill = Math.min(1, (counts.imagesClassified || 0) / totalImages)
          else if (s.key === 'detect' && totalImages) fill = Math.min(1, (counts.imagesDetected || 0) / totalImages)
          else fill = 0.35
        }
        return (
          <div key={s.key} style={{ flex: 1 }}>
            <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${fill * 100}%`, borderRadius: 4, background: 'var(--accent)',
                transition: 'width .4s ease', ...(status === 'active' ? { animation: 'import-stage-pulse 1.4s ease-in-out infinite' } : {})
              }} />
            </div>
            <div style={{ fontSize: 11, marginTop: 4, color: status === 'pending' ? 'var(--text-muted)' : 'var(--text)' }}>{s.label}</div>
          </div>
        )
      })}
    </div>
  )
}

function SimpleBar({ done, total }) {
  const fill = total > 0 ? Math.min(1, done / total) : 0
  return (
    <div style={{ marginTop: 12 }}>
      <style>{'@keyframes import-stage-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .5 } }'}</style>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${(total > 0 ? fill : 0.35) * 100}%`, borderRadius: 4, background: 'var(--accent)',
          transition: 'width .4s ease', ...(total === 0 ? { animation: 'import-stage-pulse 1.4s ease-in-out infinite' } : {})
        }} />
      </div>
      {total > 0 && <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>{done} of {total} tagged</div>}
    </div>
  )
}

export default function WardrobeImport() {
  const navigate = useNavigate()
  const [sessionId, setSessionId] = useState(null)
  const [phase, setPhase] = useState('upload') // upload | analyzing | preflight | tagging | review | done
  const [uploadTotals, setUploadTotals] = useState(null)
  const [ffmpegHint, setFfmpegHint] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [stage, setStage] = useState('')
  const [liveCounts, setLiveCounts] = useState({})
  const [preflight, setPreflight] = useState(null)
  const [queue, setQueue] = useState([])
  const [decisions, setDecisions] = useState({})
  const [edits, setEdits] = useState({})
  const [seedCalibration, setSeedCalibration] = useState(false)
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')
  const fileInput = useRef(null)

  // A refresh has no other way to know which import session was in flight — sessionId
  // otherwise lives only in memory, so a reload orphans any in-progress analysis on the
  // server (still running, just unreachable). Persist the id and reconnect on mount.
  useEffect(() => {
    const resume = async () => {
      const savedId = localStorage.getItem('importSessionId')
      if (savedId) {
        try {
          const s = await fetch(`/api/import/sessions/${savedId}`).then(r => r.json())
          if (s.status && s.status !== 'reviewed') {
            setSessionId(Number(savedId))
            setUploadTotals(s.counts)
            if (s.status === 'ingesting') {
              // nothing analyzed yet — stay on the upload screen with restored totals.
            } else if (s.status === 'classified' || s.status === 'detected' || s.status === 'clustered') {
              // analysis was interrupted mid-pipeline; remaining steps are safe to
              // re-run since each filters to its own unprocessed rows.
              runAnalysis(Number(savedId))
            } else {
              // status is 'matched' or 'tagged' — but status only flips to 'tagged' when
              // an ENTIRE tag batch finishes with zero failures, so a partial batch (one
              // straggler cluster) leaves status stuck at 'matched' even though most
              // clusters are already tagged and waiting on the review screen. Check the
              // review queue itself rather than trusting the coarse status field, or a
              // reload mid-review silently discards every in-progress decision.
              const data = await fetch(`/api/import/sessions/${savedId}/review-queue`).then(r => r.json())
              if (data.queue?.length) {
                setQueue(data.queue)
                setSeedCalibration(Boolean(data.calibrationSeedDefault))
                const initial = {}
                for (const entry of data.queue) initial[entry.id] = entry.mergeTarget ? 'merge' : 'accept'
                setDecisions(initial)
                setPhase('review')
              } else {
                const pf = await fetch(`/api/import/sessions/${savedId}/preflight`).then(r => r.json())
                setPreflight(pf); setPhase('preflight')
              }
            }
            return
          }
        } catch {}
      }
      fetch('/api/import/sessions', { method: 'POST' })
        .then(r => r.json())
        .then(data => setSessionId(data.sessionId))
        .catch(() => setError('Could not start an import session.'))
    }
    resume()
  }, [])

  useEffect(() => {
    if (sessionId) localStorage.setItem('importSessionId', String(sessionId))
  }, [sessionId])

  const postJson = async (route, body) => {
    const res = await fetch(route, {
      method: 'POST',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Request failed')
    return data
  }

  const handleFiles = async (fileList) => {
    if (!fileList?.length || !sessionId) return
    setUploading(true); setError('')
    try {
      const form = new FormData()
      for (const file of fileList) form.append('files', file, file.name)
      const res = await fetch(`/api/import/sessions/${sessionId}/files`, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setUploadTotals(data.totals)
      setFfmpegHint(data.ffmpegHint || '')
    } catch (err) { setError(err.message) } finally { setUploading(false) }
  }

  // Every long stage is one long HTTP request; the server bumps per-unit progress
  // counts as it works, and this poll renders them so no stage ever looks hung.
  const startStatusPoll = (label, id = sessionId) => setInterval(async () => {
    try {
      const status = await fetch(`/api/import/sessions/${id}`).then(r => r.json())
      const c = status.counts || {}
      setLiveCounts(c)
      const parts = []
      if (c.imagesClassified) parts.push(`${c.imagesClassified} classified`)
      if (c.imagesDetected) parts.push(`${c.imagesDetected} scanned for garments`)
      if (c.cropsRelocalized) parts.push(`${c.cropsRelocalized} crops re-located`)
      if (c.cropsFallbackToFullPhoto) parts.push(`${c.cropsFallbackToFullPhoto} using full photos`)
      if (c.clusterSheetsDone) parts.push(`${c.clusterSheetsDone} duplicate groups checked`)
      if (c.clustersMatched) parts.push(`${c.clustersMatched} checked against your wardrobe`)
      if (c.tagQueueTotal) parts.push(`${c.garmentsTagged || 0} of ${c.tagQueueTotal} tagged`)
      parts.push(`$${Number(status.spentUsd || 0).toFixed(2)} spent`)
      setProgress(`${label} ${parts.join(' · ')}`)
    } catch {}
  }, 2500)

  // Function declaration (not const) so it's hoisted — the mount-time resume effect
  // above calls this before this line executes during render.
  async function runAnalysis(id = sessionId) {
    setPhase('analyzing'); setError(''); setStage('classify')
    const poll = startStatusPoll('Analyzing…', id)
    try {
      setProgress('Classifying photos…')
      const classify = await postJson(`/api/import/sessions/${id}/classify`)
      setStage('detect')
      const detect = await postJson(`/api/import/sessions/${id}/detect`)
      setStage('cluster')
      const cluster = await postJson(`/api/import/sessions/${id}/cluster`)
      setStage('match')
      const match = await postJson(`/api/import/sessions/${id}/match-existing`)
      setStage('done')
      clearInterval(poll)
      setProgress(`${classify.classified} photos classified · ${detect.garmentsDetected} garments found · ${cluster.clustersCreated} distinct · ${match.mergeProposals} matched to your wardrobe.`)
      const pf = await fetch(`/api/import/sessions/${id}/preflight`).then(r => r.json())
      setPreflight(pf)
      setPhase('preflight')
    } catch (err) {
      clearInterval(poll)
      setError(err.message)
      setPhase('upload')
      setStage('')
    }
  }

  const approveTagging = async () => {
    setPhase('tagging'); setError('')
    const poll = startStatusPoll('Tagging…')
    try {
      setProgress('Tagging garments with the full stylist model…')
      await postJson(`/api/import/sessions/${sessionId}/tag`, { approve: true })
      const data = await fetch(`/api/import/sessions/${sessionId}/review-queue`).then(r => r.json())
      setQueue(data.queue || [])
      setSeedCalibration(Boolean(data.calibrationSeedDefault))
      const initial = {}
      for (const entry of data.queue || []) initial[entry.id] = entry.mergeTarget ? 'merge' : 'accept'
      setDecisions(initial)
      setPhase('review')
    } catch (err) { setError(err.message); setPhase('preflight') } finally { clearInterval(poll) }
  }

  const cancelImport = async () => {
    const id = sessionId
    localStorage.removeItem('importSessionId')
    if (id) {
      try { await fetch(`/api/import/sessions/${id}`, { method: 'DELETE' }) } catch {}
    }
    navigate('/wardrobe')
  }

  const applyDecisions = async () => {
    setError('')
    try {
      const payload = queue.map(entry => ({
        clusterId: entry.id,
        action: decisions[entry.id] || 'skip',
        ...(edits[entry.id]?.name !== undefined ? { name: edits[entry.id].name } : {}),
        ...(edits[entry.id]?.category !== undefined ? { category: edits[entry.id].category } : {})
      }))
      const result = await postJson(`/api/import/sessions/${sessionId}/review`, { decisions: payload, seedCalibration })
      setSummary(result.results)
      setPhase('done')
      localStorage.removeItem('importSessionId')
    } catch (err) { setError(err.message) }
  }

  const countRows = uploadTotals
    ? Object.entries(uploadTotals).filter(([key, n]) => n > 0 && COUNT_LABELS[key] && key !== 'videosSkippedNoFfmpeg').map(([key, n]) => `${n} ${COUNT_LABELS[key]}`)
    : []
  const ffmpegSkippedCount = uploadTotals?.videosSkippedNoFfmpeg || 0

  const decisionTally = queue.reduce((acc, entry) => {
    const d = decisions[entry.id] || (entry.mergeTarget ? 'merge' : 'accept')
    acc[d] = (acc[d] || 0) + 1
    return acc
  }, {})
  const TALLY_LABELS = [['accept', 'new piece'], ['merge', 'merge'], ['reject', 'not mine'], ['skip', 'skipped']]

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 20px 60px' }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Import your wardrobe</h1>
      <p style={mutedText}>
        Drop in photos of yourself wearing your clothes, hanger shots, a Google Takeout ZIP,
        or a slow video of your closet rail. Duplicates are grouped, clothes you already
        added are recognized, and nothing is saved until you approve it.
      </p>
      {error && <div style={{ padding: '8px 12px', borderRadius: 9, background: 'rgba(168,64,64,0.08)', color: 'var(--repair)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {phase === 'upload' && (
        <div style={card}>
          <input ref={fileInput} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.zip,.mp4,.mov,.m4v,.avi" style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
          <div
            onClick={() => fileInput.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
            style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: '38px 20px', textAlign: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            {uploading ? 'Importing…' : 'Drop photos, ZIPs, or videos here — or click to choose files'}
          </div>
          {countRows.length > 0 && (
            <div style={{ ...mutedText, marginTop: 12 }}>
              {countRows.join(' · ')}
            </div>
          )}
          {ffmpegHint && <div style={{ ...mutedText, marginTop: 8, color: 'var(--repair)' }}>{ffmpegHint}</div>}
          {!ffmpegHint && ffmpegSkippedCount > 0 && (
            <div style={{ marginTop: 8, fontSize: 12.5, fontStyle: 'italic', color: 'var(--text-muted)', opacity: 0.75 }}>
              Earlier this session, {ffmpegSkippedCount} video{ffmpegSkippedCount > 1 ? 's' : ''} {ffmpegSkippedCount > 1 ? 'were' : 'was'} skipped because ffmpeg wasn't installed yet — resolved since.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              style={{ ...quietBtn, fontSize: 12.5 }}
              onClick={async () => {
                setError('')
                const res = await fetch('/api/settings/demo-wardrobe', { method: 'POST' })
                const data = await res.json()
                if (res.ok) setProgress(`Demo wardrobe loaded (${data.loaded} pieces) — you can remove it any time from Settings.`)
                else setError(data.error || 'Could not load the demo wardrobe.')
              }}
            >…or explore with a demo wardrobe first</button>
            <button style={primaryBtn} disabled={!uploadTotals || uploading} onClick={() => runAnalysis()}>Analyze photos</button>
          </div>
          {progress && phase === 'upload' && <div style={{ ...mutedText, marginTop: 8 }}>{progress} <Link to="/wardrobe">See wardrobe</Link></div>}
        </div>
      )}

      {phase === 'analyzing' && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Analyzing…</div>
          <StageBar stage={stage} counts={liveCounts} totalImages={(uploadTotals?.imagesIngested || 0) + (uploadTotals?.framesSampled || 0)} />
          <p style={{ ...mutedText, marginTop: 12 }}>{progress}</p>
          <p style={{ ...mutedText, fontSize: 12 }}>This runs on the inexpensive model tier; the costly step comes after your approval.</p>
        </div>
      )}

      {phase === 'preflight' && preflight && (
        <div style={card}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Ready to tag</h2>
          <p style={mutedText}>
            <strong>{preflight.newPieceClusters}</strong> new garments to tag with the full stylist model
            {preflight.mergeClusters > 0 && <> · <strong>{preflight.mergeClusters}</strong> matched to clothes you already have (no tagging cost)</>}
          </p>
          <p style={mutedText}>
            Estimated tagging cost: <strong>{preflight.estimatedTagUsd != null ? `$${preflight.estimatedTagUsd.toFixed(2)}` : 'unknown'}</strong>
            {' '}· spent so far on analysis: ${Number(preflight.spentSoFarUsd || 0).toFixed(2)}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
            <button style={quietBtn} onClick={cancelImport}>Cancel</button>
            <button style={primaryBtn} onClick={approveTagging}>Tag {preflight.newPieceClusters} garments</button>
          </div>
        </div>
      )}

      {phase === 'tagging' && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Tagging…</div>
          <SimpleBar done={liveCounts.garmentsTagged || 0} total={liveCounts.tagQueueTotal || 0} />
          <p style={{ ...mutedText, marginTop: 12 }}>{progress}</p>
        </div>
      )}

      {phase === 'review' && (
        <>
          <div style={{ ...card, position: 'sticky', top: 12, zIndex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ ...mutedText, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={seedCalibration} onChange={e => setSeedCalibration(e.target.checked)} />
                Use my worn photos to teach the stylist my taste (calibration library)
              </label>
              <button style={primaryBtn} onClick={applyDecisions}>Apply decisions</button>
            </div>
            <div style={{ ...mutedText, fontSize: 12.5 }}>
              {TALLY_LABELS.map(([key, label]) => `${decisionTally[key] || 0} ${label}`).join(' · ')}
              {' '}· {queue.length} total
            </div>
          </div>
          {queue.map(entry => (
            <div key={entry.id} style={{ ...card, display: 'flex', gap: 14 }}>
              {entry.cropUrl && (
                <div style={{ textAlign: 'center' }}>
                  <img src={entry.cropUrl} alt="" style={{ width: 96, height: 128, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
                  {entry.cropOk === false && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>full photo</div>}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  value={edits[entry.id]?.name ?? entry.proposedName}
                  onChange={e => setEdits({ ...edits, [entry.id]: { ...edits[entry.id], name: e.target.value } })}
                  style={{ fontWeight: 650, fontSize: 15, border: '1px solid transparent', borderRadius: 8, padding: '2px 6px', margin: '-2px -6px 0', width: '100%', boxSizing: 'border-box', background: 'transparent', color: 'var(--text)' }}
                  onFocus={e => { e.target.style.border = '1px solid var(--border)'; e.target.style.background = 'var(--surface)' }}
                  onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent' }}
                />
                <div style={{ ...mutedText, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <select
                    value={edits[entry.id]?.category ?? entry.category}
                    onChange={e => setEdits({ ...edits, [entry.id]: { ...edits[entry.id], category: e.target.value } })}
                    style={{ fontSize: 12.5, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 7, padding: '1px 4px', background: 'var(--surface)' }}
                  >
                    {['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span>· seen in {entry.memberCrops.length} photo{entry.memberCrops.length === 1 ? '' : 's'}{entry.wornEvidenceCount > 0 && ` · ${entry.wornEvidenceCount} worn`}</span>
                </div>
                {entry.mergeTarget && (
                  <div style={{ ...mutedText, fontSize: 12.5, marginTop: 4 }}>
                    Looks like <strong>{entry.mergeTarget.name}</strong> already in your wardrobe
                    {entry.mergeTarget.photoUrl && <img src={entry.mergeTarget.photoUrl} alt="" style={{ width: 34, height: 44, objectFit: 'cover', borderRadius: 6, marginLeft: 8, verticalAlign: 'middle', border: '1px solid var(--border)' }} />}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  {[['accept', 'Add as new piece'], ...(entry.mergeTarget ? [['merge', 'Same garment — merge']] : []), ['reject', 'Not my garment'], ['skip', 'Skip for now']].map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setDecisions({ ...decisions, [entry.id]: value })}
                      style={{
                        padding: '5px 11px', borderRadius: 999, fontSize: 12.5, cursor: 'pointer',
                        border: `1px solid ${decisions[entry.id] === value ? 'var(--accent)' : 'var(--border)'}`,
                        background: decisions[entry.id] === value ? 'var(--accent-light)' : 'var(--surface)',
                        color: decisions[entry.id] === value ? 'var(--accent)' : 'var(--text-muted)'
                      }}
                    >{label}</button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {phase === 'done' && summary && (
        <div style={card}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Import complete</h2>
          <p style={mutedText}>
            {summary.filter(r => r.outcome === 'accepted').length} new pieces added (provisional — they earn trust as you style them) ·{' '}
            {summary.filter(r => r.outcome === 'merged').length} merged into existing pieces ·{' '}
            {summary.filter(r => r.outcome === 'rejected' || r.outcome === 'skip' || r.outcome === 'skipped').length} set aside
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Link to="/wardrobe" style={{ ...primaryBtn, textDecoration: 'none' }}>See my wardrobe</Link>
          </div>
        </div>
      )}
    </div>
  )
}
