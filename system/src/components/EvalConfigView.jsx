import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Plus, Pencil, Trash2, RotateCcw, X, Calculator, History, Download, Upload, ArrowUp, ArrowDown, ChevronDown } from 'lucide-react'
import {
  ACHIEVEMENT_MODES,
  ACHIEVEMENT_PRESETS,
  DIRECTION_LABELS,
  GOAL_DIRECTIONS,
  MODE_LABELS,
  buildMonthlyTargetPreview,
  calculateAchievementRate,
  enrichEvalConfigEntry,
} from '../lib/achievementEngine'
import ScoreRollupPanel from './ScoreRollupPanel'
import IndicatorDefinitionPopup from './IndicatorDefinitionPopup'
import { filterEvalGroups } from '../lib/orgGroup'

const EVAL_FIELD_LABELS = {
  weight: '비중(%)', evalCategoryLv1: '평가 Lv1',
  evalCategoryLv2: '평가 Lv2', evalCategoryLv3: '평가 Lv3', groupCode: '피평가그룹',
  label: '평가 표시명', unit: '단위', annualTarget: '연간목표',
  capMax: '지표 상한', capMin: '지표 하한', scoreRule: '승수', adjBand: '조정구간', penaltyRule: '조정승수',
  collectType: '수집방식', dept: 'Ownership 부서',
}

const emptyEvalDraft = {
  indicatorCode: '', mgmtTool: 'KPI', weight: 0, isCore: false,
  contributionMode: 'WEIGHT',
  evalCategoryLv1: '', evalCategoryLv2: '', evalCategoryLv3: '', groupCode: '', groupName: '',
  label: '', unit: '', annualTarget: 0, monthlyTarget: 0, baselineActual: 0,
  collectType: '', dept: '', dataSource: '',
  definitionText: '', calcLogicText: '',
  h1Target: null, h2Target: null, scoreRule: '', adjBand: '', penaltyRule: '', capMax: null, capMin: null, remark: '',
  filters: {},
  achievementMode: ACHIEVEMENT_MODES.LINEAR,
  goalDirection: GOAL_DIRECTIONS.INCREASE,
  customAchievementExpr: '',
  customMonthlyTargets: null,
  customTargetMode: 'auto',
  sortOrder: 0,
}

const rowGroupCode = (r) => String(r.groupCode || r.group_code || '').trim()
const rowLv1 = (r) => String(r.evalCategoryLv1 || r.eval_category_lv1 || r.category || '(미분류)')
const rowLv2 = (r) => String(r.evalCategoryLv2 || r.eval_category_lv2 || '(미분류)')
const rowLv3 = (r) => String(r.evalCategoryLv3 || r.eval_category_lv3 || '(미분류)')
const rowSort = (r, fallback = 0) => {
  const n = Number(r?.sortOrder ?? r?.sort_order)
  return Number.isFinite(n) ? n : fallback
}

/** 이동 후 전체 leaf에 0..n-1 sortOrder 재부여 (트리 순회 순서) */
function renumberAllSortOrders(list) {
  const indexed = list.map((r, i) => ({ r, i }))
  const groupMap = new Map()
  for (const item of indexed) {
    const g = rowGroupCode(item.r) || '(NO_GROUP)'
    if (!groupMap.has(g)) groupMap.set(g, [])
    groupMap.get(g).push(item)
  }
  const minG = (items) => Math.min(...items.map(x => rowSort(x.r, x.i)))
  const groups = [...groupMap.entries()].sort((a, b) => minG(a[1]) - minG(b[1]) || String(a[0]).localeCompare(String(b[0]), 'ko'))

  const orderedIdx = []
  for (const [, items] of groups) {
    const lv1Map = new Map()
    for (const item of items) {
      const k1 = rowLv1(item.r)
      if (!lv1Map.has(k1)) lv1Map.set(k1, new Map())
      const lv2Map = lv1Map.get(k1)
      const k2 = rowLv2(item.r)
      if (!lv2Map.has(k2)) lv2Map.set(k2, new Map())
      const lv3Map = lv2Map.get(k2)
      const k3 = rowLv3(item.r)
      if (!lv3Map.has(k3)) lv3Map.set(k3, [])
      lv3Map.get(k3).push(item)
    }
    const minNode = (node) => {
      if (Array.isArray(node)) return Math.min(...node.map(x => rowSort(x.r, x.i)))
      let m = Number.MAX_SAFE_INTEGER
      for (const v of node.values()) m = Math.min(m, minNode(v))
      return m
    }
    const sortMap = (map) => [...map.entries()].sort((a, b) => minNode(a[1]) - minNode(b[1]) || String(a[0]).localeCompare(String(b[0]), 'ko'))
    for (const [, lv2Map] of sortMap(lv1Map)) {
      for (const [, lv3Map] of sortMap(lv2Map)) {
        for (const [, leaves] of sortMap(lv3Map)) {
          leaves.sort((a, b) => rowSort(a.r, a.i) - rowSort(b.r, b.i) || a.i - b.i)
          for (const leaf of leaves) orderedIdx.push(leaf.i)
        }
      }
    }
  }
  return list.map((r, i) => {
    const order = orderedIdx.indexOf(i)
    const sortOrder = order >= 0 ? order : i
    return { ...r, sortOrder, sort_order: sortOrder }
  })
}

function swapSiblingBlocks(list, siblings, currentKey, direction) {
  const pos = siblings.findIndex(s => s.key === currentKey)
  const swapPos = pos + direction
  if (pos < 0 || swapPos < 0 || swapPos >= siblings.length) return null
  const nextSiblings = siblings.slice()
  const tmp = nextSiblings[pos]
  nextSiblings[pos] = nextSiblings[swapPos]
  nextSiblings[swapPos] = tmp

  const blockLeaves = []
  for (const sib of nextSiblings) {
    const leaves = [...sib.leafIndices].sort((a, b) => rowSort(list[a], a) - rowSort(list[b], b) || a - b)
    blockLeaves.push(...leaves)
  }
  const base = Math.min(...blockLeaves.map(i => rowSort(list[i], i)))
  const next = list.map(r => ({ ...r }))
  blockLeaves.forEach((i, offset) => {
    next[i] = { ...next[i], sortOrder: base + offset * 0.001 }
  })
  return renumberAllSortOrders(next)
}

function buildSiblings(list, keyFn, filterFn) {
  const map = new Map()
  list.forEach((r, i) => {
    if (!filterFn(r)) return
    const key = keyFn(r)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(i)
  })
  return [...map.entries()]
    .map(([key, leafIndices]) => ({
      key,
      leafIndices: [...leafIndices].sort((a, b) => rowSort(list[a], a) - rowSort(list[b], b) || a - b),
      min: Math.min(...leafIndices.map(i => rowSort(list[i], i))),
    }))
    .sort((a, b) => a.min - b.min || String(a.key).localeCompare(String(b.key), 'ko'))
}

