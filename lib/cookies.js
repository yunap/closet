// Spec 33 Part 2 — hand-rolled cookie handling. Express has no built-in cookie support;
// a single httpOnly session cookie doesn't need a dependency to parse/write.
const SESSION_COOKIE_NAME = 'wardrobe_session'
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60 // 30 days, mirrors systemDb's session TTL

export function parseCookies(req) {
  const header = req.headers?.cookie
  const cookies = {}
  if (!header) return cookies
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (!key) continue
    try { cookies[key] = decodeURIComponent(value) } catch { cookies[key] = value }
  }
  return cookies
}

export function getSessionToken(req) {
  return parseCookies(req)[SESSION_COOKIE_NAME] || null
}

export function setSessionCookie(res, rawToken) {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`
  ]
  if (process.env.TRUST_PROXY) attrs.push('Secure') // HTTPS-only once behind a reverse proxy
  res.setHeader('Set-Cookie', attrs.join('; '))
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
}

export { SESSION_COOKIE_NAME }
