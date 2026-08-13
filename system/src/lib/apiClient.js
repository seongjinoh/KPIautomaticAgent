const envBase = import.meta.env.VITE_API_BASE
// Vercel: VITE_API_BASE=same-origin → /api (Vercel serverless → ngrok)
// 로컬 dev: http://127.0.0.1:8787
const API_BASE = (() => {
  if (envBase === undefined || envBase === null || envBase === '') return 'http://127.0.0.1:8787'
  const raw = String(envBase).trim().replace(/\/$/, '')
  if (!raw || raw === 'same-origin' || raw === '/') return ''
  return raw
})()
const IS_LOCAL_API = API_BASE === 'http://127.0.0.1:8787'
const IS_REMOTE_API = !IS_LOCAL_API
const NGROK_HEADERS = /ngrok/i.test(API_BASE) ? { 'ngrok-skip-browser-warning': '1' } : {}
// Railway/Render 등 원격 API는 cold start·네트워크 지연에 대비해 재시도 (IS_REMOTE_API)

/** UI/에러 메시지용 */
const API_DISPLAY = API_BASE || (typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api')

/** 엑셀 다운로드 등 <a href>용 — 헤더를 못 넣으니 쿼리로도 우회 시도 */
function withNgrokBypass(url) {
  if (!/ngrok/i.test(String(url))) return url
  const sep = String(url).includes('?') ? '&' : '?'
  return `${url}${sep}ngrok-skip-browser-warning=1`
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 0) {
  if (!timeoutMs) return fetch(url, options)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function request(path, options = {}, retryOpts = {}) {
  const retries = retryOpts.retries ?? (IS_REMOTE_API ? 3 : 0)
  const timeoutMs = retryOpts.timeoutMs ?? (IS_REMOTE_API ? 90000 : 0)
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchWithTimeout(`${API_BASE}${path}`, {
        ...options,
        headers: {
          ...(options.body instanceof FormData || !options.body ? {} : { 'Content-Type': 'application/json' }),
          ...NGROK_HEADERS,
          ...(options.headers || {}),
        },
      }, timeoutMs)
      let data = null
      const text = await res.text()
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = { raw: text }
      }
      if (!res.ok) {
        const err = new Error(data?.message || data?.error || `HTTP ${res.status}`)
        err.status = res.status
        err.data = data
        throw err
      }
      return data
    } catch (e) {
      lastErr = e
      const retryable = attempt < retries && (
        e.name === 'AbortError'
        || e.message?.includes('Failed to fetch')
        || e.status === 502
        || e.status === 503
        || e.status === 504
      )
      if (!retryable) throw e
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  throw lastErr
}

export const api = {
  base: API_DISPLAY,
  apiBase: API_BASE,
  health: () => request('/api/health', {}, { retries: 4, timeoutMs: 120000 }),
  listLv1: () => request('/api/codes/lv1'),
  listLv2: (lv1) => request(`/api/codes/lv2${lv1 ? `?lv1=${encodeURIComponent(lv1)}` : ''}`),
  listGroups: (params = {}) => {
    const q = new URLSearchParams()
    if (params.evalOnly) q.set('eval_only', '1')
    const qs = q.toString()
    return request(`/api/owner-groups${qs ? `?${qs}` : ''}`)
  },
  listCommon: () => request('/api/indicators/common'),
  nextLv3: () => request('/api/indicators/common/next-lv3'),
  listCodes: (params = {}) => {
    const q = new URLSearchParams()
    if (params.group) q.set('group', params.group)
    if (params.common) q.set('common', params.common)
    const qs = q.toString()
    return request(`/api/indicators/codes${qs ? `?${qs}` : ''}`)
  },
  previewCode: (body) => request('/api/indicators/preview-code', { method: 'POST', body: JSON.stringify(body) }),
  createLv1: (body) => request('/api/codes/lv1', { method: 'POST', body: JSON.stringify(body) }),
  updateLv1: (code, body) => request(`/api/codes/lv1/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteLv1: (code) => request(`/api/codes/lv1/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  nextLv2: () => request('/api/codes/lv2/next'),
  createLv2: (body) => request('/api/codes/lv2', { method: 'POST', body: JSON.stringify(body) }),
  updateLv2: (code, body) => request(`/api/codes/lv2/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteLv2: (code) => request(`/api/codes/lv2/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  createGroup: (body) => request('/api/owner-groups', { method: 'POST', body: JSON.stringify(body) }),
  updateGroup: (code, body) => request(`/api/owner-groups/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteGroup: (code) => request(`/api/owner-groups/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  createCommon: (body) => request('/api/indicators/common', { method: 'POST', body: JSON.stringify(body) }),
  updateCommon: (code, body) => request(`/api/indicators/common/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteCommon: (code) => request(`/api/indicators/common/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  createCode: (body) => request('/api/indicators/codes', { method: 'POST', body: JSON.stringify(body) }),
  updateCode: (code, body) => request(`/api/indicators/codes/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteCode: (code) => request(`/api/indicators/codes/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  listEvalConfigs: ({ year, month, group } = {}) => {
    const q = new URLSearchParams()
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    if (group) q.set('group', group)
    return request(`/api/eval-configs?${q.toString()}`)
  },
  saveEvalConfigs: ({ year, month, items }) =>
    request(`/api/eval-configs?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
  saveEvalConfigSet: ({ year, effectiveMonth, items, changeReason }) =>
    request(`/api/eval-configs?year=${encodeURIComponent(year)}&month=${encodeURIComponent(effectiveMonth)}`, {
      method: 'PUT',
      body: JSON.stringify({ items, changeReason }),
    }),
  deleteEvalConfigSet: ({ planSetId }) =>
    request(`/api/eval-configs?planSetId=${encodeURIComponent(planSetId)}`, {
      method: 'DELETE',
    }),
  listEvalConfigHistory: ({ year }) => request(`/api/eval-configs/history?year=${encodeURIComponent(year)}`),
  listEvalYears: () => request('/api/eval-configs/years'),
  seedEvalDefaults: (body) => request('/api/eval-configs/seed-defaults', { method: 'POST', body: JSON.stringify(body) }),
  getEvalTemplateUrl: () => withNgrokBypass(`${API_BASE}/api/eval-configs/template`),
  getEvalExportUrl: ({ year, month } = {}) =>
    withNgrokBypass(`${API_BASE}/api/eval-configs/export?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`),
  importEvalConfigSet: async ({ year, month, file }) => {
    const form = new FormData()
    form.append('file', file)
    return request(`/api/eval-configs/import?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`, {
      method: 'POST',
      body: form,
    })
  },
  importCodes: async (file) => {
    if (!file) {
      return request('/api/codes/import', { method: 'POST', body: '{}' })
    }
    const form = new FormData()
    form.append('file', file)
    return request('/api/codes/import', { method: 'POST', body: form })
  },
  getCodesExportUrl: () => withNgrokBypass(`${API_BASE}/api/codes/export`),
  refreshFacts: ({ year, month }) =>
    request(`/api/facts/refresh?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`, {
      method: 'POST',
      body: '{}',
    }),
  listAchievements: ({ year, month, group } = {}) => {
    const q = new URLSearchParams()
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    if (group) q.set('group', group)
    return request(`/api/achievements?${q.toString()}`)
  },
  listGroupScores: ({ year, month } = {}) => {
    const q = new URLSearchParams()
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    return request(`/api/group-scores?${q.toString()}`)
  },
  recomputeGroupScores: ({ year, month } = {}) =>
    request(`/api/group-scores/recompute?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`, {
      method: 'POST',
      body: '{}',
    }),
  listScoreRollups: ({ year, month } = {}) => {
    const q = new URLSearchParams()
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    return request(`/api/score-rollups?${q.toString()}`)
  },
  saveScoreRollups: ({ year, month, rules, changeReason } = {}) =>
    request(`/api/score-rollups?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`, {
      method: 'POST',
      body: JSON.stringify({ rules, changeReason: changeReason || '' }),
    }),
  listFactCollect: ({ year, month, ym } = {}) => {
    const q = new URLSearchParams()
    if (ym) q.set('ym', ym)
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    return request(`/api/facts/collect?${q.toString()}`)
  },
  listFactCalc: ({ year, month, group, ym } = {}) => {
    const q = new URLSearchParams()
    if (ym) q.set('ym', ym)
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    if (group) q.set('group', group)
    return request(`/api/facts/calc?${q.toString()}`)
  },
  listFactFormulas: () => request('/api/fact-formulas'),
  createFactFormula: (body) => request('/api/fact-formulas', { method: 'POST', body: JSON.stringify(body) }),
  updateFactFormula: (id, body) => request(`/api/fact-formulas/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteFactFormula: (id) => request(`/api/fact-formulas/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  previewFactFormula: ({ year, month, group, ...body } = {}) => {
    const q = new URLSearchParams()
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    if (group) q.set('group', group)
    return request(`/api/fact-formulas/preview?${q.toString()}`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },
  runBankExport: ({ year, month, triggeredBy = 'api' } = {}) =>
    request(`/api/bank-export?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`, {
      method: 'POST',
      body: JSON.stringify({ triggered_by: triggeredBy }),
    }),
  listBankExportHistory: ({ year } = {}) => {
    const q = new URLSearchParams()
    if (year != null) q.set('year', year)
    return request(`/api/bank-export/history?${q.toString()}`)
  },
  listBankExportItems: (batchId) =>
    request(`/api/bank-export/${encodeURIComponent(batchId)}/items`),
  getFactUploadTemplateUrl: () => withNgrokBypass(`${API_BASE}/api/facts/upload-template`),
  uploadFactsPreview: async (file) => {
    if (!file) throw new Error('엑셀 파일이 필요합니다')
    const form = new FormData()
    form.append('file', file)
    return request('/api/facts/upload', { method: 'POST', body: form })
  },
  /** @deprecated use uploadFactsPreview + confirmFactUpload */
  uploadFacts: async (file) => {
    if (!file) throw new Error('엑셀 파일이 필요합니다')
    const form = new FormData()
    form.append('file', file)
    return request('/api/facts/upload', { method: 'POST', body: form })
  },
  confirmFactUpload: (batchId, { actedBy = 'ui' } = {}) =>
    request(`/api/facts/uploads/${encodeURIComponent(batchId)}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ acted_by: actedBy }),
    }),
  cancelFactUpload: (batchId, { actedBy = 'ui' } = {}) =>
    request(`/api/facts/uploads/${encodeURIComponent(batchId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ acted_by: actedBy }),
    }),
  listFactUploads: ({ limit = 50 } = {}) => {
    const q = new URLSearchParams()
    if (limit != null) q.set('limit', limit)
    return request(`/api/facts/uploads?${q.toString()}`)
  },
  listFactUploadItems: (batchId) =>
    request(`/api/facts/uploads/${encodeURIComponent(batchId)}/items`),
  listFactUploadLogs: (batchId) =>
    request(`/api/facts/uploads/${encodeURIComponent(batchId)}/logs`),
  exportPendingFactUploads: ({ triggeredBy = 'ui' } = {}) =>
    request('/api/facts/uploads/export-pending', {
      method: 'POST',
      body: JSON.stringify({ triggered_by: triggeredBy }),
    }),
  listDeptFactDepts: ({ year, month } = {}) => {
    const q = new URLSearchParams()
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    return request(`/api/facts/dept-entry/depts?${q.toString()}`)
  },
  getFactPeriodStatus: ({ year, month } = {}) => {
    const q = new URLSearchParams()
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    return request(`/api/facts/period-status?${q.toString()}`)
  },
  listDeptFactEntries: ({ year, month, dept, group, scope } = {}) => {
    const q = new URLSearchParams()
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    if (scope) q.set('scope', scope)
    if (dept) q.set('dept', dept)
    if (group) q.set('group', group)
    return request(`/api/facts/dept-entry?${q.toString()}`)
  },
  saveDeptFactEntries: ({
    year, month, dept, group, scope, updates, actedBy = 'ui', actorRole = '',
  } = {}) => {
    const q = new URLSearchParams()
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    if (scope) q.set('scope', scope)
    if (dept) q.set('dept', dept)
    if (group) q.set('group', group)
    return request(`/api/facts/dept-entry?${q.toString()}`, {
      method: 'POST',
      body: JSON.stringify({
        updates,
        acted_by: actedBy,
        actor_role: actorRole,
        dept,
        group_code: group,
        scope,
        scope_all: scope === 'all',
      }),
    })
  },
  confirmGroupFacts: ({ year, month, group, actedBy = 'ui', note = '' } = {}) =>
    request('/api/facts/group-confirm', {
      method: 'POST',
      body: JSON.stringify({
        year, month, group_code: group, acted_by: actedBy, note,
      }),
    }),
  revokeGroupFacts: ({ year, month, group, actedBy = 'ui', note = '' } = {}) =>
    request('/api/facts/group-confirm/revoke', {
      method: 'POST',
      body: JSON.stringify({
        year, month, group_code: group, acted_by: actedBy, note,
      }),
    }),
  freezeFactPeriod: ({ year, month, actedBy = 'ui', note = '', requireAllConfirmed = false } = {}) =>
    request('/api/facts/period/freeze', {
      method: 'POST',
      body: JSON.stringify({
        year, month, acted_by: actedBy, note, require_all_confirmed: requireAllConfirmed,
      }),
    }),
  unfreezeFactPeriod: ({ year, month, actedBy = 'ui', note = '' } = {}) =>
    request('/api/facts/period/unfreeze', {
      method: 'POST',
      body: JSON.stringify({ year, month, acted_by: actedBy, note }),
    }),
  getDeptFactExportUrl: ({ year, month, dept, group, scope } = {}) => {
    const q = new URLSearchParams()
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    if (scope) q.set('scope', scope)
    if (dept) q.set('dept', dept)
    if (group) q.set('group', group)
    return withNgrokBypass(`${API_BASE}/api/facts/dept-entry/export?${q.toString()}`)
  },
  importDeptFactEntries: async (file, {
    year, month, dept, group, scope, actorRole = '',
  } = {}) => {
    if (!file) throw new Error('엑셀 파일이 필요합니다')
    const q = new URLSearchParams()
    if (year != null) q.set('year', year)
    if (month != null) q.set('month', month)
    if (scope) q.set('scope', scope)
    if (dept) q.set('dept', dept)
    if (group) q.set('group', group)
    if (actorRole) q.set('actor_role', actorRole)
    const form = new FormData()
    form.append('file', file)
    return request(`/api/facts/dept-entry/import?${q.toString()}`, { method: 'POST', body: form })
  },
}