/* ── 하이어러키 트리 테이블 (KPI 실적표 패턴 + 표시순서) ── */
function EvalTreeTable({
  rows,
  isEditingSet,
  onEdit,
  onRemove,
  onAddUnder,
  onRemoveMany,
  onMove,
  ownerGroupNameByCode = {},
  onShowDefinition,
}) {
  const [collapsed, setCollapsed] = useState({})

  const toggle = (key) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  const resolveGroupName = useCallback((groupCode, groupName = '') => {
    const code = String(groupCode || '').trim().toUpperCase()
    const fromItem = String(groupName || '').trim()
    if (fromItem && fromItem !== code) return fromItem
    return ownerGroupNameByCode[code] || fromItem || ''
  }, [ownerGroupNameByCode])

  const sortKey = (r, fallback = 0) => {
    const n = Number(r?.sortOrder ?? r?.sort_order)
    return Number.isFinite(n) ? n : fallback
  }

  const groupsTree = useMemo(() => {
    const groupMap = new Map()
    for (const cfg of rows) {
      const gCode = rowGroupCode(cfg)
      const gName = resolveGroupName(gCode, cfg.groupName || cfg.group_name) || String(cfg.groupName || cfg.group_name || '').trim()
      const gKey = gCode || '(NO_GROUP)'

      if (!groupMap.has(gKey)) {
        groupMap.set(gKey, {
          groupCode: gCode,
          groupName: gName,
          tree: new Map(),
        })
      }
      const g = groupMap.get(gKey)
      if (!g.groupName && gName) g.groupName = gName

      const lv1 = cfg.evalCategoryLv1 || cfg.category || '(미분류)'
      const lv2 = cfg.evalCategoryLv2 || '(미분류)'
      const lv3 = cfg.evalCategoryLv3 || '(미분류)'

      if (!g.tree.has(lv1)) g.tree.set(lv1, new Map())
      const m2 = g.tree.get(lv1)
      if (!m2.has(lv2)) m2.set(lv2, new Map())
      const m3 = m2.get(lv2)
      if (!m3.has(lv3)) m3.set(lv3, [])
      m3.get(lv3).push(cfg)
    }

    const minOrder = (node) => {
      if (Array.isArray(node)) {
        if (!node.length) return Number.MAX_SAFE_INTEGER
        return Math.min(...node.map((r, i) => sortKey(r, i)))
      }
      let m = Number.MAX_SAFE_INTEGER
      for (const v of node.values()) m = Math.min(m, minOrder(v))
      return m
    }

    const sortedEntries = (map) => [...map.entries()].sort((a, b) => {
      const d = minOrder(a[1]) - minOrder(b[1])
      if (d !== 0) return d
      return String(a[0]).localeCompare(String(b[0]), 'ko')
    })

    return [...groupMap.entries()].map(([gKey, g]) => {
      const lv1Sorted = sortedEntries(g.tree).map(([lv1, lv2Map]) => {
        const lv2Sorted = sortedEntries(lv2Map).map(([lv2, lv3Map]) => {
          const lv3Sorted = sortedEntries(lv3Map).map(([lv3, items]) => [
            lv3,
            [...items].sort((a, b) => sortKey(a, a._idx) - sortKey(b, b._idx) || String(a.indicatorCode || '').localeCompare(String(b.indicatorCode || ''))),
          ])
          return [lv2, new Map(lv3Sorted)]
        })
        return [lv1, new Map(lv2Sorted)]
      })
      return {
        gKey,
        groupCode: g.groupCode,
        groupName: resolveGroupName(g.groupCode, g.groupName) || g.groupName,
        tree: new Map(lv1Sorted),
      }
    }).sort((a, b) => minOrder(a.tree) - minOrder(b.tree))
  }, [rows, resolveGroupName])

  const groupLabel = (groupCode, groupName) => {
    const name = resolveGroupName?.(groupCode, groupName) || String(groupName || '').trim()
    if (groupCode && name && name !== groupCode) return `${groupCode} ${name}`
    return groupCode || name || '—'
  }

  const countChildren = (node) => {
    if (Array.isArray(node)) return node.length
    let c = 0
    for (const v of node.values()) c += countChildren(v)
    return c
  }

  const sumWeight = (node) => {
    if (Array.isArray(node)) {
      const raw = node.reduce((s, r) => {
        const mode = String(r.contributionMode || r.contribution_mode || 'WEIGHT').toUpperCase()
        if (mode === 'ADJUST') return s
        return s + (Number(r.weight) || 0)
      }, 0)
      return Math.round(raw * 100) / 100
    }
    let w = 0
    for (const v of node.values()) w += sumWeight(v)
    return Math.round(w * 100) / 100
  }

  const fmtWeight = (value) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return '0.00'
    return (Math.round(n * 100) / 100).toFixed(2)
  }

  const fmtCell = (value) => {
    if (value == null || value === '') return '—'
    const n = Number(value)
    if (Number.isFinite(n) && String(value).trim() !== '') {
      return (Math.round(n * 100) / 100).toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    }
    return String(value)
  }

  const collectIndices = (node) => {
    if (Array.isArray(node)) return node.map(r => r._idx).filter(v => Number.isInteger(v))
    let out = []
    for (const v of node.values()) out = out.concat(collectIndices(v))
    return out
  }

  const allCollapseKeys = useMemo(() => {
    const keys = []
    for (const { gKey, tree } of groupsTree) {
      keys.push(`g:${gKey}`)
      for (const [lv1, lv2Map] of tree) {
        keys.push(`g:${gKey}|lv1:${lv1}`)
        for (const [lv2, lv3Map] of lv2Map) {
          keys.push(`g:${gKey}|lv2:${lv1}/${lv2}`)
          for (const [lv3] of lv3Map) {
            keys.push(`g:${gKey}|lv3:${lv1}/${lv2}/${lv3}`)
          }
        }
      }
    }
    return keys
  }, [groupsTree])

  const expandAll = () => setCollapsed({})
  const collapseAll = () => {
    const next = {}
    for (const k of allCollapseKeys) next[k] = true
    setCollapsed(next)
  }

  const TD = 'border-b border-r border-slate-200 px-2 py-1 align-middle'
  const TD_G = 'border-b border-r border-slate-700 px-2 py-1 align-middle'
  const TD_L1 = 'border-b border-r border-slate-200 px-2 py-1 align-middle'
  const TD_L2 = 'border-b border-r border-slate-200 px-2 py-1 align-middle'
  const TD_L3 = 'border-b border-r border-slate-200 px-2 py-1 align-middle'
  const colCount = 12
  // 목표방향·산정로직 뒤 표시순서는 OrderControls, 이후 수치 6칸
  const metricDashes = (borderCls) => (
    <>
      <td className={`${borderCls} text-center text-[10px] text-slate-400`}>—</td>
      <td className={`${borderCls} text-center text-[10px] text-slate-400`}>—</td>
      <td className={`${borderCls} text-center text-[10px] text-slate-400`}>—</td>
      <td className={`${borderCls} text-center text-[10px] text-slate-400`}>—</td>
      <td className={`${borderCls} text-center text-[10px] text-slate-400`}>—</td>
      <td className={`${borderCls} text-center text-[10px] text-slate-400`}>—</td>
    </>
  )

  const ActionBtns = ({ onAdd, onDelete, light = false }) => {
    if (!isEditingSet) return <span className={light ? 'text-slate-500' : 'text-slate-300'}>—</span>
    return (
      <div className="flex items-center justify-center gap-0.5">
        {onAdd && (
          <button type="button" onClick={onAdd} className={`rounded p-1 ${light ? 'text-slate-200 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100'}`} title="하위 추가">
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={onDelete} className={`rounded p-1 ${light ? 'text-rose-300 hover:bg-rose-500/20' : 'text-rose-500 hover:bg-rose-50'}`} title="하위 삭제">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  }

  const OrderControls = ({ pos, total, light = false, onMoveDir }) => {
    if (!isEditingSet) {
      return <span className={`block text-center text-[10px] ${light ? 'text-slate-400' : 'text-slate-400'}`}>—</span>
    }
    const canUp = pos > 0
    const canDown = pos >= 0 && pos < total - 1
    return (
      <div className="flex items-center justify-center gap-0.5">
        <button
          type="button"
          disabled={!canUp}
          onClick={() => canUp && onMoveDir?.(-1)}
          className={`rounded p-0.5 disabled:cursor-default disabled:opacity-30 ${light ? 'text-slate-200 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100'}`}
          title="위로"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canDown}
          onClick={() => canDown && onMoveDir?.(1)}
          className={`rounded p-0.5 disabled:cursor-default disabled:opacity-30 ${light ? 'text-slate-200 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100'}`}
          title="아래로"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  const tableRows = []
  const groupEntries = groupsTree

  for (let gi = 0; gi < groupEntries.length; gi += 1) {
    const { gKey, groupCode, groupName, tree } = groupEntries[gi]
    const groupKey = `g:${gKey}`
    const groupCollapsed = !!collapsed[groupKey]
    const groupCount = countChildren(tree)
    const groupWeight = sumWeight(tree)
    const groupLabelStr = groupLabel(groupCode, groupName)

    tableRows.push(
      <tr key={groupKey} className="bg-slate-800 text-white">
        <td className={`${TD_G} sticky left-0 z-[1] bg-slate-800 pl-3`}>
          <button type="button" onClick={() => toggle(groupKey)} className="flex w-full items-center gap-1.5 text-left">
            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-slate-500 bg-slate-700 text-[8px] text-white">
              {groupCollapsed ? '▸' : '▾'}
            </span>
            <span className="text-[10px] font-semibold text-white">{groupLabelStr}</span>
            <span className="text-[9px] font-medium text-slate-300">({groupCount})</span>
          </button>
        </td>
        <td className={`${TD_G} whitespace-nowrap text-right text-[10px] font-semibold tabular-nums text-white`}>{fmtWeight(groupWeight)}%</td>
        <td className={`${TD_G} text-center text-[10px] text-slate-400`}>—</td>
        <td className={`${TD_G} text-center text-[10px] text-slate-400`}>—</td>
        <td className={TD_G}>
          <OrderControls
            light
            pos={gi}
            total={groupEntries.length}
            onMoveDir={(dir) => onMove?.({ kind: 'group', path: { groupCode }, direction: dir })}
          />
        </td>
        {metricDashes(TD_G)}
        <td className={`${TD_G} border-r-0 text-center`}>
          <ActionBtns
            light
            onAdd={() => onAddUnder({ groupCode, groupName, lv1: '', lv2: '', lv3: '' })}
            onDelete={groupCount > 0 ? () => onRemoveMany(collectIndices(tree)) : undefined}
          />
        </td>
      </tr>,
    )
    if (groupCollapsed) continue

    const lv1Entries = [...tree.entries()]
    for (let i1 = 0; i1 < lv1Entries.length; i1 += 1) {
      const [lv1, lv2Map] = lv1Entries[i1]
      const lv1Key = `g:${gKey}|lv1:${lv1}`
      const lv1Collapsed = !!collapsed[lv1Key]
      const lv1Count = countChildren(lv2Map)
      const lv1Weight = sumWeight(lv2Map)

      tableRows.push(
        <tr key={lv1Key} className="bg-slate-200 text-slate-800">
          <td className={`${TD_L1} sticky left-0 z-[1] bg-slate-200 pl-7`}>
            <button type="button" onClick={() => toggle(lv1Key)} className="flex w-full items-center gap-1.5 text-left">
              <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-slate-400 bg-slate-100 text-[8px] text-slate-600">
                {lv1Collapsed ? '▸' : '▾'}
              </span>
              <span className="text-[10px] font-semibold text-slate-900">{lv1}</span>
              <span className="text-[9px] font-medium text-slate-600">({lv1Count})</span>
            </button>
          </td>
          <td className={`${TD_L1} whitespace-nowrap text-right text-[10px] font-semibold tabular-nums`}>{fmtWeight(lv1Weight)}%</td>
          <td className={`${TD_L1} text-center text-[10px] text-slate-400`}>—</td>
          <td className={`${TD_L1} text-center text-[10px] text-slate-400`}>—</td>
          <td className={TD_L1}>
            <OrderControls
              pos={i1}
              total={lv1Entries.length}
              onMoveDir={(dir) => onMove?.({ kind: 'lv1', path: { groupCode, lv1 }, direction: dir })}
            />
          </td>
          {metricDashes(TD_L1)}
          <td className={`${TD_L1} border-r-0 text-center`}>
            <ActionBtns
              onAdd={() => onAddUnder({ groupCode, groupName, lv1, lv2: '', lv3: '' })}
              onDelete={() => onRemoveMany(collectIndices(lv2Map))}
            />
          </td>
        </tr>,
      )
      if (lv1Collapsed) continue

      const lv2Entries = [...lv2Map.entries()]
      for (let i2 = 0; i2 < lv2Entries.length; i2 += 1) {
        const [lv2, lv3Map] = lv2Entries[i2]
        const lv2Key = `g:${gKey}|lv2:${lv1}/${lv2}`
        const lv2Collapsed = !!collapsed[lv2Key]
        const lv2Count = countChildren(lv3Map)
        const lv2Weight = sumWeight(lv3Map)

        tableRows.push(
          <tr key={lv2Key} className="bg-slate-100 text-slate-700">
            <td className={`${TD_L2} sticky left-0 z-[1] bg-slate-100 pl-11`}>
              <button type="button" onClick={() => toggle(lv2Key)} className="flex w-full items-center gap-1.5 text-left">
                <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-[8px] text-slate-500">
                  {lv2Collapsed ? '▸' : '▾'}
                </span>
                <span className="text-[10px] font-semibold">{lv2}</span>
                <span className="text-[9px] font-medium text-slate-500">({lv2Count})</span>
              </button>
            </td>
            <td className={`${TD_L2} whitespace-nowrap text-right text-[10px] font-semibold tabular-nums`}>{fmtWeight(lv2Weight)}%</td>
            <td className={`${TD_L2} text-center text-[10px] text-slate-400`}>—</td>
            <td className={`${TD_L2} text-center text-[10px] text-slate-400`}>—</td>
            <td className={TD_L2}>
              <OrderControls
                pos={i2}
                total={lv2Entries.length}
                onMoveDir={(dir) => onMove?.({ kind: 'lv2', path: { groupCode, lv1, lv2 }, direction: dir })}
              />
            </td>
            {metricDashes(TD_L2)}
            <td className={`${TD_L2} border-r-0 text-center`}>
              <ActionBtns
                onAdd={() => onAddUnder({ groupCode, groupName, lv1, lv2, lv3: '' })}
                onDelete={() => onRemoveMany(collectIndices(lv3Map))}
              />
            </td>
          </tr>,
        )
        if (lv2Collapsed) continue

        const lv3Entries = [...lv3Map.entries()]
        for (let i3 = 0; i3 < lv3Entries.length; i3 += 1) {
          const [lv3, items] = lv3Entries[i3]
          const lv3Key = `g:${gKey}|lv3:${lv1}/${lv2}/${lv3}`
          const lv3Collapsed = !!collapsed[lv3Key]
          const lv3Weight = sumWeight(items)

          tableRows.push(
            <tr key={lv3Key} className="bg-slate-50 text-slate-700">
              <td className={`${TD_L3} sticky left-0 z-[1] bg-slate-50 pl-14`}>
                <button type="button" onClick={() => toggle(lv3Key)} className="flex w-full items-center gap-1.5 text-left">
                  <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-[8px] text-slate-500">
                    {lv3Collapsed ? '▸' : '▾'}
                  </span>
                  <span className="text-[10px] font-semibold">{lv3}</span>
                  <span className="text-[9px] font-medium text-slate-500">({items.length})</span>
                </button>
              </td>
              <td className={`${TD_L3} whitespace-nowrap text-right text-[10px] font-semibold tabular-nums`}>{fmtWeight(lv3Weight)}%</td>
              <td className={`${TD_L3} text-center text-[10px] text-slate-400`}>—</td>
              <td className={`${TD_L3} text-center text-[10px] text-slate-400`}>—</td>
              <td className={TD_L3}>
                <OrderControls
                  pos={i3}
                  total={lv3Entries.length}
                  onMoveDir={(dir) => onMove?.({ kind: 'lv3', path: { groupCode, lv1, lv2, lv3 }, direction: dir })}
                />
              </td>
              {metricDashes(TD_L3)}
              <td className={`${TD_L3} border-r-0 text-center`}>
                <ActionBtns
                  onAdd={() => onAddUnder({ groupCode, groupName, lv1, lv2, lv3 })}
                  onDelete={() => onRemoveMany(items.map(r => r._idx).filter(v => Number.isInteger(v)))}
                />
              </td>
            </tr>,
          )
          if (lv3Collapsed) continue

          for (let li = 0; li < items.length; li += 1) {
            const cfg = items[li]
            const code = cfg.indicatorCode || cfg.code || ''
            const masterName = cfg.lv3Name || cfg.lv3_name || cfg.displayName || cfg.display_name || ''
            tableRows.push(
              <tr key={`leaf-${code}-${cfg._idx}`} className="group/row bg-white transition-colors hover:bg-blue-50/40">
                <td className={`sticky left-0 z-[1] bg-white group-hover/row:bg-blue-50 ${TD} pl-[4.5rem]`}>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {cfg.isCore && (
                        <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-[8px] font-bold text-amber-700">Core</span>
                      )}
                      <p
                        className="truncate text-[11px] font-medium leading-tight text-slate-800 cursor-help"
                        title="더블클릭: 지표정의 보기"
                        onDoubleClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onShowDefinition?.(cfg)
                        }}
                      >
                        {cfg.label || cfg.displayName || <span className="italic text-slate-400">표시명 없음</span>}
                      </p>
                    </div>
                    <p className="mt-0.5 truncate text-[9px] leading-tight text-slate-400">
                      {[code, masterName].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                </td>
                <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums text-slate-700`}>{fmtWeight(cfg.weight)}%</td>
                <td className={`${TD} text-center text-[10px] font-semibold text-slate-600`}>{DIRECTION_LABELS[cfg.goalDirection] || '증가'}</td>
                <td className={`${TD} text-center text-[10px] font-semibold text-slate-600`}>{MODE_LABELS[cfg.achievementMode] || 'Linear'}</td>
                <td className={TD}>
                  <OrderControls
                    pos={li}
                    total={items.length}
                    onMoveDir={(dir) => onMove?.({ kind: 'leaf', path: { idx: cfg._idx }, direction: dir })}
                  />
                </td>
                <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums text-slate-700`}>{fmtCell(cfg.annualTarget ?? cfg.annual_target)}</td>
                <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums text-slate-600`}>{fmtCell(cfg.capMin ?? cfg.cap_min)}</td>
                <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums text-slate-600`}>{fmtCell(cfg.capMax ?? cfg.cap_max)}</td>
                <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums text-slate-600`}>{fmtCell(cfg.scoreRule || cfg.score_rule)}</td>
                <td className={`${TD} whitespace-nowrap text-center text-[10px] text-slate-600`}>{fmtCell(cfg.adjBand || cfg.adj_band)}</td>
                <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums text-slate-600`}>{fmtCell(cfg.penaltyRule || cfg.penalty_rule)}</td>
                <td className={`${TD} border-r-0 text-center`}>
                  {isEditingSet ? (
                    <div className="flex items-center justify-center gap-0.5">
                      <button type="button" onClick={() => onEdit(cfg)} className="rounded p-1 text-slate-500 hover:bg-slate-100" title="수정">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => onRemove(cfg._idx)} className="rounded p-1 text-rose-500 hover:bg-rose-50" title="삭제">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>,
            )
          }
        }
      }
    }
  }

  const HEADERS = ['평가체계', '비중', '목표방향', '산정로직', '표시순서', '연간목표', '지표 하한', '지표 상한', '승수', '조정구간', '조정승수', '관리']

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-end gap-1 border-b border-slate-200 bg-slate-50/50 px-3 py-1">
        <button type="button" onClick={expandAll} className="rounded px-2 py-1 text-[9px] font-medium text-slate-500 hover:bg-white hover:text-slate-800">모두 펼치기</button>
        <span className="h-3 w-px bg-slate-200" />
        <button type="button" onClick={collapseAll} className="rounded px-2 py-1 text-[9px] font-medium text-slate-500 hover:bg-white hover:text-slate-800">모두 접기</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] table-fixed border-separate border-spacing-0 text-[10px]">
          <colgroup>
            <col className="w-[280px]" />
            <col className="w-[64px]" />
            <col className="w-[64px]" />
            <col className="w-[72px]" />
            <col className="w-[72px]" />
            <col className="w-[88px]" />
            <col className="w-[72px]" />
            <col className="w-[72px]" />
            <col className="w-[56px]" />
            <col className="w-[72px]" />
            <col className="w-[64px]" />
            <col className="w-[64px]" />
          </colgroup>
          <thead>
            <tr className="text-[9px]">
              {HEADERS.map((h, i) => (
                <th
                  key={h}
                  className={`border-b border-slate-600 bg-slate-900 px-2 py-2 text-center font-semibold text-white ${i === 0 ? 'sticky left-0 z-10 border-r' : i === HEADERS.length - 1 ? '' : 'border-r'}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.length > 0 ? tableRows : (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center text-sm text-slate-400">평가배치가 비어 있습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function EvalConfigView({
  selectedYear,
  selectedMonth,
  yearOptions = [],
  onYearChange,
  onMonthChange,
  resolvedMeta = {},
  evalRows: monthlyEvalRows = [],
  historyRows = [],
  templateUrl = '',
  exportUrl = '',
  codeCatalog = [],
  onRefreshCodeCatalog,
  ownerGroupRows = [],
  onSaveEvalSet,
  onSeedDefaults,
  onImportEvalSet,
  onDeleteEvalSet,
}) {
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [evalQ, setEvalQ] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [isEditingSet, setIsEditingSet] = useState(false)
  const [workingRows, setWorkingRows] = useState([])
  const [isEvalEditorOpen, setIsEvalEditorOpen] = useState(false)
  const [editingEvalIdx, setEditingEvalIdx] = useState(null)
  const [evalDraft, setEvalDraft] = useState(emptyEvalDraft)
  const [indicatorSearchInput, setIndicatorSearchInput] = useState('')
  const [indicatorSearch, setIndicatorSearch] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [previewActual, setPreviewActual] = useState(100)
  const [previewMonth, setPreviewMonth] = useState(selectedMonth)
  const [definitionSource, setDefinitionSource] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    setPreviewMonth(selectedMonth)
  }, [selectedMonth])

  useEffect(() => {
    if (!isEditingSet) {
      setWorkingRows(monthlyEvalRows || [])
    }
  }, [monthlyEvalRows, isEditingSet])

  const ownerGroups = useMemo(() => {
    const rows = filterEvalGroups(Array.isArray(ownerGroupRows) ? ownerGroupRows : [])
    return [...rows]
      .filter((g) => String(g?.code || '').trim())
      .sort((a, b) => Number(a.sort_order ?? a.sortOrder ?? 0) - Number(b.sort_order ?? b.sortOrder ?? 0)
        || String(a.code).localeCompare(String(b.code)))
  }, [ownerGroupRows])

  const ownerGroupNameByCode = useMemo(() => {
    const map = {}
    ownerGroups.forEach((g) => {
      const code = String(g.code || '').trim().toUpperCase()
      if (!code) return
      map[code] = String(g.name || '').trim()
    })
    return map
  }, [ownerGroups])

  const resolveGroupName = useCallback((groupCode, groupName = '') => {
    const code = String(groupCode || '').trim().toUpperCase()
    const fromItem = String(groupName || '').trim()
    if (fromItem && fromItem !== code) return fromItem
    return ownerGroupNameByCode[code] || fromItem || ''
  }, [ownerGroupNameByCode])

  const applyOwnerGroup = (groupCode) => {
    const code = String(groupCode || '').trim().toUpperCase()
    const name = resolveGroupName(code, '')
    setEvalDraft((prev) => {
      const mode = code === 'SHB' ? 'WEIGHT' : (prev.contributionMode || 'WEIGHT')
      return {
        ...prev,
        groupCode: code,
        groupName: name,
        group: name || code,
        contributionMode: mode,
        weight: String(mode).toUpperCase() === 'ADJUST' ? 0 : prev.weight,
      }
    })
  }

  const groupFilterOptions = useMemo(() => {
    const map = new Map()
    for (const r of workingRows || []) {
      const code = rowGroupCode(r)
      if (!code) continue
      if (!map.has(code)) {
        map.set(code, {
          code,
          name: resolveGroupName(code, r.groupName || r.group_name),
        })
      }
    }
    return [...map.values()].sort((a, b) => {
      const la = a.name && a.name !== a.code ? `${a.code} ${a.name}` : a.code
      const lb = b.name && b.name !== b.code ? `${b.code} ${b.name}` : b.code
      return la.localeCompare(lb, 'ko')
    })
  }, [workingRows, ownerGroupNameByCode])

  const filteredEvalRows = useMemo(() => {
    let list = (workingRows || []).map((cfg, idx) => ({ ...cfg, _idx: idx }))
    if (groupFilter) {
      list = list.filter(r => rowGroupCode(r) === groupFilter)
    }
    if (!evalQ.trim()) return list
    const s = evalQ.trim().toLowerCase()
    return list.filter(r => {
      return [
        r.code, r.indicatorCode, r.evalCategoryLv1, r.evalCategoryLv2, r.evalCategoryLv3,
        r.groupCode, r.groupName, r.label, r.dept, r.displayName,
      ]
        .filter(Boolean).join(' ').toLowerCase().includes(s)
    })
  }, [workingRows, evalQ, groupFilter])

  useEffect(() => {
    if (groupFilter && !groupFilterOptions.some(g => g.code === groupFilter)) {
      setGroupFilter('')
    }
  }, [groupFilter, groupFilterOptions])

  const deferredEvalDraft = useDeferredValue(evalDraft)
  const evalPreview = useMemo(() => {
    const enriched = enrichEvalConfigEntry({
      ...deferredEvalDraft,
      year: selectedYear,
      monthlyTargets: deferredEvalDraft.monthlyTarget != null
        ? { [selectedMonth]: Number(deferredEvalDraft.monthlyTarget) || 0 }
        : deferredEvalDraft.customMonthlyTargets,
      code: deferredEvalDraft.indicatorCode,
    })
    const targets = buildMonthlyTargetPreview(enriched, selectedYear)
    const monthTarget = targets.find(t => t.month === previewMonth)?.target
    const achievement = monthTarget != null
      ? calculateAchievementRate(enriched, previewActual, previewMonth, selectedYear)
      : null
    return { targets, monthTarget, achievement }
  }, [deferredEvalDraft, previewActual, previewMonth, selectedYear, selectedMonth])

  const filteredCatalog = useMemo(() => {
    const base = (codeCatalog || []).filter((m) => (m.use_yn || 'Y') !== 'N')
    const evalGroup = (evalDraft.groupCode || '').trim().toUpperCase()
    const s = indicatorSearch.trim().toLowerCase()
    let list = base
    if (s) {
      list = base.filter(m =>
        [m.display_name, m.indicator_code, m.common_code, m.group_code, m.group_name, m.lv1_name, m.lv2_name, m.lv3_name]
          .filter(Boolean).join(' ').toLowerCase().includes(s)
      )
    }
    // 동일 소유그룹 지표를 앞에, 타그룹 지표도 선택 가능(교차편성)
    if (evalGroup) {
      list = [...list].sort((a, b) => {
        const aSame = String(a.group_code || '').toUpperCase() === evalGroup ? 0 : 1
        const bSame = String(b.group_code || '').toUpperCase() === evalGroup ? 0 : 1
        return aSame - bSame
      })
    }
    return list
  }, [codeCatalog, indicatorSearch, evalDraft.groupCode])

  const refreshCatalog = async () => {
    if (!onRefreshCodeCatalog) return
    setCatalogLoading(true)
    try {
      await onRefreshCodeCatalog()
    } finally {
      setCatalogLoading(false)
    }
  }

  const commitIndicatorSearch = () => {
    setIndicatorSearch(indicatorSearchInput.trim())
    setCatalogOpen(true)
  }

  const openEvalCreate = async () => {
    setEditingEvalIdx(null)
    setEvalDraft({ ...emptyEvalDraft })
    setIndicatorSearchInput('')
    setIndicatorSearch('')
    setCatalogOpen(false)
    setFeedback('')
    setError('')
    setIsEvalEditorOpen(true)
    await refreshCatalog()
  }

  const openEvalCreateUnder = async ({ groupCode, groupName, lv1, lv2, lv3 } = {}) => {
    const code = (groupCode || '').trim().toUpperCase()
    const name = resolveGroupName(code, groupName)
    setEditingEvalIdx(null)
    setEvalDraft({
      ...emptyEvalDraft,
      groupCode: code,
      groupName: name,
      group: name || code,
      evalCategoryLv1: lv1 || '',
      evalCategoryLv2: lv2 || '',
      evalCategoryLv3: lv3 || '',
      label: '',
      indicatorCode: '',
      code: '',
    })
    setIndicatorSearchInput('')
    setIndicatorSearch('')
    setCatalogOpen(false)
    setPreviewActual(100)
    setPreviewMonth(selectedMonth)
    setFeedback('')
    setError('')
    setIsEvalEditorOpen(true)
    await refreshCatalog()
  }

  const openEvalEdit = async (cfg) => {
    setEditingEvalIdx(cfg._idx)
    const groupCode = String(cfg.groupCode || cfg.group_code || '').trim().toUpperCase()
    const groupName = resolveGroupName(groupCode, cfg.groupName || cfg.group_name)
    const d = enrichEvalConfigEntry({
      ...emptyEvalDraft,
      ...cfg,
      groupCode,
      groupName,
      group: groupName || groupCode,
      isCore: Boolean(cfg.isCore ?? (String(cfg.is_core || '').toUpperCase() === 'Y')),
    })
    setEvalDraft(d)
    setPreviewActual(Number(d.annualTarget) || 100)
    setPreviewMonth(selectedMonth)
    setIndicatorSearchInput('')
    setIndicatorSearch('')
    setCatalogOpen(false)
    setIsEvalEditorOpen(true)
    await refreshCatalog()
  }

  const applyPreset = (preset) => {
    setEvalDraft(prev => ({
      ...prev,
      customAchievementExpr: preset.expr,
      goalDirection: preset.direction,
      achievementMode: ACHIEVEMENT_MODES.CUSTOM,
    }))
  }

  const updateCustomMonthTarget = (month, value) => {
    setEvalDraft(prev => ({
      ...prev,
      customMonthlyTargets: {
        ...(prev.customMonthlyTargets || {}),
        [month]: value === '' ? '' : Number(value),
      },
      customTargetMode: 'manual',
    }))
  }

  const fillLinearTargetsToCustom = () => {
    const enriched = enrichEvalConfigEntry({ ...evalDraft, year: selectedYear, achievementMode: ACHIEVEMENT_MODES.LINEAR })
    const targets = buildMonthlyTargetPreview(enriched, selectedYear)
    const customMonthlyTargets = Object.fromEntries(targets.map(t => [t.month, t.target]))
    setEvalDraft(prev => ({ ...prev, customMonthlyTargets, customTargetMode: 'manual' }))
  }

  const saveEvalDraft = () => {
    if (!evalDraft.indicatorCode) {
      setFeedback('지표코드를 선택해 주세요.')
      return
    }
    const groupCode = String(evalDraft.groupCode || '').trim().toUpperCase()
    if (!groupCode) {
      setFeedback('소유그룹을 선택해 주세요.')
      return
    }
    const groupName = resolveGroupName(groupCode, evalDraft.groupName)
    const entry = enrichEvalConfigEntry({
      ...evalDraft,
      groupCode,
      groupName,
      group: groupName || groupCode,
      mgmtTool: 'KPI',
      year: selectedYear,
      month: selectedMonth,
      code: evalDraft.indicatorCode,
      monthlyTargets: evalDraft.monthlyTarget != null ? { [selectedMonth]: Number(evalDraft.monthlyTarget) || 0 } : evalDraft.customMonthlyTargets,
    })
    delete entry._idx
    const nextConfig = [...(workingRows || [])]
    if (editingEvalIdx == null) nextConfig.push({ ...entry, sortOrder: nextConfig.length })
    else nextConfig[editingEvalIdx] = entry
    setWorkingRows(nextConfig)
    setFeedback(editingEvalIdx == null ? '편집중 셋에 행을 추가했습니다.' : '편집중 셋의 행을 수정했습니다.')
    setIsEvalEditorOpen(false)
  }

  const removeEvalRow = (originalIdx) => {
    if (!window.confirm('선택한 평가배치를 삭제할까요?')) return
    setWorkingRows((workingRows || []).filter((_, i) => i !== originalIdx))
    setError('')
    setFeedback('편집중 셋에서 행을 삭제했습니다.')
  }

  const removeEvalRowsMany = (indices) => {
    const uniq = [...new Set((indices || []).filter(v => Number.isInteger(v)))]
    if (!uniq.length) return
    if (!window.confirm(`하위 ${uniq.length}건을 삭제할까요?`)) return
    const set = new Set(uniq)
    setWorkingRows((workingRows || []).filter((_, i) => !set.has(i)))
    setError('')
    setFeedback(`하위 ${uniq.length}건을 삭제했습니다.`)
  }

  const sameEvalPath = (a, b) => (
    rowGroupCode(a) === rowGroupCode(b)
    && rowLv1(a) === rowLv1(b)
    && rowLv2(a) === rowLv2(b)
    && rowLv3(a) === rowLv3(b)
  )

  const moveEvalNode = ({ kind, path, direction }) => {
    setWorkingRows((prev) => {
      const list = (prev || []).map((r, i) => ({
        ...r,
        sortOrder: rowSort(r, i),
      }))
      let siblings
      let currentKey
      if (kind === 'group') {
        siblings = buildSiblings(list, (r) => rowGroupCode(r) || '(NO_GROUP)', () => true)
        currentKey = path.groupCode || '(NO_GROUP)'
      } else if (kind === 'lv1') {
        siblings = buildSiblings(
          list,
          (r) => rowLv1(r),
          (r) => rowGroupCode(r) === String(path.groupCode || '').trim(),
        )
        currentKey = path.lv1
      } else if (kind === 'lv2') {
        siblings = buildSiblings(
          list,
          (r) => rowLv2(r),
          (r) => rowGroupCode(r) === String(path.groupCode || '').trim() && rowLv1(r) === path.lv1,
        )
        currentKey = path.lv2
      } else if (kind === 'lv3') {
        siblings = buildSiblings(
          list,
          (r) => rowLv3(r),
          (r) => (
            rowGroupCode(r) === String(path.groupCode || '').trim()
            && rowLv1(r) === path.lv1
            && rowLv2(r) === path.lv2
          ),
        )
        currentKey = path.lv3
      } else if (kind === 'leaf') {
        const row = list[path.idx]
        if (!row) return prev
        siblings = list
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => sameEvalPath(r, row))
          .sort((a, b) => rowSort(a.r, a.i) - rowSort(b.r, b.i) || a.i - b.i)
          .map(({ i }) => ({ key: String(i), leafIndices: [i], min: rowSort(list[i], i) }))
        currentKey = String(path.idx)
      } else {
        return prev
      }
      const next = swapSiblingBlocks(list, siblings, currentKey, direction)
      return next || prev
    })
  }

  const selectIndicatorForEval = (m) => {
    const merged = m.merged || {}
    const dataSource = [merged.data_source_kind, merged.data_source].filter(Boolean).join(' / ')
    setCatalogOpen(false)
    setIndicatorSearchInput('')
    setIndicatorSearch('')
    setEvalDraft(prev => ({
      ...prev,
      indicatorCode: m.indicator_code || '',
      code: m.indicator_code || '',
      label: prev.label || m.display_name || '',
      unit: prev.unit || merged.unit || m.unit || '',
      displayName: m.display_name || '',
      lv3Name: m.lv3_name || m.lv3Name || '',
      dataSource: prev.dataSource || dataSource || '',
      definitionText: prev.definitionText || merged.definition_text_combined || merged.definition_text || '',
      calcLogicText: prev.calcLogicText || merged.calc_logic_text || '',
      collectType: prev.collectType || '',
      dept: prev.dept || merged.dept || '',
      remark: prev.remark || '',
    }))
    setIndicatorSearch('')
  }

  const startEditSet = () => {
    setWorkingRows((monthlyEvalRows || []).map((r, i) => ({
      ...r,
      sortOrder: Number.isFinite(Number(r.sortOrder ?? r.sort_order)) ? Number(r.sortOrder ?? r.sort_order) : i,
    })))
    setIsEditingSet(true)
    setFeedback('')
    setError('')
  }

  const cancelEditSet = () => {
    if (!window.confirm('현재 편집 중인 변경사항을 버릴까요?')) return
    setWorkingRows(monthlyEvalRows || [])
    setIsEditingSet(false)
    setIsEvalEditorOpen(false)
  }

  const saveWholeSet = async () => {
    const raw = window.prompt('이 변경을 몇 월 평가부터 적용할까요? (1-12)', String(selectedMonth))
    if (raw == null) return
    const effectiveMonth = Number(raw)
    if (!Number.isInteger(effectiveMonth) || effectiveMonth < 1 || effectiveMonth > 12) {
      setError('적용 시작월은 1~12여야 합니다.')
      return
    }
    const changeReason = window.prompt('변경 사유를 입력해 주세요. (선택)', '') ?? ''
    try {
      setError('')
      // 저장 직전 순번 확정 + snake/camel 동기화 (서버가 옛 sort_order를 쓰지 않도록)
      const itemsToSave = renumberAllSortOrders(
        (workingRows || []).map((r, i) => ({ ...r, sortOrder: rowSort(r, i) })),
      )
      setWorkingRows(itemsToSave)
      await onSaveEvalSet({ effectiveMonth, items: itemsToSave, changeReason })
      setIsEditingSet(false)
      const viewNote = selectedMonth < effectiveMonth
        ? ` (현재 조회월 ${selectedMonth}월은 적용 시작월 ${effectiveMonth}월보다 이전이므로 화면에 바로 반영되지 않을 수 있습니다)`
        : ''
      setFeedback(`${selectedYear}년 ${effectiveMonth}월 적용 배치셋으로 저장했습니다.${viewNote}`)
    } catch (e) {
      setError(e?.data?.message || e?.message || '셋 저장 실패')
    }
  }

  const handleImportClick = () => fileInputRef.current?.click()

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!window.confirm(`${selectedYear}년 ${selectedMonth}월 적용 배치셋으로 엑셀 업로드 내용을 저장할까요?`)) return
    try {
      setError('')
      await onImportEvalSet(file)
      setIsEditingSet(false)
      setFeedback('엑셀 업로드로 배치셋을 저장했습니다.')
    } catch (e) {
      setError(e?.data?.message || e?.message || '엑셀 업로드 실패')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          {yearOptions.length ? (
            <select
              value={selectedYear ?? ''}
              onChange={e => onYearChange(Number(e.target.value))}
              className="text-sm font-semibold bg-transparent outline-none cursor-pointer text-slate-800"
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              value={selectedYear ?? ''}
              onChange={e => onYearChange(Number(e.target.value))}
              placeholder="연도"
              className="w-24 text-sm font-semibold bg-transparent outline-none text-slate-800"
              title="평가배치가 없어 연도를 직접 입력합니다"
            />
          )}
        </div>
        <select value={selectedMonth} onChange={e => onMonthChange(Number(e.target.value))} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
        </select>
        <select
          value={groupFilter}
          onChange={e => setGroupFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white min-w-[160px]"
          title="그룹별 평가체계 필터"
        >
          <option value="">전체 그룹</option>
          {groupFilterOptions.map(g => (
            <option key={g.code} value={g.code}>
              {g.name && g.name !== g.code ? `${g.code} ${g.name}` : g.code}
            </option>
          ))}
        </select>
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="search" placeholder="지표, 코드, 그룹, 카테고리 검색" value={evalQ} onChange={e => setEvalQ(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        {!isEditingSet ? (
          <button onClick={startEditSet} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm">
            <Pencil className="w-4 h-4" /> 수정 시작
          </button>
        ) : (
          <>
            <button onClick={openEvalCreate} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm">
              <Plus className="w-4 h-4" /> 행 추가
            </button>
            <button onClick={saveWholeSet} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-white text-sm">
              <History className="w-4 h-4" /> 적용월 저장
            </button>
            <button onClick={cancelEditSet} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm">
              <X className="w-4 h-4" /> 편집 취소
            </button>
          </>
        )}
        <button
          onClick={async () => {
            if (!window.confirm(`${selectedYear}년 ${selectedMonth}월 기준 기본 배치셋을 생성할까요?`)) return
            try { await onSeedDefaults(); setFeedback('기본값을 생성했습니다.'); setError('') } catch (e) { setError(e?.data?.message || e?.message || '초기화 실패') }
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm"
        >
          <RotateCcw className="w-4 h-4" /> 기본값 생성
        </button>
        <a
          href={exportUrl || undefined}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm ${exportUrl ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-400 pointer-events-none'}`}
        >
          <Download className="w-4 h-4" /> 현재 배치 다운로드
        </a>
        <a
          href={templateUrl}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm"
        >
          <Download className="w-4 h-4" /> 빈 템플릿
        </a>
        <button
          onClick={handleImportClick}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm"
        >
          <Upload className="w-4 h-4" /> 엑셀 업로드
        </button>        <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleImportFile} className="hidden" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {resolvedMeta?.resolvedFromMonth
          ? `현재 ${selectedYear}년 ${selectedMonth}월 평가는 ${selectedYear}년 ${resolvedMeta.resolvedFromMonth}월부터 적용된 배치셋을 사용 중입니다.${resolvedMeta.isInherited ? ' (상속 상태)' : ''}`
          : `${selectedYear}년 ${selectedMonth}월에 적용 가능한 배치셋이 없습니다.`}
      </div>

      <p className="text-xs text-slate-500">
        {selectedYear}년 {selectedMonth}월 해석 배치 현황: 총 {workingRows.length}건
        {groupFilter ? ` · 선택 그룹 ${filteredEvalRows.length}건` : ''}
      </p>
      {feedback && <p className="text-xs text-emerald-700">{feedback}</p>}
      {error && <p className="text-xs text-rose-600">{error}</p>}

      {historyRows.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-xs font-semibold text-slate-700 mb-2">셋 이력</p>
          <div className="flex flex-wrap gap-2">
            {historyRows.map((row) => (
              <span key={row.plan_set_id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600">
                {selectedYear}-{String(row.effective_from_month).padStart(2, '0')} 시작
                <span className="text-slate-400">({row.item_count}건)</span>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`${selectedYear}-${String(row.effective_from_month).padStart(2, '0')} 적용 평가셋을 삭제할까요?`)) return
                    try {
                      setError('')
                      await onDeleteEvalSet?.(row)
                      setFeedback(`${selectedYear}-${String(row.effective_from_month).padStart(2, '0')} 평가셋을 삭제했습니다.`)
                    } catch (e) {
                      setError(e?.data?.message || e?.message || '평가셋 삭제 실패')
                    }
                  }}
                  className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  title="이 평가셋 삭제"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {!isEvalEditorOpen && (
        <EvalTreeTable
          rows={filteredEvalRows}
          isEditingSet={isEditingSet}
          onEdit={openEvalEdit}
          onRemove={removeEvalRow}
          onAddUnder={openEvalCreateUnder}
          onRemoveMany={removeEvalRowsMany}
          onMove={moveEvalNode}
          ownerGroupNameByCode={ownerGroupNameByCode}
          onShowDefinition={setDefinitionSource}
        />
      )}

      {definitionSource && (
        <IndicatorDefinitionPopup
          source={definitionSource}
          codeCatalog={codeCatalog}
          onClose={() => setDefinitionSource(null)}
        />
      )}

      {!isEvalEditorOpen && (
        <ScoreRollupPanel
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          ownerGroupRows={ownerGroups}
        />
      )}

      {isEvalEditorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 flex items-center justify-center p-6">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-auto rounded-xl bg-white border border-slate-200 shadow-xl">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">{editingEvalIdx == null ? `${selectedYear}년 ${selectedMonth}월 평가배치 추가` : `${selectedYear}년 ${selectedMonth}월 평가배치 수정`}</h3>
              <button onClick={() => setIsEvalEditorOpen(false)} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-5">
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-700">지표코드 선택</span>
                <p className="text-[10px] text-slate-400">
                  평가체계 그룹과 지표코드 소유그룹이 달라도 됩니다. (예: CSG 지표를 S22 평가에 편성)
                  {evalDraft.groupCode
                    ? ` · 현재 평가그룹 ${evalDraft.groupCode}${resolveGroupName(evalDraft.groupCode, evalDraft.groupName) ? ` ${resolveGroupName(evalDraft.groupCode, evalDraft.groupName)}` : ''}`
                    : ''}
                </p>
                {evalDraft.indicatorCode ? (
                  <div className="flex items-center gap-2 p-2 rounded-lg border border-violet-200 bg-violet-50">
                    <span className="text-sm font-medium text-violet-800">{evalDraft.label || '알 수 없는 지표'}</span>
                    <span className="text-xs text-violet-500 font-mono">{evalDraft.indicatorCode}</span>
                    <button onClick={() => setEvalDraft(prev => ({ ...prev, indicatorCode: '' }))} className="ml-auto text-xs text-violet-600 hover:underline">변경</button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                          type="search"
                          placeholder="지표명·코드 입력 후 Enter"
                          value={indicatorSearchInput}
                          onChange={(e) => setIndicatorSearchInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              commitIndicatorSearch()
                            }
                          }}
                          className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={commitIndicatorSearch}
                        className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        검색
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = !catalogOpen
                          setCatalogOpen(next)
                          if (next) await refreshCatalog()
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 text-sm font-medium text-violet-700 hover:bg-violet-100"
                        title="지표 목록 드롭다운"
                      >
                        <ChevronDown className={`h-4 w-4 transition ${catalogOpen ? 'rotate-180' : ''}`} />
                        목록
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      입력 중에는 검색하지 않습니다. Enter 또는 검색·목록 버튼을 누르세요.
                      {catalogLoading ? ' · 최신 지표 불러오는 중…' : ''}
                      {indicatorSearch ? ` · 검색어: "${indicatorSearch}" (${filteredCatalog.length}건)` : ''}
                    </p>
                    {catalogOpen && (
                      <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                        {filteredCatalog.slice(0, 100).map((m) => (
                          <button
                            key={m.indicator_code}
                            type="button"
                            onClick={() => selectIndicatorForEval(m)}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                          >
                            <span className="truncate font-medium text-slate-700">{m.display_name || m.lv3_name}</span>
                            <span className="flex-shrink-0 font-mono text-xs text-slate-400">{m.indicator_code}</span>
                            <span className="flex-shrink-0 text-xs text-slate-400">{m.group_code}/{m.perf_code}</span>
                          </button>
                        ))}
                        {filteredCatalog.length === 0 && (
                          <p className="px-3 py-2 text-xs text-slate-400">
                            {indicatorSearch
                              ? '일치하는 지표가 없습니다. 코드북에서 지표마스터(그룹별 코드)까지 등록했는지 확인하세요.'
                              : '표시할 지표가 없습니다.'}
                          </p>
                        )}
                        {filteredCatalog.length > 100 && (
                          <p className="px-3 py-2 text-center text-xs text-slate-400">
                            {filteredCatalog.length - 100}건 더 있음 · 검색어로 좁혀 주세요
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <label className="text-xs text-slate-600 space-y-1 col-span-2 md:col-span-3">
                  <span className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(evalDraft.isCore)}
                      onChange={e => setEvalDraft(prev => ({ ...prev, isCore: e.target.checked }))}
                      className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="font-semibold text-slate-700">Core 지표로 지정</span>
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Core</span>
                  </span>
                  <p className="text-[10px] text-slate-400 pl-6">연도별 평가배치 시 수동 지정합니다. 비중 상위와 무관합니다.</p>
                </label>
                <label className="text-xs text-slate-600 space-y-1">
                  <span>기여방식</span>
                  <select
                    value={String(evalDraft.contributionMode || 'WEIGHT').toUpperCase() === 'ADJUST' ? 'ADJUST' : 'WEIGHT'}
                    disabled={String(evalDraft.groupCode || '').trim().toUpperCase() === 'SHB'}
                    onChange={(e) => {
                      const mode = e.target.value
                      setEvalDraft((prev) => ({
                        ...prev,
                        contributionMode: mode,
                        weight: mode === 'ADJUST' ? 0 : prev.weight,
                      }))
                    }}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white disabled:bg-slate-50"
                  >
                    <option value="WEIGHT">가중 (WEIGHT)</option>
                    <option value="ADJUST" disabled={String(evalDraft.groupCode || '').trim().toUpperCase() === 'SHB'}>
                      내부통제 가감 (ADJUST)
                    </option>
                  </select>
                  <span className="block text-[10px] text-slate-400">
                    {String(evalDraft.contributionMode || '').toUpperCase() === 'ADJUST'
                      ? '실적 1점 = 종합 ±0.01%p · 비중 합에서 제외'
                      : '전행(SHB)에는 내부통제 가감을 편성할 수 없습니다'}
                  </span>
                </label>
                {Object.entries(EVAL_FIELD_LABELS).map(([key, label]) => {
                  if (key === 'weight' && String(evalDraft.contributionMode || '').toUpperCase() === 'ADJUST') {
                    return (
                      <label key={key} className="text-xs text-slate-600 space-y-1">
                        <span>{label}</span>
                        <input value="0" disabled className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50 text-slate-400" />
                      </label>
                    )
                  }
                  if (key === 'groupCode') {
                    const selectedCode = String(evalDraft.groupCode || '').trim().toUpperCase()
                    const selectedName = resolveGroupName(selectedCode, evalDraft.groupName)
                    const hasSelected = selectedCode && ownerGroups.some((g) => String(g.code).toUpperCase() === selectedCode)
                    return (
                      <label key={key} className="text-xs text-slate-600 space-y-1">
                        <span>{label}</span>
                        <select
                          value={hasSelected ? selectedCode : (selectedCode || '')}
                          onChange={(e) => applyOwnerGroup(e.target.value)}
                          className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white"
                        >
                          <option value="">소유그룹 선택</option>
                          {!hasSelected && selectedCode ? (
                            <option value={selectedCode}>
                              {selectedName ? `${selectedCode} · ${selectedName}` : selectedCode} (마스터 미등록)
                            </option>
                          ) : null}
                          {ownerGroups.map((g) => {
                            const code = String(g.code || '').trim().toUpperCase()
                            const name = String(g.name || '').trim()
                            return (
                              <option key={code} value={code}>
                                {name ? `${code} · ${name}` : code}
                              </option>
                            )
                          })}
                        </select>
                        {selectedCode ? (
                          <span className="block text-[10px] text-slate-400">
                            표시명: {selectedName ? `${selectedCode} ${selectedName}` : selectedCode}
                          </span>
                        ) : null}
                      </label>
                    )
                  }
                  return (
                    <label key={key} className="text-xs text-slate-600 space-y-1">
                      <span>{label}</span>
                      <input
                        value={evalDraft[key] ?? ''}
                        onChange={e => setEvalDraft(prev => ({
                          ...prev,
                          [key]: (
                            key === 'weight' ||
                            key === 'annualTarget' ||
                            key === 'monthlyTarget' ||
                            key === 'baselineActual' ||
                            key === 'capMax' ||
                            key === 'capMin' ||
                            key === 'scoreRule' ||
                            key === 'penaltyRule'
                          )
                            ? (e.target.value === '' ? '' : Number(e.target.value))
                            : e.target.value,
                        }))}
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm"
                        type={(
                          key === 'weight' ||
                          key === 'annualTarget' ||
                          key === 'monthlyTarget' ||
                          key === 'baselineActual' ||
                          key === 'capMax' ||
                          key === 'capMin' ||
                          key === 'scoreRule' ||
                          key === 'penaltyRule'
                        ) ? 'number' : 'text'}
                      />
                    </label>
                  )
                })}
              </div>

              <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-emerald-700" />
                  <h4 className="text-sm font-bold text-emerald-900">달성률 산정 설정</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {Object.entries(MODE_LABELS).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setEvalDraft(prev => ({ ...prev, achievementMode: mode }))}
                      className={`rounded-xl border px-3 py-3 text-left transition ${evalDraft.achievementMode === mode ? 'border-emerald-500 bg-white shadow-sm ring-2 ring-emerald-100' : 'border-slate-200 bg-white hover:border-emerald-200'}`}
                    >
                      <p className="text-xs font-black text-slate-800">{label}</p>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        {mode === 'linear' && '기준실적+(연간-기준)/연간일수×월말경과일수 (윤년 366)'}
                        {mode === 'flat' && '매월 연간목표와 실적을 비교'}
                        {mode === 'custom' && '월간목표·Filter1~30·달성률 식으로 정의'}
                      </p>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="text-xs text-slate-600 space-y-1">
                    <span>목표 방향</span>
                    <select value={evalDraft.goalDirection} onChange={e => setEvalDraft(prev => ({ ...prev, goalDirection: e.target.value }))} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
                      <option value={GOAL_DIRECTIONS.INCREASE}>{DIRECTION_LABELS.increase}</option>
                      <option value={GOAL_DIRECTIONS.DECREASE}>{DIRECTION_LABELS.decrease}</option>
                    </select>
                  </label>
                  {evalDraft.achievementMode === ACHIEVEMENT_MODES.LINEAR && (
                    <label className="text-xs text-slate-600 space-y-1">
                      <span>기준실적 (연초/기준월)</span>
                      <input type="number" value={evalDraft.baselineActual ?? 0} onChange={e => setEvalDraft(prev => ({ ...prev, baselineActual: Number(e.target.value) || 0 }))} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm" />
                    </label>
                  )}
                </div>
                {evalDraft.achievementMode === ACHIEVEMENT_MODES.CUSTOM && (
                  <div className="space-y-3 rounded-xl border border-white bg-white p-3">
                    <p className="text-xs font-bold text-slate-700">Custom 산출식</p>
                    <div className="flex flex-wrap gap-2">
                      {ACHIEVEMENT_PRESETS.map(preset => (
                        <button key={preset.id} type="button" onClick={() => applyPreset(preset)} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-emerald-50 hover:border-emerald-200" title={preset.hint}>
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <textarea value={evalDraft.customAchievementExpr || ''} onChange={e => setEvalDraft(prev => ({ ...prev, customAchievementExpr: e.target.value }))} rows={2} placeholder="예: 100 + (actual - target) / target * 100" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono" />
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-700">월간 목표 (Custom)</p>
                      <button type="button" onClick={fillLinearTargetsToCustom} className="text-[10px] font-bold text-emerald-700 hover:underline">Linear 기준으로 12개월 자동 채우기</button>
                    </div>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                      {Array.from({ length: 12 }, (_, idx) => {
                        const month = idx + 1
                        return (
                          <label key={month} className="text-[10px] text-slate-500 space-y-1">
                            <span>{month}월</span>
                            <input type="number" value={evalDraft.customMonthlyTargets?.[month] ?? evalPreview.targets.find(t => t.month === month)?.target ?? ''} onChange={e => updateCustomMonthTarget(month, e.target.value)} className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs" />
                          </label>
                        )
                      })}
                    </div>
                    <p className="text-xs font-bold text-slate-700">Filter 1~30 (숫자 또는 지표코드)</p>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 max-h-40 overflow-y-auto">
                      {Array.from({ length: 30 }, (_, idx) => {
                        const n = String(idx + 1)
                        return (
                          <label key={n} className="text-[10px] text-slate-500 space-y-1">
                            <span>Filter{n}</span>
                            <input
                              value={evalDraft.filters?.[n] ?? ''}
                              onChange={e => setEvalDraft(prev => ({
                                ...prev,
                                filters: { ...(prev.filters || {}), [n]: e.target.value },
                              }))}
                              className="w-full px-2 py-1.5 rounded border border-slate-200 text-[10px] font-mono"
                              placeholder="상수/코드"
                            />
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-white bg-white p-3">
                  <p className="text-xs font-bold text-slate-700 mb-2">월간 목표 · 달성률 미리보기</p>
                  <div className="flex flex-wrap items-end gap-3 mb-3">
                    <label className="text-[10px] text-slate-500 space-y-1">
                      <span>검증 월</span>
                      <select value={previewMonth} onChange={e => setPreviewMonth(Number(e.target.value))} className="px-2 py-1.5 rounded border border-slate-200 text-xs bg-white">
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
                      </select>
                    </label>
                    <label className="text-[10px] text-slate-500 space-y-1">
                      <span>가정 실적</span>
                      <input type="number" value={previewActual} onChange={e => setPreviewActual(Number(e.target.value) || 0)} className="px-2 py-1.5 rounded border border-slate-200 text-xs w-28" />
                    </label>
                    <div className="ml-auto text-right">
                      <p className="text-[10px] text-slate-500">{previewMonth}월 목표</p>
                      <p className="text-sm font-black text-slate-800 tabular-nums">{evalPreview.monthTarget ?? '—'}</p>
                      <p className="text-[10px] text-emerald-700 font-bold mt-1">달성률 {evalPreview.achievement ?? '—'}%</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-6 md:grid-cols-12 gap-1">
                    {evalPreview.targets.map(({ month, target }) => (
                      <div key={month} className={`rounded-lg px-1.5 py-1 text-center ${month === previewMonth ? 'bg-emerald-100 border border-emerald-300' : 'bg-slate-50'}`}>
                        <p className="text-[9px] text-slate-400">{month}월</p>
                        <p className="text-[10px] font-bold tabular-nums text-slate-700">{target ?? '—'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setIsEvalEditorOpen(false)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">취소</button>
              <button onClick={saveEvalDraft} className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
