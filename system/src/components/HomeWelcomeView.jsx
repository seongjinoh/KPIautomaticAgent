import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Building2, Sparkles } from 'lucide-react'
import { ROLE_LABELS, ROLES } from '../lib/authService'

function greetingByHour(date = new Date()) {
  const h = date.getHours()
  if (h < 12) return '좋은 아침입니다'
  if (h < 18) return '안녕하세요'
  return '수고 많으십니다'
}

function formatToday(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(date)
  } catch {
    return ''
  }
}

export default function HomeWelcomeView({
  currentUser,
  groups = [],
  selectedYear,
  selectedMonth,
  onGroupClick,
}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(t)
  }, [])

  const dept = String(currentUser?.department || currentUser?.group || '').trim()
  const name = String(currentUser?.name || '').trim() || '사용자'
  const roleLabel = ROLE_LABELS[currentUser?.role] || ''
  const greeting = useMemo(() => greetingByHour(), [])
  const today = useMemo(() => formatToday(), [])
  const groupList = useMemo(
    () => (Array.isArray(groups) ? groups.filter(Boolean) : []),
    [groups],
  )

  return (
    <div className="relative min-h-[calc(100vh-7rem)] overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 55% at 12% 8%, rgba(11,92,255,0.14), transparent 55%),'
            + 'radial-gradient(ellipse 70% 50% at 88% 20%, rgba(25,49,111,0.10), transparent 50%),'
            + 'linear-gradient(165deg, #f7f9fc 0%, #eef2f8 48%, #e8edf5 100%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 top-24 h-72 w-72 rounded-full opacity-[0.07]"
        style={{ background: 'radial-gradient(circle, #0b5cff, transparent 70%)' }}
      />

      <div
        className={`relative mx-auto flex max-w-3xl flex-col justify-center px-2 py-10 transition-all duration-700 ease-out sm:px-4 sm:py-16 ${
          visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
        }`}
      >
        <p className="mb-4 text-[11px] font-medium tracking-[0.18em] text-navy-500/80 uppercase">
          KPI Performance
        </p>

        <p className="mb-2 text-sm text-slate-500 sm:text-[15px]">
          {today}
          {selectedYear && selectedMonth != null
            ? ` · ${selectedYear}년 ${selectedMonth}월 기준`
            : ''}
        </p>

        <h1 className="text-[1.85rem] font-bold leading-tight tracking-tight text-navy-950 sm:text-[2.35rem]">
          {dept ? (
            <>
              <span className="text-navy-700">{dept}</span>
              <span className="mx-1.5 font-normal text-slate-400">·</span>
            </>
          ) : null}
          <span>{name}</span>
          <span className="font-semibold text-slate-700">님</span>
        </h1>

        <p
          className={`mt-3 text-lg text-slate-600 sm:text-xl transition-all delay-150 duration-700 ease-out ${
            visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
          }`}
        >
          {greeting}.
          <span className="mt-1 block text-[15px] text-slate-500 sm:mt-1.5">
            {currentUser?.role === ROLES.DEPT_ADMIN
              ? <>좌측 <span className="font-semibold text-slate-700">실적 입력</span>에서 주관 부서 실적을 수정할 수 있습니다.</>
              : '배정된 그룹에서 성과 현황을 확인하실 수 있습니다.'}
          </span>
        </p>

        <div
          className={`mt-8 flex flex-wrap items-center gap-2 transition-all delay-200 duration-700 ${
            visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
          }`}
        >
          {roleLabel && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-navy-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold text-navy-800 shadow-sm backdrop-blur">
              <Sparkles className="h-3 w-3 text-bank-blue" />
              {roleLabel}
            </span>
          )}
          {currentUser?.employeeNo && (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-[11px] text-slate-500">
              사번 {currentUser.employeeNo}
            </span>
          )}
        </div>

        <div
          className={`mt-10 transition-all delay-300 duration-700 ${
            visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold text-slate-600">
            <Building2 className="h-3.5 w-3.5 text-navy-500" />
            바로가기
          </div>

          {groupList.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {groupList.map((g) => (
                <li key={g}>
                  <button
                    type="button"
                    onClick={() => onGroupClick?.(g)}
                    className="group flex w-full items-center justify-between rounded-xl border border-slate-200/90 bg-white/90 px-4 py-3.5 text-left shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-bank-blue/35 hover:shadow-md"
                  >
                    <span className="text-sm font-semibold text-slate-800">{g}</span>
                    <ArrowRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-bank-blue" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center text-sm text-slate-500">
              배정된 그룹이 없습니다. 관리자에게 권한을 요청해 주세요.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
