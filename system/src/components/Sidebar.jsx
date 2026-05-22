import { useMemo, useState } from 'react'
import { LayoutDashboard, Users, ChevronRight, ChevronDown, BarChart3, BookOpen, Plus } from 'lucide-react'

export default function Sidebar({
  groups, view, selectedGroup, selectedYear, detailTab, customTabs, detailMetricOptions,
  onViewChange, onGroupSelect, onDetailTabChange, onSaveCustomTab, onDeleteCustomTab, onBankKpiOpen,
}) {
  const [isBuilderOpen, setIsBuilderOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [title, setTitle] = useState('')
  const [codes, setCodes] = useState([])
  const [pinToBottom, setPinToBottom] = useState(true)
  const [groupSectionOpen, setGroupSectionOpen] = useState(true)
  const [agendaSectionOpen, setAgendaSectionOpen] = useState(false)
  const [formError, setFormError] = useState('')

  const detailCustomTabs = useMemo(
    () => Array.isArray(customTabs) ? customTabs : [],
    [customTabs],
  )

  const openCreate = () => {
    setEditingId(null)
    setTitle('')
    setCodes([])
    setPinToBottom(true)
    setFormError('')
    setIsBuilderOpen(true)
  }

  const openEdit = (tab) => {
    setEditingId(tab.id)
    setTitle(tab.title ?? '')
    setCodes(Array.isArray(tab.metricCodes) ? tab.metricCodes : [])
    setPinToBottom(Boolean(tab.pinToBottom))
    setFormError('')
    setIsBuilderOpen(true)
  }

  const save = () => {
    const res = onSaveCustomTab?.({ id: editingId, title, metricCodes: codes, pinToBottom })
    if (res?.ok) {
      setIsBuilderOpen(false)
      setFormError('')
      return
    }
    if (res?.reason === 'duplicate_title') setFormError('같은 제목의 탭이 이미 있습니다.')
    else if (res?.reason === 'limit') setFormError('탭은 최대 8개까지 생성할 수 있습니다.')
    else setFormError('제목과 지표를 확인해 주세요.')
  }

  const closeBuilder = () => {
    setIsBuilderOpen(false)
    setFormError('')
  }

  const deleteFromModal = () => {
    if (!editingId) return
    onDeleteCustomTab?.(editingId)
    setIsBuilderOpen(false)
    setFormError('')
  }

  const openAgendaView = () => {
    onViewChange?.('detail')
    onDetailTabChange?.('agenda')
  }

  const openCustomAgendaTab = (tabId) => {
    onViewChange?.('detail')
    onDetailTabChange?.(`custom:${tabId}`)
  }

  const bottomTabs = detailCustomTabs.filter(t => t.pinToBottom)

  return (
    <aside className="w-64 bg-navy-950 text-white flex flex-col shrink-0">
      <div className="px-5 py-5 border-b border-navy-800">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-7 h-7 text-blue-400" />
          <div>
            <h1 className="text-base font-bold tracking-tight">KPI 성과관리</h1>
            <p className="text-[11px] text-navy-300 mt-0.5">Performance Management System</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        <div className="px-3 mb-1">
          <p className="text-[10px] uppercase tracking-widest text-navy-400 px-2 mb-2">메뉴</p>
        </div>

        <button
          onClick={() => onViewChange('dashboard')}
          className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
            view === 'dashboard'
              ? 'bg-navy-800 text-white border-l-3 border-blue-400'
              : 'text-navy-200 hover:bg-navy-900 hover:text-white'
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          전체 현황
        </button>

        <button
          onClick={() => onViewChange('codebook')}
          className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
            view === 'codebook'
              ? 'bg-navy-800 text-white border-l-3 border-blue-400'
              : 'text-navy-200 hover:bg-navy-900 hover:text-white'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          0. 코드북
        </button>

        <div className="px-3 mt-5 mb-1">
          <button
            onClick={() => setGroupSectionOpen(v => !v)}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-navy-900"
          >
            <p className="text-[10px] uppercase tracking-widest text-navy-400">그룹별 상세</p>
            {groupSectionOpen
              ? <ChevronDown className="w-3.5 h-3.5 text-navy-500" />
              : <ChevronRight className="w-3.5 h-3.5 text-navy-500" />}
          </button>
        </div>

        {groupSectionOpen && (
          <>
            <button
              onClick={() => onBankKpiOpen?.()}
              className={`w-full flex items-center justify-between px-5 py-2 text-[13px] transition-colors ${
                view === 'detail' && detailTab === 'bank'
                  ? 'bg-navy-800 text-white border-l-3 border-blue-400'
                  : 'text-navy-300 hover:bg-navy-900 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5" />
                은행KPI
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-40" />
            </button>

            {groups.map(g => (
              <button
                key={g}
                onClick={() => onGroupSelect(g)}
                className={`w-full flex items-center justify-between px-5 py-2 text-[13px] transition-colors ${
                  view === 'detail' && selectedGroup === g
                    ? 'bg-navy-800 text-white border-l-3 border-blue-400'
                    : 'text-navy-300 hover:bg-navy-900 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5" />
                  {g}
                </span>
                <ChevronRight className="w-3.5 h-3.5 opacity-40" />
              </button>
            ))}
          </>
        )}

        <div className="px-3 mt-4">
          <button
            onClick={() => setAgendaSectionOpen(v => !v)}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-navy-900"
          >
            <p className="text-[10px] uppercase tracking-widest text-navy-400">Agenda별 실적</p>
            {agendaSectionOpen
              ? <ChevronDown className="w-3.5 h-3.5 text-navy-500" />
              : <ChevronRight className="w-3.5 h-3.5 text-navy-500" />}
          </button>
        </div>

        {agendaSectionOpen && (
          <div className="px-3 space-y-1.5">
            <button
              onClick={openAgendaView}
              className={`w-full text-left px-3 py-1.5 rounded text-xs ${view === 'detail' && detailTab === 'agenda' ? 'bg-blue-600 text-white' : 'text-navy-200 bg-navy-800 hover:bg-navy-700'}`}
            >
              Agenda별 실적
            </button>

            {detailCustomTabs.map(tab => (
              <div key={tab.id} className="flex items-center gap-1">
                <button
                  onClick={() => openCustomAgendaTab(tab.id)}
                  className={`flex-1 text-left px-2 py-1.5 rounded text-xs ${view === 'detail' && detailTab === `custom:${tab.id}` ? 'bg-indigo-600 text-white' : 'text-indigo-100 bg-indigo-900/60 hover:bg-indigo-800/70'}`}
                >
                  {tab.title}
                </button>
                <button onClick={() => openEdit(tab)} className="px-1.5 py-1 rounded bg-navy-700 text-[10px]">설정</button>
              </div>
            ))}

            <button
              onClick={openCreate}
              className="mt-1 w-full px-2 py-1.5 rounded border border-dashed border-blue-400 text-blue-300 text-xs hover:bg-navy-800 flex items-center justify-center gap-1"
            >
              <Plus className="w-3 h-3" />
              탭 개설
            </button>

            {bottomTabs.length > 0 && (
              <div className="mt-1 pt-2 border-t border-navy-700">
                <p className="text-[10px] text-navy-400 mb-1">하단 메뉴 구성</p>
                <div className="flex flex-wrap gap-1">
                  {bottomTabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => openCustomAgendaTab(tab.id)}
                      className={`px-2 py-0.5 rounded-full text-[10px] ${view === 'detail' && detailTab === `custom:${tab.id}` ? 'bg-white text-navy-900' : 'bg-navy-700 text-navy-100'}`}
                    >
                      {tab.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </nav>

      <div className="px-5 py-4 border-t border-navy-800 text-[11px] text-navy-400">
        v0.1 Prototype &middot; 2026
      </div>

      {isBuilderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55">
          <div className="w-[560px] max-w-[92vw] max-h-[86vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">{editingId ? '탭 설정' : '탭 개설'}</h3>
              <button onClick={closeBuilder} className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">닫기</button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <p className="text-[11px] text-slate-500 mb-1">탭 제목</p>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: VIP 집중관리"
                  className="w-full px-3 py-2 rounded border border-slate-300 text-sm text-slate-800"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={pinToBottom} onChange={(e) => setPinToBottom(e.target.checked)} />
                하단 메뉴에 노출
              </label>

              <div>
                <p className="text-[11px] text-slate-500 mb-1">가져올 데이터(지표) 선택</p>
                <div className="max-h-64 overflow-y-auto rounded border border-slate-200">
                  {detailMetricOptions?.map(opt => (
                    <label key={opt.code} className="flex items-center gap-2 px-3 py-2 text-[12px] border-b border-slate-100 last:border-b-0">
                      <input
                        type="checkbox"
                        checked={codes.includes(opt.code)}
                        onChange={(e) => {
                          if (e.target.checked) setCodes(prev => [...prev, opt.code])
                          else setCodes(prev => prev.filter(c => c !== opt.code))
                        }}
                      />
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{opt.category}</span>
                      <span className="text-slate-400">[{opt.group}]</span>
                      <span className="text-slate-700 truncate">{opt.label || opt.name}</span>
                      <span className="ml-auto text-slate-400">{opt.weight}%</span>
                    </label>
                  ))}
                </div>
              </div>

              {formError && (
                <p className="text-xs text-rose-600">{formError}</p>
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
              <div>
                {editingId && (
                  <button
                    onClick={deleteFromModal}
                    className="px-3 py-1.5 rounded bg-rose-600 text-white text-xs hover:bg-rose-700"
                  >
                    탭 삭제
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={closeBuilder} className="px-3 py-1.5 rounded bg-slate-100 text-slate-700 text-xs hover:bg-slate-200">취소</button>
                <button
                  onClick={save}
                  disabled={!title.trim() || codes.length === 0}
                  className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs disabled:opacity-40"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
