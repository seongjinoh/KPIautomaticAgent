/** 가공식 표시·피연산자 식별자 유틸 */

const IDENT_RE = /^[^\d\W]\w*$/u

export function isValidOperandKey(key) {
  return IDENT_RE.test(String(key || '').trim())
}

export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 식별자 단위로만 치환 (한글·영문 식별자 지원) */
export function replaceOperandIdent(expr, oldKey, newKey) {
  const from = String(oldKey || '')
  const to = String(newKey || '')
  if (!from || from === to) return String(expr || '')
  const re = new RegExp(`(?<![\\w])${escapeRegExp(from)}(?![\\w])`, 'gu')
  return String(expr || '').replace(re, to)
}

export function nextOperandKey(ops) {
  const used = new Set(Object.keys(ops || {}))
  for (let i = 1; i <= 99; i += 1) {
    const k = `항목${i}`
    if (!used.has(k)) return k
  }
  for (let i = 0; i < 26; i += 1) {
    const k = String.fromCharCode(65 + i)
    if (!used.has(k)) return k
  }
  return `V${used.size + 1}`
}

export function parseOperandsSafe(raw) {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw }
  try {
    const data = JSON.parse(raw)
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

function rowCode(row) {
  return String(row?.indicator_code || row?.indicatorCode || row?.code || '').trim().toUpperCase()
}

function rowName(row) {
  if (!row) return ''
  const candidates = [
    row.display_name,
    row.displayName,
    row.lv3_name,
    row.lv3Name,
    row.label,
    row.name,
  ]
  for (const v of candidates) {
    const s = String(v || '').trim()
    if (!s) continue
    // 코드 문자열만 들어있는 필드는 이름으로 쓰지 않음
    if (s.toUpperCase() === rowCode(row)) continue
    return s
  }
  return ''
}

export function nameForCode(codeCatalog, code) {
  const c = String(code || '').trim().toUpperCase()
  if (!c) return ''
  const hit = (codeCatalog || []).find((row) => rowCode(row) === c)
  return rowName(hit) || c
}

/**
 * 식의 피연산자를 `지표명(지표코드)` 형태로 치환한 표시 문자열.
 * 예: A/(A+B)*100 → RORWA(CAP-…)/(RORWA(CAP-…)+고객경험(CEX-…))*100
 */
export function formatFormulaDisplay(formula, codeCatalog = []) {
  if (!formula) return null
  const ops = parseOperandsSafe(formula.operands_json || formula.operands)
  let display = String(formula.expr || '').trim()
  if (!display) return null
  const keys = Object.keys(ops).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    const ref = String(ops[key] || '').trim()
    let replacement = ref
    if (/^[A-Z0-9]{2,4}-[A-Z0-9]{3,4}-\d{3,4}-[A-Z]{3}-[A-Z0-9]{2,4}$/i.test(ref)) {
      const code = ref.toUpperCase()
      const nm = nameForCode(codeCatalog, code)
      replacement = nm && nm !== code ? `${nm}(${code})` : code
    }
    display = replaceOperandIdent(display, key, replacement)
  }
  return {
    id: formula.id,
    name: formula.name || '',
    expr: formula.expr || '',
    display,
    use_yn: formula.use_yn || 'Y',
  }
}
