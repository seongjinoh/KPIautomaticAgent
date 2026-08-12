/**
 * Vercel → 로컬 ngrok KPI API 프록시.
 * 브라우저(CORS/무료경고)를 피하고, 서버에서 ngrok-skip-browser-warning 헤더를 붙인다.
 *
 * 환경변수: KPI_UPSTREAM_BASE = https://xxxx.ngrok-free.dev  (끝 / 없이)
 */
const UPSTREAM = (process.env.KPI_UPSTREAM_BASE || '').replace(/\/$/, '')

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
}

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return undefined
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (!UPSTREAM) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({
      error: 'proxy_misconfigured',
      message: 'Vercel env KPI_UPSTREAM_BASE(ngrok URL)가 없습니다.',
    }))
    return
  }

  const parts = req.query.path
  const suffix = Array.isArray(parts) ? parts.join('/') : String(parts || '')
  const qIndex = req.url.indexOf('?')
  const qs = qIndex >= 0 ? req.url.slice(qIndex) : ''
  const target = `${UPSTREAM}/api/${suffix}${qs}`

  const headers = {
    'ngrok-skip-browser-warning': '1',
  }
  const ct = req.headers['content-type']
  if (ct) headers['content-type'] = ct
  const accept = req.headers.accept
  if (accept) headers.accept = accept

  let body
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await readRawBody(req)
  }

  let upstreamRes
  try {
    upstreamRes = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    })
  } catch (e) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({
      error: 'upstream_unreachable',
      message: `ngrok/로컬 API에 연결할 수 없습니다: ${e.message}`,
      upstream: UPSTREAM,
    }))
    return
  }

  res.statusCode = upstreamRes.status
  const passHeaders = ['content-type', 'content-disposition', 'content-length']
  for (const key of passHeaders) {
    const v = upstreamRes.headers.get(key)
    if (v) res.setHeader(key, v)
  }
  // same-origin이므로 CORS 불필요하지만, 로컬 디버그용으로 허용
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning')

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  const buf = Buffer.from(await upstreamRes.arrayBuffer())
  res.end(buf)
}
