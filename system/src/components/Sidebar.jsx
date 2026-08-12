import { useMemo, useState } from 'react'
import { LayoutDashboard, Users, ChevronRight, ChevronDown, BarChart3, BookOpen, Plus, Shield, LogOut, Bot, ShieldAlert, Zap, Database, Search, Home, PenLine } from 'lucide-react'
import { ROLE_LABELS, canAccessAdminMenu, canAccessDeptFactEntry, canAccessTopMenu } from '../lib/authService'

export default function Sidebar({
  groups, view, selectedGroup, selectedYear, detailTab, customTabs, detailMetricOptions,
  onViewChange, onGroupSelect, onAgendaSelect, onSaveCustomTab, onDeleteCustomTab,
  currentUser, onLogout,
}) {
  const [isBuilderOpen, setIsBuilderOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [title, setTitle] = useState('')
  const [codes, setCodes] = useState([])
  const [groupSectionOpen, setGroupSectionOpen] = useState(true)
  const [agendaSectionOpen, setAgendaSectionOpen] = useState(false)
  const [menuSectionOpen, setMenuSectionOpen] = useState(true)
  const [adminSectionOpen, setAdminSectionOpen] = useState(true)
  const [formError, setFormError] = useState('')
  const [metricFilter, setMetricFilter] = useState('')
  const canManageAgendaTabs = canAccessAdminMenu(currentUser)

  const detailCustomTabs = useMemo(
    () => Array.isArray(customTabs) ? customTabs : [],
    [customTabs],
  )

  const filteredMetricOptions = useMemo(() => {
    const opts = Array.isArray(detailMetricOptions) ? detailMetricOptions : []
    const q = metricFilter.trim().toLowerCase()
    if (!q) return opts
    return opts.filter((opt) => {
      const hay = [
        opt.label,
        opt.name,
        opt.group,
        opt.category,
        opt.code,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [detailMetricOptions, metricFilter])

  const openCreate = () => {
    if (!canManageAgendaTabs) return
    setEditingId(null)
    setTitle('')
    setCodes([])
    setMetricFilter('')
    setFormError('')
    setIsBuilderOpen(true)
  }

  const openEdit = (tab) => {
    if (!canManageAgendaTabs) return
    setEditingId(tab.id)
    setTitle(tab.title ?? '')
    setCodes(Array.isArray(tab.metricCodes) ? tab.metricCodes : [])
    setMetricFilter('')
    setFormError('')
    setIsBuilderOpen(true)
  }

  const save = () => {
    const res = onSaveCustomTab?.({ id: editingId, title, metricCodes: codes })
    if (res?.ok) {
      setIsBuilderOpen(false)
      setFormError('')
      return
    }
    if (res?.reason === 'forbidden') setFormError('Agenda 탭은 관리자만 개설·수정할 수 있습니다.')
    else if (res?.reason === 'duplicate_title') setFormError('같은 제목의 탭이 이미 있습니다.')
    else if (res?.reason === 'limit') setFormError('탭은 최대 8개까지 생성할 수 있습니다.')
    else setFormError('제목과 지표를 확인해 주세요.')
  }

  const closeBuilder = () => {
    setIsBuilderOpen(false)
    setFormError('')
    setMetricFilter('')
  }

  const deleteFromModal = () => {
    if (!editingId || !canManageAgendaTabs) return
    onDeleteCustomTab?.(editingId)
    setIsBuilderOpen(false)
    setFormError('')
  }

  const openCustomAgendaTab = (tabId) => {
    onAgendaSelect?.(tabId)
  }

  const isAgendaActive = typeof detailTab === 'string' && detailTab.startsWith('custom:')
  const isGroupDetailActive = view === 'detail' && !isAgendaActive && Boolean(selectedGroup)

  return (
    <aside className="w-64 bg-[#071b4d] text-white flex flex-col shrink-0">
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/15 ring-1 ring-blue-300/30">
            <BarChart3 className="w-5 h-5 text-blue-200" />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-tight">성과평가 자동화 Agent</h1>
            <p className="text-[10px] text-blue-200/80 mt-0.5">KPI Performance Management</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {!canAccessTopMenu(currentUser) && (
          <button
            onClick={() => onViewChange('home')}
            className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
              view === 'home'
                ? 'bg-blue-600 text-white border-l-[3px] border-blue-200 shadow-lg shadow-blue-950/20'
                : 'text-blue-100/80 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Home className="w-4 h-4" />
            홈
          </button>
        )}

        {canAccessDeptFactEntry(currentUser) && (
          <button
            onClick={() => onViewChange('deptFacts')}
            className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
              view === 'deptFacts'
                ? 'bg-blue-600 text-white border-l-[3px] border-blue-200 shadow-lg shadow-blue-950/20'
                : 'text-blue-100/80 hover:bg-white/5 hover:text-white'
            }`}
          >
            <PenLine className="w-4 h-4" />
            실적 입력
          </button>
        )}

        {canAccessTopMenu(currentUser) && (
        <div className="px-3 mb-1">
          <button
            onClick={() => setMenuSectionOpen(v => !v)}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/5"
          >
            <p className="text-[10px] uppercase tracking-widest text-blue-200/50">메뉴</p>
            {menuSectionOpen
              ? <ChevronDown className="w-3.5 h-3.5 text-blue-200/40" />
              : <ChevronRight className="w-3.5 h-3.5 text-blue-200/40" />}
          </button>
        </div>
        )}

        {canAccessTopMenu(currentUser) && menuSectionOpen && (
          <>
        <button
          onClick={() => onViewChange('dashboard')}
          className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
            view === 'dashboard'
              ? 'bg-blue-600 text-white border-l-[3px] border-blue-200 shadow-lg shadow-blue-950/20'
              : 'text-blue-100/80 hover:bg-white/5 hover:text-white'
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          전체 현황
        </button>

        <button
          onClick={() => onViewChange('agent')}
          className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
            view === 'agent'
              ? 'bg-blue-600 text-white border-l-[3px] border-blue-200 shadow-lg shadow-blue-950/20'
              : 'text-blue-100/80 hover:bg-white/5 hover:text-white'
          }`}
        >
          <Bot className="w-4 h-4" />
          AI Agent
        </button>

        <button
          onClick={() => onViewChange('anomaly')}
          className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
            view === 'anomaly'
              ? 'bg-blue-600 text-white border-l-[3px] border-blue-200 shadow-lg shadow-blue-950/20'
              : 'text-blue-100/80 hover:bg-white/5 hover:text-white'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          이상치 센싱
        </button>
          </>
        )}

        {canAccessAdminMenu(currentUser) && (
          <>
            <div className="px-3 mt-4 mb-1">
              <button
                onClick={() => setAdminSectionOpen(v => !v)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/5"
              >
                <p className="text-[10px] uppercase tracking-widest text-blue-200/50">관리</p>
                {adminSectionOpen
                  ? <ChevronDown className="w-3.5 h-3.5 text-blue-200/40" />
                  : <ChevronRight className="w-3.5 h-3.5 text-blue-200/40" />}
              </button>
            </div>

            {adminSectionOpen && (
              <>
            <button
              onClick={() => onViewChange('codebook')}
              className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                view === 'codebook'
                  ? 'bg-blue-600 text-white border-l-[3px] border-blue-200 shadow-lg shadow-blue-950/20'
                  : 'text-blue-100/80 hover:bg-white/5 hover:text-white'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              0. 코드북
            </button>

            <button
              onClick={() => onViewChange('evalConfig')}
              className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                view === 'evalConfig'
                  ? 'bg-blue-600 text-white border-l-[3px] border-blue-200 shadow-lg shadow-blue-950/20'
                  : 'text-blue-100/80 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Zap className="w-4 h-4" />
              연도별 평가배치
            </button>

            <button
              onClick={() => onViewChange('facts')}
              className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                view === 'facts'
                  ? 'bg-blue-600 text-white border-l-[3px] border-blue-200 shadow-lg shadow-blue-950/20'
                  : 'text-blue-100/80 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Database className="w-4 h-4" />
              실적 조회
            </button>

            <button
              onClick={() => onViewChange('users')}
              className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                view === 'users'
                  ? 'bg-blue-600 text-white border-l-[3px] border-blue-200 shadow-lg shadow-blue-950/20'
                  : 'text-blue-100/80 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Shield className="w-4 h-4" />
              사용자 권한관리
            </button>
              </>
            )}
          </>
        )}

        <div className="px-3 mt-5 mb-1">
          <button
            onClick={() => setGroupSectionOpen(v => !v)}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/5"
          >
            <p className="text-[10px] uppercase tracking-widest text-blue-200/50">
              {selectedYear ? `${selectedYear}년 KPI 평가` : 'KPI 평가'}
            </p>
            {groupSectionOpen
              ? <ChevronDown className="w-3.5 h-3.5 text-blue-200/40" />
              : <ChevronRight className="w-3.5 h-3.5 text-blue-200/40" />}
          </button>
        </div>

        {groupSectionOpen && (
          <>
            {groups.length === 0 ? (
              <p className="px-5 py-2 text-[11px] leading-relaxed text-blue-200/45">
                {selectedYear}년 평가배치에 등록된 그룹이 없습니다.
              </p>
            ) : groups.map(g => (
              <button
                key={g}
                onClick={() => onGroupSelect(g)}
                className={`w-full flex items-center justify-between px-5 py-2 text-[13px] transition-colors ${
                  isGroupDetailActive && selectedGroup === g
                    ? 'bg-blue-600 text-white border-l-[3px] border-blue-200'
                    : 'text-blue-100/70 hover:bg-white/5 hover:text-white'
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
            className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/5"
          >
            <p className="text-[10px] uppercase tracking-widest text-blue-200/50">Agenda별 실적</p>
            {agendaSectionOpen
              ? <ChevronDown className="w-3.5 h-3.5 text-blue-200/40" />
              : <ChevronRight className="w-3.5 h-3.5 text-blue-200/40" />}
          </button>
        </div>

        {agendaSectionOpen && (
          <div className="px-3 space-y-1.5">
            {detailCustomTabs.length === 0 && (
              <p className="px-2 py-1.5 text-[11px] leading-relaxed text-blue-200/45">
                {canManageAgendaTabs
                  ? '테마별 지표 탭을 개설해 주세요.'
                  : '등록된 Agenda 탭이 없습니다.'}
              </p>
            )}

            {detailCustomTabs.map(tab => (
              <div key={tab.id} className="flex items-center gap-1">
                <button
                  onClick={() => openCustomAgendaTab(tab.id)}
                  className={`flex-1 rounded px-2 py-1.5 text-left text-xs ${view === 'detail' && detailTab === `custom:${tab.id}` ? 'bg-blue-600 text-white' : 'bg-navy-800 text-blue-100/80 hover:bg-navy-700 hover:text-white'}`}
                >
                  {tab.title}
                </button>
                {canManageAgendaTabs && (
                  <button onClick={() => openEdit(tab)} className="px-1.5 py-1 rounded bg-navy-700 text-[10px]">설정</button>
                )}
              </div>
            ))}

            {canManageAgendaTabs && (
              <button
                onClick={openCreate}
                className="mt-1 w-full px-2 py-1.5 rounded border border-dashed border-blue-400 text-blue-300 text-xs hover:bg-navy-800 flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3" />
                탭 개설
              </button>
            )}
          </div>
        )}
      </nav>

      <div className="px-5 py-4 border-t border-white/10">
        <div className="mb-3 rounded-2xl bg-white/10 border border-white/10 px-3 py-2">
          <p className="text-xs font-bold text-white truncate">{currentUser?.name}</p>
          <p className="text-[10px] text-blue-100/70 mt-0.5">
            {currentUser?.employeeNo} · {ROLE_LABELS[currentUser?.role] ?? '권한 없음'}
          </p>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-blue-50 hover:bg-white/15"
        >
          <LogOut className="w-3.5 h-3.5" />
          로그아웃
        </button>
        <p className="mt-3 text-[11px] text-blue-200/40">v1.0.0 · 2026</p>
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

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500">가져올 데이터(지표) 선택</p>
                  <p className="text-[10px] text-slate-400">
                    선택 {codes.length} · 표시 {filteredMetricOptions.length}/{(detailMetricOptions || []).length}
                  </p>
                </div>
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={metricFilter}
                    onChange={(e) => setMetricFilter(e.target.value)}
                    placeholder="지표명·그룹·카테고리·코드 검색"
                    className="w-full rounded border border-slate-300 py-2 pl-8 pr-3 text-sm text-slate-800 outline-none focus:border-blue-400"
                  />
                </div>
                <div className="h-64 overflow-y-auto rounded border border-slate-200">
                  {filteredMetricOptions.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-slate-400">검색 결과가 없습니다.</p>
                  ) : filteredMetricOptions.map(opt => (
                    <label key={`${opt.group || ''}::${opt.code}`} className="flex items-center gap-2 px-3 py-2 text-[12px] border-b border-slate-100 last:border-b-0">
                      <input
                        type="checkbox"
                        checked={codes.includes(opt.code)}
                        onChange={(e) => {
                          if (e.target.checked) setCodes(prev => [...prev, opt.code])
                          else setCodes(prev => prev.filter(c => c !== opt.code))
                        }}
                      />
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">{opt.category}</span>
                      <span className="text-slate-400 shrink-0">[{opt.group}]</span>
                      <span className="text-slate-700 truncate">{opt.label || opt.name}</span>
                      <span className="ml-auto text-slate-400 shrink-0">{opt.weight}%</span>
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
