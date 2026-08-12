import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { evalLabel } from '../lib/kpiDisplay'
import { api } from '../lib/apiClient'
import { formatFormulaDisplay } from '../lib/formulaDisplay'

function trim(v) {
  return String(v ?? '').trim()
}

/** 평가배치/실적표/코드북 row에서 지표정의 표시용 필드를 정규화 */
export function resolveIndicatorDefinition(source, codeCatalog = []) {
  if (!source) return null
  const code = trim(source.indicatorCode || source.indicator_code || source.code)
  const catalog = (codeCatalog || []).find(
    (c) => trim(c.indicatorCode || c.indicator_code) === code,
  )
  const merged = source.merged || catalog?.merged || {}
  const lv3 = source.lv3_definition || catalog?.lv3_definition || {}
  const master = source.master_definition || catalog?.master_definition || {}

  const label = trim(
    source.label
    || source.label26
    || evalLabel(source)
    || source.displayName
    || source.display_name,
  )
  const name = trim(
    source.name
    || catalog?.displayName
    || catalog?.display_name
    || source.lv3Name
    || source.lv3_name
    || catalog?.lv3Name
    || catalog?.lv3_name,
  )

  let definitionText = trim(
    source.definitionText
    || source.definition_text
    || merged.definition_text_combined
    || merged.definition_text
    || lv3.definition_text,
  )
  const detailed = trim(
    source.detailedDefinitionText
    || source.detailed_definition_text
    || merged.detailed_definition_text
    || master.detailed_definition_text,
  )
  if (detailed && !definitionText.includes(detailed)) {
    definitionText = definitionText
      ? `${definitionText}\n\n[상세] ${detailed}`
      : detailed
  }

  const hierarchy = [
    source.evalCategoryLv1 || source.eval_category_lv1 || source.category || '',
    source.evalCategoryLv2 || source.eval_category_lv2 || source.categoryL2 || '',
    source.evalCategoryLv3 || source.eval_category_lv3 || source.categoryL3 || '',
  ].map(trim).filter(Boolean)

  return {
    code,
    label: label || name || code || '지표',
    name,
    hierarchy,
    definitionText,
    calcLogicText: trim(
      source.calcLogicText
      || source.calc_logic_text
      || merged.calc_logic_text
      || lv3.calc_logic_text,
    ),
    ownerGroupCode: trim(
      source.owner_group_code
      || source.ownership_group_code
      || merged.owner_group_code
      || lv3.owner_group_code,
    ).toUpperCase(),
    ownershipDept: trim(
      source.ownership_dept
      || source.dept
      || merged.dept
      || lv3.dept,
    ),
    calcCycle: trim(source.calc_cycle || merged.calc_cycle || lv3.calc_cycle),
    calcTiming: trim(source.calc_timing || merged.calc_timing || lv3.calc_timing),
    dataSourceKind: trim(
      source.data_source_kind || merged.data_source_kind || lv3.data_source_kind,
    ),
    dataSource: trim(
      source.dataSource
      || source.data_source
      || merged.data_source
      || lv3.data_source,
    ),
    unit: trim(source.unit || merged.unit || catalog?.unit || ''),
  }
}

function Section({ title, children }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-[12px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  )
}

function MetaRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="shrink-0 w-24 text-slate-400">{label}</span>
      <span className="text-slate-700 break-words">{value}</span>
    </div>
  )
}

export default function IndicatorDefinitionPopup({ source, codeCatalog = [], onClose }) {
  const info = resolveIndicatorDefinition(source, codeCatalog)
  const [formulaView, setFormulaView] = useState(null)
  const [formulaLoading, setFormulaLoading] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    async function loadFormula() {
      const code = info?.code
      if (!code) {
        setFormulaView(null)
        return
      }
      setFormulaLoading(true)
      try {
        // 지표명은 API 코드북을 우선 사용 (레거시 codebook에는 이름/코드가 비어 있거나 코드만 있는 경우가 있음)
        const [fRes, cRes] = await Promise.all([
          api.listFactFormulas(),
          api.listCodes().catch(() => ({ items: [] })),
        ])
        if (cancelled) return
        const apiItems = cRes.items || []
        const catalog = apiItems.length ? apiItems : (codeCatalog || [])
        const hit = (fRes.items || []).find((f) => (
          String(f.use_yn || 'Y').toUpperCase() !== 'N'
          && String(f.output_indicator_code || '').toUpperCase() === String(code).toUpperCase()
        ))
        setFormulaView(hit ? formatFormulaDisplay(hit, catalog) : null)
      } catch {
        if (!cancelled) setFormulaView(null)
      } finally {
        if (!cancelled) setFormulaLoading(false)
      }
    }
    loadFormula()
    return () => { cancelled = true }
  }, [info?.code, codeCatalog])

  if (!info) return null

  const dataSourceLine = [info.dataSourceKind, info.dataSource].filter(Boolean).join(' · ')

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/35 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="indicator-definition-title"
        className="w-full max-w-xl max-h-[85vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-[1] flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-slate-400">지표정의</p>
            <h3 id="indicator-definition-title" className="truncate text-sm font-bold text-slate-800">
              {info.label}
            </h3>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              {[info.code, info.name && info.name !== info.label ? info.name : null]
                .filter(Boolean)
                .join(' · ') || '—'}
            </p>
            {info.hierarchy.length > 0 && (
              <p className="mt-1 truncate text-[10px] text-slate-400">
                {info.hierarchy.join(' › ')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <Section title="지표정의">
            {info.definitionText || <span className="text-slate-400">등록된 정의가 없습니다.</span>}
          </Section>
          <Section title="산출로직">
            {info.calcLogicText || <span className="text-slate-400">등록된 산출로직이 없습니다.</span>}
          </Section>

          <Section title="가공식">
            {formulaLoading && <span className="text-slate-400">조회 중…</span>}
            {!formulaLoading && !formulaView && (
              <span className="text-slate-400">이 지표를 출력으로 하는 가공식이 없습니다.</span>
            )}
            {!formulaLoading && formulaView && (
              <div className="space-y-2">
                {formulaView.name ? (
                  <p className="text-[11px] font-semibold text-violet-700">{formulaView.name}</p>
                ) : null}
                <p className="font-mono text-[12px] leading-5 text-slate-800 break-all">
                  {formulaView.display}
                </p>
                {formulaView.expr && formulaView.expr !== formulaView.display ? (
                  <p className="text-[10px] text-slate-400 font-mono break-all">
                    원식: {formulaView.expr}
                  </p>
                ) : null}
              </div>
            )}
          </Section>

          <div className="space-y-1.5 rounded-lg border border-slate-100 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">부가정보</p>
            <MetaRow label="단위" value={info.unit} />
            <MetaRow label="Ownership 그룹" value={info.ownerGroupCode} />
            <MetaRow label="Ownership 부서" value={info.ownershipDept} />
            <MetaRow label="산출주기" value={info.calcCycle} />
            <MetaRow label="산출시점" value={info.calcTiming} />
            <MetaRow label="원천" value={dataSourceLine} />
            {!info.unit && !info.ownerGroupCode && !info.ownershipDept
              && !info.calcCycle && !info.calcTiming && !dataSourceLine && (
              <p className="text-[11px] text-slate-400">부가정보가 없습니다.</p>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end border-t border-slate-100 bg-white px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
