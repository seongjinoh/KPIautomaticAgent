import { callLLM } from './llmService'

export function normalizeIndicatorName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\s()[\]{}·.,_\-/:'"`]/g, '')
}

function bigrams(s) {
  if (s.length < 2) return new Set(s ? [s] : [])
  const out = new Set()
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2))
  return out
}

function dice(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return a && a === b ? 1 : 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  return (2 * inter) / (A.size + B.size)
}

/** 이름이 비슷한 마스터 행 (Lv1/Lv2/Lv3 공통). UNIQUE가 아니라 저장 전 확인용. */
export function findSimilarNamedRows(rows, name, {
  limit = 8,
  minScore = 0.55,
  excludeCode,
  codeKey = 'code',
} = {}) {
  const q = normalizeIndicatorName(name)
  if (q.length < 2) return []
  const scored = []
  for (const row of rows || []) {
    const code = row?.[codeKey]
    if (excludeCode != null && String(code) === String(excludeCode)) continue
    const n = normalizeIndicatorName(row.name)
    if (!n) continue
    let score = dice(q, n)
    if (q === n) score = 1
    else if (n.includes(q) || q.includes(n)) score = Math.max(score, 0.86)
    if (score >= minScore) scored.push({ ...row, similarScore: score })
  }
  scored.sort((a, b) => (
    b.similarScore - a.similarScore
    || String(a[codeKey] || '').localeCompare(String(b[codeKey] || ''), 'ko')
  ))
  return scored.slice(0, limit)
}

/** 기존 Lv3 중 이름이 비슷한 항목. 추가 전 중복 확인용. */
export function findSimilarCommons(commons, name, opts = {}) {
  return findSimilarNamedRows(commons, name, { ...opts, codeKey: 'common_code' })
}

function parseJsonFromLlm(text) {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : raw).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('AI 응답을 JSON으로 해석하지 못했습니다.')
  }
  return JSON.parse(body.slice(start, end + 1))
}

function matchExisting(list, code, name) {
  const items = list || []
  const c = String(code || '').trim()
  if (c) {
    const hit = items.find((r) => String(r.code).toUpperCase() === c.toUpperCase())
    if (hit) return hit.code
  }
  const n = String(name || '').trim().replace(/\s+/g, '')
  if (!n) return ''
  const exact = items.find((r) => String(r.name || '').replace(/\s+/g, '') === n)
  if (exact) return exact.code
  const loose = items.find((r) => {
    const rn = String(r.name || '').replace(/\s+/g, '')
    return rn && (rn.includes(n) || n.includes(rn))
  })
  return loose ? loose.code : ''
}

export async function recommendLv3Classification({ name, lv1List, lv2List }) {
  const indicatorName = String(name || '').trim()
  if (!indicatorName) throw new Error('지표명을 먼저 입력하세요.')

  const lv1Catalog = (lv1List || [])
    .map((r) => `${r.code}\t${r.name}`)
    .join('\n')
  const lv2Catalog = (lv2List || [])
    .map((r) => `${r.code}\t${r.name}`)
    .join('\n')

  const systemPrompt = `당신은 은행 KPI 코드체계 설계 보조다.
주어진 기존 Lv1(대분류)·Lv2(중분류) 목록에서만 고른다. 새 코드를 만들어내지 않는다.
응답은 JSON 객체 하나만 출력한다. 설명·마크다운 금지.

필드:
- lv1_code, lv1_name: 기존 Lv1 중 최적
- lv2_code, lv2_name: 기존 Lv2 중 최적 (Lv1과 독립 마스터)
- unit: 원, %, 명, 건, 좌수, Point, bp 등 짧은 단위
- definition_text: 지표 정의 초안 (포함·제외 범위, 2~4문장)
- calc_logic_text: 산출로직 초안 (1~3문장)
- reason: 한 줄 선택 이유`

  const userPrompt = `지표명: ${indicatorName}

[Lv1 목록]
${lv1Catalog || '(없음)'}

[Lv2 목록]
${lv2Catalog || '(없음)'}

위 목록에서 이 지표명에 가장 잘 맞는 Lv1·Lv2를 고르고, 단위와 정의 초안을 JSON으로 답하라.`

  const text = await callLLM({ systemPrompt, userPrompt })
  const data = parseJsonFromLlm(text)

  const lv1_code = matchExisting(lv1List, data.lv1_code, data.lv1_name)
  const lv2_code = matchExisting(lv2List, data.lv2_code, data.lv2_name)

  return {
    lv1_code,
    lv2_code,
    unit: String(data.unit || '').trim(),
    definition_text: String(data.definition_text || '').trim(),
    calc_logic_text: String(data.calc_logic_text || '').trim(),
    reason: String(data.reason || '').trim(),
    lv1_unmatched: !lv1_code,
    lv2_unmatched: !lv2_code,
  }
}
