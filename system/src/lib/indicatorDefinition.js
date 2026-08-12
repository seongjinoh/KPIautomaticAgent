/** Lv3 공통 정의 + 지표마스터 상세·Ownership 덮어쓰기
 *  Ownership 그룹/부서: Lv3 기본, 마스터에 값이 있으면 덮어쓰기
 *  피평가그룹(group_code)과는 별개
 */

export const LV3_DEFINITION_FIELDS = [
  'definition_text',
  'calc_logic_text',
  'owner_group_code',
  'dept',
  'calc_cycle',
  'calc_timing',
  'data_source_kind',
  'data_source',
]

export const OWNERSHIP_OVERRIDE_FIELDS = ['owner_group_code', 'dept']

export const DATA_SOURCE_KINDS = ['Data Warehouse', '기타']

export const LV3_FIELD_META = {
  definition_text: { label: '지표정의', placeholder: '지표가 의미하는 바, 포함·제외 범위', rows: 3 },
  calc_logic_text: { label: '산출로직', placeholder: '산식·집계 기준 설명', rows: 3 },
  owner_group_code: { label: 'Ownership 그룹(주관그룹)', placeholder: '주관 그룹', rows: 1 },
  dept: { label: 'Ownership 부서(주관부서)', placeholder: '주관 부서명', rows: 1 },
  calc_cycle: { label: '산출주기', placeholder: '예: 월간, 분기, 반기, 연간', rows: 1 },
  calc_timing: { label: '산출시점', placeholder: '예: 월말, 영업일+2, 분기 마감 후', rows: 1 },
}

export const emptyLv3Definition = () => ({
  definition_text: '',
  calc_logic_text: '',
  owner_group_code: '',
  dept: '',
  calc_cycle: '',
  calc_timing: '',
  data_source_kind: '',
  data_source: '',
})

export const emptyMasterDefinition = () => ({
  detailed_definition_text: '',
  owner_group_code: '',
  dept: '',
})

/** @deprecated 호환용 */
export const emptyDefinition = () => ({
  ...emptyLv3Definition(),
  ...emptyMasterDefinition(),
})

/** @deprecated */
export const DEFINITION_FIELDS = [...LV3_DEFINITION_FIELDS, 'detailed_definition_text']

function trim(v) {
  return String(v ?? '').trim()
}

export function normalizeDataSourceKind(value) {
  const raw = trim(value)
  const low = raw.toLowerCase().replace(/[_-]/g, ' ')
  if (DATA_SOURCE_KINDS.includes(raw)) return raw
  if (['dw', 'data warehouse', 'warehouse', '데이터웨어하우스'].includes(low)) return 'Data Warehouse'
  if (['other', '기타', 'etc'].includes(low)) return '기타'
  return raw && DATA_SOURCE_KINDS.includes(raw) ? raw : (raw ? '기타' : '')
}

export function mergeIndicatorDefinition(lv3 = {}, master = {}) {
  const merged = {}
  const sources = {}
  LV3_DEFINITION_FIELDS.forEach((field) => {
    if (OWNERSHIP_OVERRIDE_FIELDS.includes(field)) {
      let b = trim(lv3[field])
      let o = trim(master[field])
      if (field === 'owner_group_code') {
        b = b.toUpperCase()
        o = o.toUpperCase()
      }
      if (o) {
        merged[field] = o
        sources[field] = 'master'
      } else {
        merged[field] = b
        sources[field] = b ? 'lv3' : ''
      }
      return
    }
    let b = trim(lv3[field])
    if (field === 'data_source_kind') b = normalizeDataSourceKind(b)
    merged[field] = b
    sources[field] = b ? 'lv3' : ''
  })
  const detail = trim(master.detailed_definition_text)
  merged.detailed_definition_text = detail
  sources.detailed_definition_text = detail ? 'master' : ''

  if (detail) {
    merged.definition_text_combined = merged.definition_text
      ? `${merged.definition_text}\n\n[상세] ${detail}`
      : detail
  } else {
    merged.definition_text_combined = merged.definition_text
  }

  const uLv3 = trim(lv3.unit)
  if (uLv3) {
    merged.unit = uLv3
    sources.unit = 'lv3'
  } else {
    merged.unit = ''
    sources.unit = ''
  }

  const filled = LV3_DEFINITION_FIELDS.filter((f) => merged[f]).length
  return {
    ...merged,
    sources,
    definition_filled: filled,
    definition_complete: filled >= 4,
  }
}

export function pickLv3DefinitionFromRow(row = {}) {
  const out = emptyLv3Definition()
  LV3_DEFINITION_FIELDS.forEach((f) => {
    out[f] = row[f] ?? ''
  })
  out.owner_group_code = trim(out.owner_group_code).toUpperCase()
  out.data_source_kind = normalizeDataSourceKind(out.data_source_kind)
  return out
}

export function pickMasterDefinitionFromRow(row = {}) {
  return {
    detailed_definition_text: trim(row.detailed_definition_text ?? ''),
    owner_group_code: trim(row.owner_group_code ?? '').toUpperCase(),
    dept: trim(row.dept ?? ''),
  }
}

/** @deprecated */
export function pickDefinitionFromRow(row = {}) {
  return { ...pickLv3DefinitionFromRow(row), ...pickMasterDefinitionFromRow(row) }
}

export function sourceLabel(source) {
  if (source === 'master') return '마스터'
  if (source === 'lv3') return 'Lv3'
  return '—'
}
