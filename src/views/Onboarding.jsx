// Spec 32 Part 3 — the first-run onboarding wizard. Produces the initial user profile and
// style constitution through a guided flow: profile → Layer 1 body-contract form (required,
// explicit "no restrictions" escape only) → Layer 3 aesthetic form → working-style question.
// Every constitution step shows the assembled layer text in an editable textarea BEFORE
// saving (the user approves the words their stylist will live by), and writes carry
// source:'interview' into constitution_history. Layer 2 (proven formulas) is deliberately
// NOT interviewed — formulas are earned from confirmed outfits, never assumed.
// The aesthetic step records colors exactly as stated and NEVER synthesizes a
// favorite/signature color the user didn't literally give (the plum/mustard lesson,
// generalized).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const STEPS = ['welcome', 'profile', 'comfort', 'aesthetic', 'working', 'done']

const PRONOUN_PRESETS = {
  'she/her': { subject: 'she', object: 'her', possessive: 'her', plural: false },
  'he/him': { subject: 'he', object: 'him', possessive: 'his', plural: false },
  'they/them': { subject: 'they', object: 'them', possessive: 'their', plural: true }
}

const CLING_OPTIONS = [
  ['midsection', 'Nothing clings to my midsection'],
  ['arms', 'Nothing tight on my upper arms'],
  ['hips', 'Nothing clinging at hips/thighs']
]
const COVERAGE_OPTIONS = [
  ['cropped', 'No cropped tops'],
  ['shoulders', 'No bare shoulders / strapless'],
  ['neckline', 'No deep necklines'],
  ['short_hem', 'No short hemlines (above knee)']
]
const SHOE_OPTIONS = [
  ['any', 'Any shoes are fine, heels included'],
  ['low', 'Low heels at most — comfort first'],
  ['flat', 'Flats only']
]
const TUCK_OPTIONS = [
  ['fine', 'Tucking is fine'],
  ['simple', 'Simple tucks only — no outfit engineering'],
  ['avoid', 'I avoid tucking altogether']
]
const VIBE_CHIPS = ['minimalist', 'bohemian', 'folk/artisan', 'polished', 'romantic', 'utilitarian', 'playful', 'edgy', 'preppy', 'classic']
const PRINT_OPTIONS = [
  ['love', 'I love prints and pattern mixing'],
  ['some', 'Some prints, kept controlled'],
  ['solid', 'Mostly solids']
]

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '22px 24px' }
const label = { display: 'block', fontSize: 13, fontWeight: 650, color: 'var(--text)', margin: '14px 0 6px' }
const inputStyle = { width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' }
const primaryBtn = { padding: '9px 18px', borderRadius: 10, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const quietBtn = { padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }
const chipStyle = active => ({ padding: '6px 12px', borderRadius: 999, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-light)' : 'var(--surface)', color: active ? 'var(--accent)' : 'var(--text-muted)', fontSize: 13, cursor: 'pointer' })

function toggleIn(list, value) {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
}

export default function Onboarding() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTarget = searchParams.get('return')
  const returnTo = returnTarget === 'settings'
    ? '/settings'
    : returnTarget === 'visual-lab'
      ? '/visual-lab?section=profile'
      : null
  const initialStep = STEPS.includes(searchParams.get('step')) ? searchParams.get('step') : 'welcome'
  const [step, setStep] = useState(initialStep)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Profile step state
  const [displayName, setDisplayName] = useState('')
  const [pronounChoice, setPronounChoice] = useState('they/them')
  const [customPronouns, setCustomPronouns] = useState({ subject: '', object: '', possessive: '', plural: false })
  const [homeLocation, setHomeLocation] = useState('')

  // Layer 1 state
  const [cling, setCling] = useState([])
  const [coverage, setCoverage] = useState([])
  const [shoes, setShoes] = useState('any')
  const [tuck, setTuck] = useState('fine')
  const [lowMaintenance, setLowMaintenance] = useState(true)
  const [comfortFree, setComfortFree] = useState('')
  const [noRestrictions, setNoRestrictions] = useState(false)
  const [comfortPreview, setComfortPreview] = useState(null)

  // Layer 3 state
  const [vibes, setVibes] = useState([])
  const [vibeFree, setVibeFree] = useState('')
  const [colorsLoved, setColorsLoved] = useState('')
  const [colorsAvoided, setColorsAvoided] = useState('')
  const [printAppetite, setPrintAppetite] = useState('some')
  const [aestheticFree, setAestheticFree] = useState('')
  const [aestheticPreview, setAestheticPreview] = useState(null)

  // Working style state
  const [directness, setDirectness] = useState('direct')
  const [workingPreview, setWorkingPreview] = useState(null)

  useEffect(() => {
    fetch('/api/settings/profile').then(r => r.json()).then(profile => {
      if (profile?.displayName && profile.displayName !== 'the user') setDisplayName(profile.displayName)
    }).catch(() => {})
  }, [])

  const comfortSelectionEmpty = cling.length === 0 && coverage.length === 0 && shoes === 'any' && tuck === 'fine' && !comfortFree.trim()

  const composedComfort = useMemo(() => {
    const lines = ['Layer 1 — Body & Comfort Contract (hard rules):']
    if (noRestrictions && comfortSelectionEmpty) {
      lines.push('- No hard body/comfort restrictions — style freely; comfort still matters.')
    } else {
      for (const [key, text] of CLING_OPTIONS) if (cling.includes(key)) lines.push(`- ${text} — pieces skim, never cling.`)
      for (const [key, text] of COVERAGE_OPTIONS) if (coverage.includes(key)) lines.push(`- ${text}.`)
      if (shoes === 'low') lines.push('- Shoes: low heels at most; practical, comfortable footwear for walking-heavy days.')
      if (shoes === 'flat') lines.push('- Shoes: flats only. Never suggest heels.')
      if (shoes === 'any') lines.push('- Practical, comfortable shoes for walking-heavy days; dressier shoes are valid when the day allows.')
      if (tuck === 'simple') lines.push('- No outfit engineering: no complicated tucks, no constant adjustment during wear. Simple tucking is fine.')
      if (tuck === 'avoid') lines.push('- No tucking — always suggest untucked pairings.')
      if (comfortFree.trim()) for (const raw of comfortFree.split('\n')) { const t = raw.trim(); if (t) lines.push(`- ${t}`) }
    }
    if (lowMaintenance) lines.push('- Maintenance burden matters: prefer low-maintenance dressing; flag pieces that need special handling rather than silently styling around them.')
    return lines.join('\n')
  }, [cling, coverage, shoes, tuck, lowMaintenance, comfortFree, noRestrictions, comfortSelectionEmpty])

  const composedAesthetic = useMemo(() => {
    const lines = ['Layer 3 — Aesthetic Gravity (soft preferences — weighted, never walled):']
    const vibeWords = [...vibes, ...(vibeFree.trim() ? [vibeFree.trim()] : [])]
    if (vibeWords.length) lines.push(`- Home base (in the wearer's own words): ${vibeWords.join(', ')}. A center of gravity, not a fence.`)
    else lines.push('- No aesthetic home base stated yet — learn it from feedback and confirmed outfits before asserting one.')
    // Colors are recorded exactly as stated — never promoted to "favorite"/"signature" claims.
    if (colorsLoved.trim()) lines.push(`- Gravitates toward (as stated): ${colorsLoved.trim()}.`)
    if (colorsAvoided.trim()) lines.push(`- Avoids (as stated): ${colorsAvoided.trim()}.`)
    if (printAppetite === 'love') lines.push('- Bold colors and prints are welcome; not afraid of pattern mixing.')
    if (printAppetite === 'some') lines.push('- Prints in moderation: one controlled print per outfit is the comfort zone.')
    if (printAppetite === 'solid') lines.push('- Prefers solids; treat prints as occasional accents, not defaults.')
    if (aestheticFree.trim()) for (const raw of aestheticFree.split('\n')) { const t = raw.trim(); if (t) lines.push(`- ${t}`) }
    lines.push('- Never state any color as a favorite, signature, or "best color" unless the wearer literally said so.')
    return lines.join('\n')
  }, [vibes, vibeFree, colorsLoved, colorsAvoided, printAppetite, aestheticFree])

  const composedWorking = useMemo(() => {
    const lines = ['Working Style:', '- Ask rather than guess.']
    if (directness === 'direct') lines.push('- Honest, direct feedback is wanted — say plainly when something does not work.')
    else lines.push('- Feedback should stay encouraging: lead with what works, then suggest improvements gently.')
    lines.push('- Never narrate profile-compliance (e.g., do not say "aligns with your aesthetic" or "matches your style").')
    return lines.join('\n')
  }, [directness])

  const saveProfile = async () => {
    const name = displayName.trim()
    if (!name) { setError('Please tell your stylist what to call you.'); return }
    setSaving(true); setError('')
    try {
      const pronouns = pronounChoice === 'custom'
        ? { subject: customPronouns.subject.trim() || 'they', object: customPronouns.object.trim() || 'them', possessive: customPronouns.possessive.trim() || 'their', plural: Boolean(customPronouns.plural) }
        : PRONOUN_PRESETS[pronounChoice]
      const res = await fetch('/api/settings/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name, pronouns }) })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save profile')
      if (homeLocation.trim()) {
        await fetch('/api/settings/home-location', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ homeLocation: homeLocation.trim() }) })
      }
      setStep('comfort')
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  const saveLayer = async (layer, body, nextStep) => {
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/settings/constitution/${layer}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, source: 'interview' }) })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save')
      if (returnTo) navigate(returnTo)
      else setStep(nextStep)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  const finish = async (destination = '/wardrobe') => {
    setSaving(true)
    try { await fetch('/api/settings/onboarding-complete', { method: 'POST' }) } catch {}
    setSaving(false)
    navigate(typeof destination === 'string' ? destination : '/wardrobe')
  }
  const finishToImport = () => finish('/import')

  const stepIndex = STEPS.indexOf(step)

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px 60px' }}>
      {step !== 'welcome' && step !== 'done' && !returnTo && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          {STEPS.slice(1, 5).map((s, i) => (
            <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i < stepIndex ? 'var(--accent)' : 'var(--surface-2)' }} />
          ))}
        </div>
      )}

      {step === 'welcome' && (
        <div style={card}>
          <h1 style={{ margin: '0 0 10px', fontSize: 26 }}>Meet your stylist</h1>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
            This app is a personal stylist that knows your actual wardrobe — every recommendation
            uses clothes you own. Before it can style you well, it needs two things: a few hard
            rules about what you will and won't wear, and a feel for your taste. That's what the
            next few steps collect. Everything you answer becomes your <strong>style constitution</strong> —
            plain text you can read and edit any time in Settings. Your stylist earns the rest by
            working with you.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={primaryBtn} onClick={() => setStep('profile')}>Let's set up</button>
          </div>
        </div>
      )}

      {step === 'profile' && (
        <div style={card}>
          <h2 style={{ margin: '0 0 4px', fontSize: 21 }}>About you</h2>
          <label style={label}>What should your stylist call you?</label>
          <input style={inputStyle} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your name" />
          <label style={label}>Pronouns</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[...Object.keys(PRONOUN_PRESETS), 'custom'].map(key => (
              <button key={key} style={chipStyle(pronounChoice === key)} onClick={() => setPronounChoice(key)}>{key}</button>
            ))}
          </div>
          {pronounChoice === 'custom' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input style={inputStyle} placeholder="subject (e.g. ze)" value={customPronouns.subject} onChange={e => setCustomPronouns({ ...customPronouns, subject: e.target.value })} />
              <input style={inputStyle} placeholder="object (e.g. zir)" value={customPronouns.object} onChange={e => setCustomPronouns({ ...customPronouns, object: e.target.value })} />
              <input style={inputStyle} placeholder="possessive (e.g. zir)" value={customPronouns.possessive} onChange={e => setCustomPronouns({ ...customPronouns, possessive: e.target.value })} />
            </div>
          )}
          <label style={label}>Home city (optional — used for live weather)</label>
          <input style={inputStyle} value={homeLocation} onChange={e => setHomeLocation(e.target.value)} placeholder="e.g. Portland" />
          {error && <div style={{ color: 'var(--repair)', fontSize: 13, marginTop: 10 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button style={primaryBtn} disabled={saving} onClick={saveProfile}>{saving ? 'Saving…' : 'Continue'}</button>
          </div>
        </div>
      )}

      {step === 'comfort' && (
        <div style={card}>
          <h2 style={{ margin: '0 0 4px', fontSize: 21 }}>Hard rules — body & comfort</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }}>
            These are rules your stylist will never break — not preferences, boundaries. Only pick
            what's genuinely non-negotiable; taste comes in the next step.
          </p>
          <label style={label}>Fit boundaries</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CLING_OPTIONS.map(([key, text]) => (
              <button key={key} style={chipStyle(cling.includes(key))} onClick={() => { setCling(toggleIn(cling, key)); setNoRestrictions(false); setComfortPreview(null) }}>{text}</button>
            ))}
          </div>
          <label style={label}>Coverage</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {COVERAGE_OPTIONS.map(([key, text]) => (
              <button key={key} style={chipStyle(coverage.includes(key))} onClick={() => { setCoverage(toggleIn(coverage, key)); setNoRestrictions(false); setComfortPreview(null) }}>{text}</button>
            ))}
          </div>
          <label style={label}>Shoes</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {SHOE_OPTIONS.map(([key, text]) => (
              <button key={key} style={chipStyle(shoes === key)} onClick={() => { setShoes(key); setComfortPreview(null) }}>{text}</button>
            ))}
          </div>
          <label style={label}>Tucking & fuss</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TUCK_OPTIONS.map(([key, text]) => (
              <button key={key} style={chipStyle(tuck === key)} onClick={() => { setTuck(key); setComfortPreview(null) }}>{text}</button>
            ))}
          </div>
          <label style={label}>Anything else that's a hard rule? (one per line)</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={comfortFree} onChange={e => { setComfortFree(e.target.value); if (e.target.value.trim()) setNoRestrictions(false); setComfortPreview(null) }} placeholder="e.g. Nothing sleeveless at work" />
          <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
            <input type="checkbox" checked={lowMaintenance} onChange={e => { setLowMaintenance(e.target.checked); setComfortPreview(null) }} />
            Prefer low-maintenance dressing (flag fussy pieces)
          </label>
          {comfortSelectionEmpty && (
            <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={noRestrictions} onChange={e => { setNoRestrictions(e.target.checked); setComfortPreview(null) }} />
              I confirm I have no hard restrictions — style me freely
            </label>
          )}
          {comfortPreview !== null && (
            <>
              <label style={label}>This is the rule text your stylist will follow — edit freely:</label>
              <textarea style={{ ...inputStyle, minHeight: 140, fontFamily: 'monospace', fontSize: 12.5 }} value={comfortPreview} onChange={e => setComfortPreview(e.target.value)} />
            </>
          )}
          {error && <div style={{ color: 'var(--repair)', fontSize: 13, marginTop: 10 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
            <button style={quietBtn} onClick={() => setStep('profile')}>Back</button>
            {comfortPreview === null ? (
              <button
                style={primaryBtn}
                disabled={comfortSelectionEmpty && !noRestrictions}
                title={comfortSelectionEmpty && !noRestrictions ? 'Pick your rules or confirm you have none' : undefined}
                onClick={() => setComfortPreview(composedComfort)}
              >Review my rules</button>
            ) : (
              <button style={primaryBtn} disabled={saving} onClick={() => saveLayer('body_contract', comfortPreview, 'aesthetic')}>{saving ? 'Saving…' : 'Save & continue'}</button>
            )}
          </div>
        </div>
      )}

      {step === 'aesthetic' && (
        <div style={card}>
          <h2 style={{ margin: '0 0 4px', fontSize: 21 }}>Your taste</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }}>
            Soft preferences — a center of gravity, never a fence. Skip anything you're unsure of;
            your stylist learns the rest from your feedback.
          </p>
          <label style={label}>Words that feel like your style</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {VIBE_CHIPS.map(v => (
              <button key={v} style={chipStyle(vibes.includes(v))} onClick={() => { setVibes(toggleIn(vibes, v)); setAestheticPreview(null) }}>{v}</button>
            ))}
          </div>
          <input style={{ ...inputStyle, marginTop: 10 }} value={vibeFree} onChange={e => { setVibeFree(e.target.value); setAestheticPreview(null) }} placeholder="…or your own words (e.g. urban artisan, quiet luxury)" />
          <label style={label}>Colors you gravitate toward (optional, exactly as you'd say it)</label>
          <input style={inputStyle} value={colorsLoved} onChange={e => { setColorsLoved(e.target.value); setAestheticPreview(null) }} placeholder="e.g. earthy greens, rust, cream" />
          <label style={label}>Colors you avoid (optional)</label>
          <input style={inputStyle} value={colorsAvoided} onChange={e => { setColorsAvoided(e.target.value); setAestheticPreview(null) }} placeholder="e.g. neon, pastel pink" />
          <label style={label}>Prints & pattern</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PRINT_OPTIONS.map(([key, text]) => (
              <button key={key} style={chipStyle(printAppetite === key)} onClick={() => { setPrintAppetite(key); setAestheticPreview(null) }}>{text}</button>
            ))}
          </div>
          <label style={label}>Anything else your stylist should know about your taste?</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={aestheticFree} onChange={e => { setAestheticFree(e.target.value); setAestheticPreview(null) }} placeholder="e.g. I dress for galleries more than offices" />
          {aestheticPreview !== null && (
            <>
              <label style={label}>Your taste, as your stylist will read it — edit freely:</label>
              <textarea style={{ ...inputStyle, minHeight: 150, fontFamily: 'monospace', fontSize: 12.5 }} value={aestheticPreview} onChange={e => setAestheticPreview(e.target.value)} />
            </>
          )}
          {error && <div style={{ color: 'var(--repair)', fontSize: 13, marginTop: 10 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
            <button style={quietBtn} onClick={() => setStep('comfort')}>Back</button>
            {aestheticPreview === null ? (
              <button style={primaryBtn} onClick={() => setAestheticPreview(composedAesthetic)}>Review</button>
            ) : (
              <button style={primaryBtn} disabled={saving} onClick={() => saveLayer('aesthetic_gravity', aestheticPreview, 'working')}>{saving ? 'Saving…' : 'Save & continue'}</button>
            )}
          </div>
        </div>
      )}

      {step === 'working' && (
        <div style={card}>
          <h2 style={{ margin: '0 0 4px', fontSize: 21 }}>One last thing</h2>
          <label style={label}>How direct do you want feedback?</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={chipStyle(directness === 'direct')} onClick={() => { setDirectness('direct'); setWorkingPreview(null) }}>Straight with me — if it doesn't work, say so</button>
            <button style={chipStyle(directness === 'gentle')} onClick={() => { setDirectness('gentle'); setWorkingPreview(null) }}>Encouraging — lead with what works</button>
          </div>
          {workingPreview !== null && (
            <>
              <label style={label}>Working style — edit freely:</label>
              <textarea style={{ ...inputStyle, minHeight: 110, fontFamily: 'monospace', fontSize: 12.5 }} value={workingPreview} onChange={e => setWorkingPreview(e.target.value)} />
            </>
          )}
          {error && <div style={{ color: 'var(--repair)', fontSize: 13, marginTop: 10 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
            <button style={quietBtn} onClick={() => setStep('aesthetic')}>Back</button>
            {workingPreview === null ? (
              <button style={primaryBtn} onClick={() => setWorkingPreview(composedWorking)}>Review</button>
            ) : (
              <button style={primaryBtn} disabled={saving} onClick={() => saveLayer('working_style', workingPreview, 'done')}>{saving ? 'Saving…' : 'Save & continue'}</button>
            )}
          </div>
        </div>
      )}

      {step === 'done' && (
        <div style={card}>
          <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>Your stylist is ready{displayName ? `, ${displayName.trim()}` : ''} 🎉</h2>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
            One thing left, and it's the big one: your stylist can only recommend clothes it knows
            you own. The fastest way in: batch-import photos of yourself wearing your clothes, a
            Google Takeout ZIP, or a video of your closet rail — duplicates get grouped and nothing
            is saved without your approval. You can also add pieces one at a time from the Wardrobe
            tab, and revisit everything you just wrote in Settings.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button style={quietBtn} disabled={saving} onClick={finish}>Skip for now</button>
            <button style={primaryBtn} disabled={saving} onClick={finishToImport}>Import my wardrobe</button>
          </div>
        </div>
      )}
    </div>
  )
}
