/** 표시단 숫자 포맷 — 저장값은 기본단위, 화면에서만 만/억/조 축약. 소수 둘째 자리 고정. */

const NO_SCALE_UNITS = new Set([
  '%', '%p', 'bp', '점', '배', '배수', '지수', '회',
])

export function toFixed2(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

export function formatFixed2(value) {
  const n = toFixed2(value)
  if (n == null) return '—'
  return n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function shouldScaleUnit(unit) {
  const u = String(unit || '').trim().toLowerCase()
  if (!u) return true
  if (NO_SCALE_UNITS.has(u)) return false
  if (u.endsWith('%') || u.includes('%p')) return false
  return true
}

/**
 * @returns {{ display: string, title?: string, raw: number|null }}
 */
export function formatMetricNumber(value, unit = '', { withUnit = false } = {}) {
  const n = toFixed2(value)
  if (n == null) return { display: '—', title: undefined, raw: null }

  const rawText = formatFixed2(n)
  const unitText = String(unit || '').trim()
  const title = unitText ? `${rawText} ${unitText}` : rawText

  let display = rawText
  if (shouldScaleUnit(unit)) {
    const abs = Math.abs(n)
    if (abs >= 1e12) display = `${(n / 1e12).toFixed(2)}조`
    else if (abs >= 1e8) display = `${(n / 1e8).toFixed(2)}억`
    else if (abs >= 1e4) display = `${(n / 1e4).toFixed(2)}만`
  }

  if (withUnit && unitText) {
    if (unitText === '%' || unitText === '%p') {
      if (!display.endsWith('%')) display = `${display}${unitText}`
    } else {
      display = `${display}${unitText}`
    }
  }

  return { display, title, raw: n }
}

/** 달성률·비중 등 % 표시 (항상 소수 2자리) */
export function formatPercentFixed(value, { signed = false } = {}) {
  const n = toFixed2(value)
  if (n == null) return '—'
  const sign = signed && n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}
