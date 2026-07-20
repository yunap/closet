import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../styles/landing.css'

// Spec 34 PR B — the public front door. Unauthenticated visitors land here; "Sign in"
// routes existing users to /login, and the invite form POSTs to the public
// /api/invite-requests endpoint (which feeds the same queue the operator reviews in
// /admin). Design ported from the approved landing artifact; the screenshots in
// public/landing/ are real captures from the demo-wardrobe session.
export default function Landing() {
  const navigate = useNavigate()
  const rootRef = useRef(null)
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [state, setState] = useState('idle') // idle | submitting | done | error
  const [errorMsg, setErrorMsg] = useState('')

  // Scroll-reveal, matched to prefers-reduced-motion (the CSS shows everything when reduced).
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll('.reveal') || []
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return }
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target) } })
    }, { threshold: 0.14 })
    els.forEach(e => io.observe(e))
    return () => io.disconnect()
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (state === 'submitting') return
    setState('submitting')
    setErrorMsg('')
    try {
      const res = await fetch('/api/invite-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, note }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not submit your request.')
      setState('done')
    } catch (err) {
      setState('error')
      setErrorMsg(err.message || 'Something went wrong. Please try again.')
    }
  }

  return (
    <div className="landing-root" ref={rootRef}>
      <header>
        <div className="wrap bar">
          <div className="mark">The Wardrobe <span>Room</span></div>
          <nav className="nav" aria-label="Primary">
            <a className="signin" href="/login" onClick={e => { e.preventDefault(); navigate('/login') }}>Sign in</a>
            <a className="req" href="#invite">Request an invite</a>
          </nav>
        </div>
      </header>

      <div className="wrap">
        <div className="hero">
          <div className="copy reveal">
            <div className="kicker" style={{ marginBottom: 14 }}>A personal stylist</div>
            <h1>A stylist who has <em>actually seen</em> your closet.</h1>
            <p className="lede">The Wardrobe Room learns every piece you own — then helps you get dressed from what's already hanging there. No shopping hauls. No outfits you can't actually put together.</p>
            <div className="cta-row">
              <a className="btn btn-primary" href="#invite">Request an invite</a>
              <a className="btn btn-ghost" href="#how">See how it works</a>
            </div>
            <p className="hero-note" style={{ marginTop: 18 }}>Private and invite-only, for now.</p>
          </div>
          <div className="look reveal">
            <div className="look-frame">
              <img src="/landing/hero.jpg" alt="An outfit styled from a real wardrobe: rust plaid midi skirt, cream knit, a printed silk scarf and burgundy suede boots, on an autumn street." />
              <div className="look-cap"><small>Styled by The Wardrobe Room</small>A warm-toned autumn look</div>
            </div>
            <div className="proof">
              <p className="label">Built from pieces already in the wardrobe</p>
              <div className="chips">
                <div className="chip"><img src="/landing/piece-skirt.jpg" alt="Rust plaid midi skirt" /></div>
                <div className="chip"><img src="/landing/piece-scarf.jpg" alt="Printed silk scarf" /></div>
                <div className="chip"><img src="/landing/piece-boots.jpg" alt="Burgundy suede ankle boots" /></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section id="how">
        <div className="wrap">
          <div className="feature">
            <div className="copy reveal">
              <p className="kicker">Your closet, catalogued</p>
              <h2>Every piece you own, in one place.</h2>
              <p className="lead-in">Photograph what's in your wardrobe and it gets sorted for you — category, colour, season, the works. No spreadsheets, no manual tagging. The result is a closet the stylist can actually reason about.</p>
              <p className="lead-in">This one holds 22 pieces: a couple of tailored anchors, denim, knitwear, two pairs of boots, and a few things with real colour.</p>
            </div>
            <div className="win reveal">
              <div className="chrome"><i /><i /><i /></div>
              <div className="scroll"><img src="/landing/wardrobe.jpg" alt="A grid of 22 wardrobe pieces, each a real photo." /></div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ background: 'var(--paper-2)', borderTop: '1px solid var(--edge)', borderBottom: '1px solid var(--edge)' }}>
        <div className="wrap">
          <div className="feature flip">
            <div className="copy reveal">
              <p className="kicker">Ask it anything</p>
              <h2>Like texting a friend who knows your wardrobe.</h2>
              <p className="lead-in">Tell it the day you're having — the weather, the plans, the mood — and it builds looks from pieces you already own, and explains why each one works.</p>
              <div className="pull">
                <p>&ldquo;Sneaker day in summer is honestly a dresses moment from your current wardrobe. One honest gap: you don't have a lightweight bottom that pairs with sneakers in the heat.&rdquo;</p>
                <div className="who">The Wardrobe Room, on a hot day</div>
              </div>
            </div>
            <div className="win tall reveal">
              <div className="chrome"><i /><i /><i /></div>
              <div className="scroll"><img src="/landing/sneakers.jpg" alt="A styling conversation proposing two sneaker looks and flagging a wardrobe gap." /></div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="feature">
            <div className="copy reveal">
              <p className="kicker">See it before you wear it</p>
              <h2>Any look, rendered on a figure.</h2>
              <p className="lead-in">When a look lands, it can render the whole outfit as a single image — your exact pieces, styled together — so you can judge the proportions before you get dressed.</p>
              <p className="lead-in">A cleaner, more classic pairing here: cream shirt, navy blazer, tailored trousers and boots for a rainy day of meetings.</p>
            </div>
            <div className="render-ex reveal">
              <span className="tag">Rendered outfit</span>
              <img src="/landing/render.jpg" alt="A rendered outfit: navy blazer, cream shirt, black trousers, ankle boots and a tan tote." />
            </div>
          </div>

          <div className="trio">
            <div className="step reveal"><div className="n">1</div><h3>Import your closet</h3><p>Snap photos of your pieces; they get tagged and organised automatically.</p></div>
            <div className="step reveal"><div className="n">2</div><h3>Ask for a look</h3><p>Describe the day. Get outfits built only from what you own, with the reasoning.</p></div>
            <div className="step reveal"><div className="n">3</div><h3>See it rendered</h3><p>Turn any look into a single styled image before you commit to it.</p></div>
          </div>
        </div>
      </section>

      <section className="invite" id="invite">
        <div className="wrap">
          <div className="invite-card reveal">
            <h2>Request an invite</h2>
            {state === 'done' ? (
              <div>
                <p className="serif" style={{ fontSize: 26, color: 'var(--brand)', margin: '8px 0 4px' }}>You're on the list.</p>
                <p className="sub">We'll email you the moment a spot opens up.</p>
              </div>
            ) : (
              <>
                <p className="sub">The Wardrobe Room is invite-only while it's small. Leave your details and we'll be in touch when a spot opens.</p>
                <form onSubmit={submit}>
                  <div className="field">
                    <label htmlFor="lp-email">Email</label>
                    <input id="lp-email" name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="lp-note">What made you curious? <span style={{ color: 'var(--ink-faint)' }}>(optional)</span></label>
                    <textarea id="lp-note" name="note" value={note} onChange={e => setNote(e.target.value)} />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={state === 'submitting'}>
                    {state === 'submitting' ? 'Sending…' : 'Request an invite'}
                  </button>
                </form>
                {state === 'error' && <p className="err">{errorMsg}</p>}
              </>
            )}
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot">
          <div className="mark" style={{ fontSize: 19 }}>The Wardrobe <span>Room</span></div>
          <div>A personal styling app · invite-only preview</div>
        </div>
      </footer>
    </div>
  )
}
