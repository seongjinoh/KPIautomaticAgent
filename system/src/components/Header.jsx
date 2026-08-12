import { ArrowLeft, Calendar, Filter, FileText, RefreshCw } from 'lucide-react'
import { ROLE_LABELS, canAccessTopMenu } from '../lib/authService'

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const TOOLS = ['전체', 'KPI', '전략과제', '모니터링']

export default function Header({
  view, selectedGroup, agendaTitle, selectedMonth, selectedYear, toolFilter,
  onMonthChange, onYearChange, yearOptions = [], onToolFilterChange, onBack, onReportClick, currentUser,
  onRefreshFacts, factsRefreshing, factsMessage,
}) {
  const years = yearOptions.length ? yearOptions : []
  const atRoleHome = canAccessTopMenu(currentUser)
    ? view === 'dashboard'
    : view === 'home'
  const detailHeading = agendaTitle
    ? `Agenda · ${agendaTitle}`
    : (selectedGroup || '')
  return (
    <header className="flex min-h-[56px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {!atRoleHome && (
          <button onClick={onBack} aria-label="뒤로 가기" className="rounded-md p-1.5 transition-colors hover:bg-slate-100">
            <ArrowLeft className="h-4 w-4 text-slate-500" />
          </button>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-bold text-slate-900">
            {view === 'home' ? '홈'
              : view === 'deptFacts' ? '실적 입력'
              : view === 'dashboard' ? `${selectedYear}년 전행 KPI 현황`
              : view === 'agent' ? '성과평가 AI Agent'
              : view === 'anomaly' ? '이상치 센싱 센터'
              : view === 'report' ? `${selectedGroup} AI 보고서`
              : view === 'codebook' ? '0. 코드북'
              : view === 'evalConfig' ? '연도별 평가배치'
              : view === 'facts' ? '실적 조회'
              : view === 'users' ? '사용자 권한관리'
              : detailHeading}
          </h2>
          <p className="truncate text-[10px] text-slate-400">
            {view === 'home'
              ? '환영합니다 · 배정 그룹으로 이동하세요'
              : view === 'deptFacts'
              ? '주관부서 지표 실적 수기 입력 · 엑셀 업/다운로드'
              : view === 'dashboard'
              ? '평가배치 · 실적취합/산출 · 달성률산정'
              : view === 'agent' ? '자연어 질의 · 산정 · 이상치 · 관계해석 · 보고 초안'
              : view === 'anomaly' ? '전월비·미달·입력누락·진척률 이상 자동 센싱'
              : view === 'report' ? 'LLM 기반 실적 진단 · 추진현황 · 개선과제'
              : view === 'codebook' ? '재무/비재무 상호 배타 · 엑셀 0.코드북 동기'
              : view === 'evalConfig' ? 'KPI 지표·목표설정 · Linear일수/Flat/Custom Filter'
              : view === 'facts' ? 'achievement / collect / calc SQLite 실적 조회'
              : view === 'users' ? 'Mock SSO 회원정보DB · 역할/그룹/부서 권한 설정'
              : agendaTitle
                ? '그룹 무관 · 선택 Agenda 지표 전체'
                : `${selectedYear}년 평가 기준`}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 shrink items-center gap-2 overflow-x-auto py-0.5">
        {currentUser && (
          <div className="hidden border-r border-slate-200 pr-3 text-right 2xl:block">
            <p className="text-[10px] font-semibold text-slate-700">{currentUser.name}</p>
            <p className="text-[9px] text-slate-400">{ROLE_LABELS[currentUser.role]} · {currentUser.employeeNo}</p>
          </div>
        )}

        {view !== 'home' && view !== 'deptFacts' && view !== 'codebook' && view !== 'users' && view !== 'facts' && onRefreshFacts && (
          <button
            type="button"
            onClick={onRefreshFacts}
            disabled={factsRefreshing}
            title={factsMessage || '실적 데이터를 새로고침합니다'}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${factsRefreshing ? 'animate-spin' : ''}`} />
            {factsRefreshing ? '동기화 중' : '실적 새로고침'}
          </button>
        )}

        {view !== 'home' && view !== 'deptFacts' && view !== 'codebook' && view !== 'evalConfig' && view !== 'users' && view !== 'facts' && (
          <div className="flex h-8 items-center rounded-md border border-slate-200 bg-white px-2">
            <select
              value={selectedYear ?? ''}
              onChange={e => onYearChange(Number(e.target.value))}
              disabled={!years.length}
              className="cursor-pointer bg-transparent text-[10px] font-semibold text-slate-700 outline-none disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {!years.length && <option value="">평가배치 없음</option>}
              {years.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
          </div>
        )}

        {view !== 'home' && view !== 'deptFacts' && view !== 'codebook' && view !== 'evalConfig' && view !== 'users' && view !== 'facts' && (
          <div className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={selectedMonth}
              onChange={e => onMonthChange(Number(e.target.value))}
              className="cursor-pointer bg-transparent text-[10px] text-slate-700 outline-none"
            >
              {MONTHS.map(m => <option key={m} value={m}>{m}월</option>)}
            </select>
          </div>
        )}

        {view === 'detail' && (
          <>
            <div className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2">
              <Filter className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={toolFilter}
                onChange={e => onToolFilterChange(e.target.value)}
                className="cursor-pointer bg-transparent text-[10px] text-slate-700 outline-none"
              >
                {TOOLS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {!agendaTitle && (
              <button
                onClick={onReportClick}
                className="flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-2.5 text-[10px] font-semibold text-white transition-colors hover:bg-slate-800"
              >
                <FileText className="h-3.5 w-3.5" />
                AI 보고서
              </button>
            )}
          </>
        )}
      </div>
    </header>
  )
}
