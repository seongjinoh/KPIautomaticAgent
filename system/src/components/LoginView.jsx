import { useEffect, useState } from 'react'
import {
  BarChart3, Bot, FileText, LockKeyhole, MessageSquare, ScanFace, ShieldCheck, UserRound,
} from 'lucide-react'
import {
  establishSession,
  requestSmsOtp,
  verifyPassword,
  verifySmsOtp,
} from '../lib/authService'
import {
  authenticateWithWindowsHello,
  isPlatformAuthenticatorAvailable,
  isWebAuthnAvailable,
} from '../lib/webAuthnService'

export default function LoginView({ onLogin }) {
  const [employeeNo, setEmployeeNo] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [helloReady, setHelloReady] = useState(null)

  const [smsStep, setSmsStep] = useState(false)
  const [otp, setOtp] = useState('')
  const [smsMeta, setSmsMeta] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isWebAuthnAvailable()) {
        if (!cancelled) setHelloReady(false)
        return
      }
      const ok = await isPlatformAuthenticatorAvailable()
      if (!cancelled) setHelloReady(ok)
    })()
    return () => { cancelled = true }
  }, [])

  const credentialsReady = employeeNo.length === 8 && Boolean(password)

  const runFaceLogin = async () => {
    setError('')
    if (!credentialsReady) {
      setError('사번과 비밀번호를 먼저 입력해 주세요.')
      return
    }
    setBusy(true)
    try {
      const verified = await verifyPassword(employeeNo, password)
      if (!verified.ok) {
        setError(verified.reason)
        return
      }
      await authenticateWithWindowsHello({
        employeeNo,
        displayName: verified.user.name || employeeNo,
      })
      const session = establishSession(verified.user, { mfaMethod: 'face_windows_hello' })
      onLogin?.(session.user)
    } catch (e) {
      setError(e?.message || '안면인증에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const runSmsSend = async () => {
    setError('')
    if (!credentialsReady) {
      setError('사번과 비밀번호를 먼저 입력해 주세요.')
      return
    }
    setBusy(true)
    try {
      const verified = await verifyPassword(employeeNo, password)
      if (!verified.ok) {
        setError(verified.reason)
        return
      }
      const sent = requestSmsOtp(employeeNo)
      if (!sent.ok) {
        setError(sent.reason)
        return
      }
      setSmsMeta(sent)
      setSmsStep(true)
      setOtp('')
    } catch (e) {
      setError(e?.message || 'SMS 인증번호 발송에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const runSmsVerify = async (e) => {
    e?.preventDefault?.()
    setError('')
    if (otp.trim().length !== 6) {
      setError('인증번호 6자리를 입력해 주세요.')
      return
    }
    setBusy(true)
    try {
      const verified = await verifyPassword(employeeNo, password)
      if (!verified.ok) {
        setError(verified.reason)
        setSmsStep(false)
        return
      }
      const otpResult = verifySmsOtp(employeeNo, otp)
      if (!otpResult.ok) {
        setError(otpResult.reason)
        return
      }
      const session = establishSession(verified.user, { mfaMethod: 'sms_otp' })
      onLogin?.(session.user)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50 to-slate-100 px-6 py-6">
      <header className="mx-auto flex max-w-7xl items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-blue-700" />
          <span className="text-sm font-black text-navy-950">종합기획부 · Internal Platform</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>내부망 전용 시스템</span>
          <span>KOR</span>
        </div>
      </header>

      <div className="mx-auto mt-12 grid max-w-7xl grid-cols-1 items-center gap-10 lg:grid-cols-[1.25fr_0.75fr]">
        <section className="text-navy-950">
          <div>
            <p className="text-sm font-bold tracking-[0.24em] text-blue-700">PERFORMANCE AI AGENT</p>
            <h2 className="mt-5 text-5xl font-black leading-tight tracking-tight">
              성과평가 자동화 <span className="text-blue-600">Agent</span>
            </h2>
            <p className="mt-4 text-xl font-bold text-slate-800">조회 · 산정 · 센싱 · 해석 · 보고를 지원하는 내부망 기반 AI Agent</p>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              현업 주도 AI Agent의 행내 반입·운영 표준모델과 성과관리의 데이터 기반 전환을 동시에 추진합니다.
            </p>
          </div>

          <div className="mt-8 grid max-w-3xl grid-cols-2 gap-4 md:grid-cols-4">
            <FeatureCard icon={<BarChart3 />} title="KPI 실적 조회" text="핵심 지표 산출·비교" />
            <FeatureCard icon={<Bot />} title="달성률 자동 산정" text="설정 기반 자동계산" />
            <FeatureCard icon={<ShieldCheck />} title="이상치 센싱" text="휴먼에러 사전감지" />
            <FeatureCard icon={<FileText />} title="보고서 초안" text="데이터 기반 문안 생성" />
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
            {['내부망 전용', 'RBAC', '2FA(안면·SMS)', '행내 LLM'].map(label => (
              <span key={label} className="rounded-2xl border border-blue-100 bg-white px-5 py-3 text-sm font-bold text-blue-800 shadow-sm">
                {label}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-100 bg-white/95 p-8 shadow-2xl shadow-blue-100/70">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50">
              <LockKeyhole className="h-7 w-7 text-blue-600" />
            </div>
            <p className="text-xs font-bold tracking-widest text-blue-600 uppercase">Secure Access</p>
            <h2 className="mt-2 text-2xl font-black text-slate-900">로그인</h2>
            <p className="mt-2 text-sm text-slate-500">SWING 연동 · 2단계 인증 (안면 / SMS)</p>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">사번</span>
              <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 focus-within:border-blue-400">
                <UserRound className="w-4 h-4 text-slate-400" />
                <input
                  value={employeeNo}
                  onChange={(e) => {
                    setEmployeeNo(e.target.value.replace(/\D/g, '').slice(0, 8))
                    setSmsStep(false)
                    setSmsMeta(null)
                  }}
                  placeholder="8자리 사번"
                  className="w-full bg-transparent outline-none text-sm text-slate-800"
                  inputMode="numeric"
                  autoComplete="username"
                  disabled={busy}
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-500">비밀번호</span>
              <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 focus-within:border-blue-400">
                <LockKeyhole className="w-4 h-4 text-slate-400" />
                <input
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setSmsStep(false)
                    setSmsMeta(null)
                  }}
                  placeholder="비밀번호"
                  className="w-full bg-transparent outline-none text-sm text-slate-800"
                  type="password"
                  autoComplete="current-password"
                  disabled={busy}
                />
              </div>
            </label>

            {error && (
              <p className="rounded-xl bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-700 whitespace-pre-wrap">
                {error}
              </p>
            )}

            {!smsStep ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!credentialsReady || busy || helloReady === false}
                  onClick={runFaceLogin}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-sm font-bold text-white shadow-lg shadow-blue-100 transition-colors hover:bg-blue-800 disabled:opacity-40 disabled:hover:bg-blue-700"
                  title={helloReady === false ? 'Windows Hello를 사용할 수 없습니다' : 'Windows Hello 안면인증'}
                >
                  <ScanFace className="h-4 w-4" />
                  {busy ? '인증 중…' : '안면인증'}
                </button>
                <button
                  type="button"
                  disabled={!credentialsReady || busy}
                  onClick={runSmsSend}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white py-3 text-sm font-bold text-blue-800 shadow-sm transition-colors hover:bg-blue-50 disabled:opacity-40"
                >
                  <MessageSquare className="h-4 w-4" />
                  SMS인증
                </button>
              </div>
            ) : (
              <form onSubmit={runSmsVerify} className="space-y-3">
                {smsMeta?.demoCode && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                    <p className="font-bold">POC · SMS 미연동 — 인증번호 화면 표시</p>
                    <p className="mt-1 font-mono text-lg tracking-[0.3em] font-black">{smsMeta.demoCode}</p>
                    <p className="mt-1 text-[11px] text-amber-800/80">
                      발송처 {smsMeta.maskedPhone} · {smsMeta.expiresInSec}초 유효
                      <br />
                      운영 API: {smsMeta.api?.send} / {smsMeta.api?.verify}
                    </p>
                  </div>
                )}
                <label className="block">
                  <span className="text-xs font-semibold text-slate-500">SMS 인증번호</span>
                  <input
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6자리 인증번호"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm tracking-[0.35em] text-center font-mono outline-none focus:border-blue-400"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                  />
                </label>
                <button
                  type="submit"
                  disabled={otp.length !== 6 || busy}
                  className="w-full rounded-xl bg-blue-700 py-3 text-sm font-bold text-white shadow-lg shadow-blue-100 hover:bg-blue-800 disabled:opacity-40"
                >
                  인증 후 로그인
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setSmsStep(false); setSmsMeta(null); setOtp(''); setError('') }}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  인증 방식 다시 선택
                </button>
              </form>
            )}

            {helloReady === false && (
              <p className="text-[11px] leading-4 text-slate-400">
                Windows Hello를 사용할 수 없습니다. SMS 인증을 이용해 주세요. (HTTPS/localhost · Hello 설정 필요)
              </p>
            )}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[11px]">
            {['종합기획부', '그룹 담당자', '관리자'].map(label => (
              <span key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-slate-600">{label}</span>
            ))}
          </div>

          <div className="mt-5 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-xs leading-5 text-blue-800">
            SWING 2단계 인증: 계정(사번·비밀번호) 확인 후 안면(Windows Hello) 또는 SMS OTP 중 하나를 완료해야 로그인됩니다.
            접속 시 조회·응답 로그가 기록됩니다.
          </div>
        </section>
      </div>
    </div>
  )
}

function FeatureCard({ icon, title, text }) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-white p-4 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 [&>svg]:h-6 [&>svg]:w-6">
        {icon}
      </div>
      <p className="text-sm font-black text-slate-800">{title}</p>
      <p className="mt-1 text-[11px] leading-4 text-slate-400">{text}</p>
    </div>
  )
}
