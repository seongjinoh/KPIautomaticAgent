/**
 * Vercel → 로컬 ngrok KPI API 프록시.
 * 브라우저 CORS/ngrok 무료경고를 피하고, 서버에서 skip 헤더를 붙인다.
 *
 * Env: KPI_UPSTREAM_BASE = https://xxxx.ngrok-free.dev  (끝 / 없이)
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

function resolveUpstreamPath(req) {
  const host = req.headers.host || 'localhost'
  const u = new URL(req.url || '/', `https://${host}`)
  let pathname = u.pathname || '/'

  // Vercel catch-all 함수는 /api/health 또는 /health 로 들어올 수 있음
  if (!pathname.startsWith('/api/') && pathname !== '/api') {
    const parts = req.query?.path
    if (parts != null) {
      const suffix = Array.isArray(parts) ? parts.join('/') : String(parts)
      pathname = `/api/${suffix}`
    } else if (pathname === '/' || pathname === '') {
      pathname = '/api/health'
    } else {
      pathname = `/api${pathname.startsWith('/') ? pathname : `/${pathname}`}`
    }
  }
  // Vercel catch-all이 붙이는 path 쿼리는 업스트림으로 넘기지 않음
  const params = new URLSearchParams(u.search || '')
  params.delete('path')
  const qs = params.toString()
  return `${pathname}${qs ? `?${qs}` : ''}`
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning')
    res.end()
    return
  }

  if (!UPSTREAM) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({
      error: 'proxy_misconfigured',
      message: 'Vercel env KPI_UPSTREAM_BASE(ngrok URL)가 없습니다.',
    }))
    return
  }

  const forwardPath = resolveUpstreamPath(req)
  const target = `${UPSTREAM}${forwardPath}`

  const headers = {
    'ngrok-skip-browser-warning': '1',
    'user-agent': 'kpi-vercel-proxy/1.0',
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
    res.setHeader('x-proxy-target', target)
    res.end(JSON.stringify({
      error: 'upstream_unreachable',
      message: `ngrok/로컬 API에 연결할 수 없습니다: ${e.message}`,
      upstream: UPSTREAM,
      target,
    }))
    return
  }

  res.statusCode = upstreamRes.status
  res.setHeader('x-proxy-target', target)
  const passHeaders = ['content-type', 'content-disposition', 'content-length']
  for (const key of passHeaders) {
    const v = upstreamRes.headers.get(key)
    if (v) res.setHeader(key, v)
  }
  res.setHeader('Access-Control-Allow-Origin', '*')

  const buf = Buffer.from(await upstreamRes.arrayBuffer())
  res.end(buf)
}
