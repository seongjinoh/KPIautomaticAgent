import { api } from './apiClient'

const SESSION_KEY = 'auth.session.v1'
const AUDIT_LOG_KEY = 'auth.audit.v1'
/** 예전 브라우저 로컬 사용자 DB — 서버 이관용으로만 읽음 */
const LEGACY_USER_DB_KEY = 'auth.users.v1'

export const ROLES = {
  ADMIN: 'admin',
  EXECUTIVE: 'executive',
  GROUP_ADMIN: 'group_admin',
  DEPT_ADMIN: 'dept_admin',
}

export const ROLE_LABELS = {
  [ROLES.ADMIN]: '관리자',
  [ROLES.EXECUTIVE]: '임원',
  [ROLES.GROUP_ADMIN]: '그룹별 관리자',
  [ROLES.DEPT_ADMIN]: '부서별 관리자',
}

function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

/** @deprecated 서버에서 해싱. 이관·OTP용으로만 유지 */
export function hashPassword(value) {
  let h = 2166136261
  const text = String(value ?? '')
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `poc-${(h >>> 0).toString(16).padStart(8, '0')}`
}

export async function listUsers() {
  const data = await api.listAuthUsers()
  return data?.items || []
}

export async function upsertUser(user) {
  const payload = {
    id: user.id,
    employeeNo: String(user.employeeNo ?? '').trim(),
    name: user.name,
    role: user.role,
    group: user.group || '',
    department: user.department || '',
    allowedGroups: Array.isArray(user.allowedGroups) ? user.allowedGroups : [],
    allowedDepartments: Array.isArray(user.allowedDepartments) ? user.allowedDepartments : [],
    active: user.active !== false,
  }
  if (user.password) payload.password = user.password
  else if (user.passwordHash) payload.passwordHash = user.passwordHash
  await api.upsertAuthUser(payload)
  appendAuthAudit({
    eventType: 'PERMISSION_CHANGED',
    employeeNo: payload.employeeNo,
    userId: payload.id,
    result: 'SUCCESS',
    reason: payload.id ? '사용자 권한 수정' : '신규 사용자 등록',
  })
  return listUsers()
}

/** 이 PC localStorage에만 있던 사용자를 서버로 일괄 이관 */
export function readLegacyLocalUsers() {
  const users = readJson(LEGACY_USER_DB_KEY, null)
  return Array.isArray(users) ? users : []
}

export async function syncLegacyUsersToServer() {
  const legacy = readLegacyLocalUsers()
  if (!legacy.length) {
    return { ok: false, reason: '이 브라우저에 이관할 로컬 사용자가 없습니다.' }
  }
  const result = await api.importAuthUsers(legacy)
  return result
}

export async function loginWithPassword(employeeNo, password) {
  const verified = await verifyPassword(employeeNo, password)
  if (!verified.ok) return verified
  return establishSession(verified.user, { mfaMethod: 'password_only' })
}

/** 1단계: 사번·비밀번호 검증 (서버) — 세션 미생성 */
export async function verifyPassword(employeeNo, password) {
  const normalizedNo = String(employeeNo ?? '').trim()
  if (!/^\d{8}$/.test(normalizedNo)) {
    appendAuthAudit({ eventType: 'LOGIN_FAILED', employeeNo: normalizedNo, result: 'FAIL', reason: 'INVALID_EMPLOYEE_NO' })
    return { ok: false, reason: '사번은 8자리 숫자로 입력해 주세요.' }
  }
  try {
    const data = await api.loginAuth(normalizedNo, password)
    if (!data?.ok || !data?.user) {
      return { ok: false, reason: data?.reason || '로그인에 실패했습니다.' }
    }
    return { ok: true, user: sanitizeUser(data.user) }
  } catch (e) {
    const reason = e?.data?.reason || e?.data?.message || e?.message || '로그인에 실패했습니다.'
    appendAuthAudit({
      eventType: 'LOGIN_FAILED',
      employeeNo: normalizedNo,
      result: 'FAIL',
      reason: String(reason).slice(0, 200),
    })
    return { ok: false, reason }
  }
}

export function establishSession(user, { mfaMethod = '' } = {}) {
  const session = sanitizeUser({
    ...user,
    sessionId: `sess-${Date.now()}`,
    loginAt: new Date().toISOString(),
    mfaMethod,
  })
  writeJson(SESSION_KEY, session)
  appendAuthAudit({
    eventType: 'LOGIN_SUCCESS',
    employeeNo: user.employeeNo,
    userId: user.id,
    sessionId: session.sessionId,
    result: 'SUCCESS',
    reason: mfaMethod ? `MFA:${mfaMethod}` : '',
  })
  return { ok: true, user: session }
}

const SMS_OTP_KEY = 'auth.sms.otp.v1'
const SMS_OTP_TTL_MS = 3 * 60 * 1000

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/**
 * SMS OTP 발송 (POC 스텁).
 * 계정 검증은 verifyPassword(서버) 이후 호출.
 */
export function requestSmsOtp(employeeNo) {
  const normalizedNo = String(employeeNo ?? '').trim()
  if (!/^\d{8}$/.test(normalizedNo)) {
    return { ok: false, reason: '사번은 8자리 숫자로 입력해 주세요.' }
  }
  const code = generateOtp()
  const requestId = `sms-${Date.now()}`
  const expiresAt = Date.now() + SMS_OTP_TTL_MS
  writeJson(SMS_OTP_KEY, {
    requestId,
    employeeNo: normalizedNo,
    codeHash: hashPassword(code),
    demoCode: code,
    expiresAt,
    attempts: 0,
  })
  appendAuthAudit({
    eventType: 'SMS_OTP_SENT',
    employeeNo: normalizedNo,
    result: 'SUCCESS',
    reason: requestId,
  })
  return {
    ok: true,
    requestId,
    expiresInSec: Math.floor(SMS_OTP_TTL_MS / 1000),
    maskedPhone: `010-****-${normalizedNo.slice(-4)}`,
    demoCode: code,
    api: {
      send: 'POST /api/auth/sms/send',
      verify: 'POST /api/auth/sms/verify',
    },
  }
}

export function verifySmsOtp(employeeNo, code) {
  const normalizedNo = String(employeeNo ?? '').trim()
  const otp = String(code ?? '').trim()
  const pending = readJson(SMS_OTP_KEY, null)
  if (!pending || pending.employeeNo !== normalizedNo) {
    return { ok: false, reason: '인증번호 발송 내역이 없습니다. 다시 발송해 주세요.' }
  }
  if (Date.now() > pending.expiresAt) {
    return { ok: false, reason: '인증번호가 만료되었습니다. 다시 발송해 주세요.' }
  }
  if ((pending.attempts || 0) >= 5) {
    return { ok: false, reason: '인증 시도 횟수를 초과했습니다.' }
  }
  pending.attempts = (pending.attempts || 0) + 1
  writeJson(SMS_OTP_KEY, pending)
  if (pending.codeHash !== hashPassword(otp)) {
    appendAuthAudit({
      eventType: 'SMS_OTP_FAILED',
      employeeNo: normalizedNo,
      result: 'FAIL',
      reason: 'BAD_OTP',
    })
    return { ok: false, reason: '인증번호가 올바르지 않습니다.' }
  }
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(SMS_OTP_KEY)
  }
  appendAuthAudit({
    eventType: 'SMS_OTP_VERIFIED',
    employeeNo: normalizedNo,
    result: 'SUCCESS',
    reason: pending.requestId,
  })
  return { ok: true, requestId: pending.requestId }
}

export function getCurrentSession() {
  return readJson(SESSION_KEY, null)
}

export function logout() {
  if (typeof window === 'undefined') return
  const session = getCurrentSession()
  appendAuthAudit({
    eventType: 'LOGOUT',
    employeeNo: session?.employeeNo,
    userId: session?.id,
    sessionId: session?.sessionId,
    result: 'SUCCESS',
  })
  window.localStorage.removeItem(SESSION_KEY)
}

export function listAuthAuditLogs() {
  return readJson(AUDIT_LOG_KEY, [])
}

export function appendAuthAudit(event) {
  const logs = readJson(AUDIT_LOG_KEY, [])
  const next = [
    {
      id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      eventType: event.eventType,
      employeeNo: event.employeeNo || '',
      userId: event.userId || '',
      sessionId: event.sessionId || '',
      result: event.result || 'UNKNOWN',
      reason: event.reason || '',
      createdAt: new Date().toISOString(),
    },
    ...logs,
  ].slice(0, 500)
  writeJson(AUDIT_LOG_KEY, next)
}

export function sanitizeUser(user) {
  if (!user) return null
  const { passwordHash, password_hash, ...safe } = user
  return safe
}

export function canManageUsers(user) {
  return user?.role === ROLES.ADMIN
}

export function canAccessAdminMenu(user) {
  return user?.role === ROLES.ADMIN
}

/** 실적 입력 메뉴 — admin · 그룹 관리자 · 부서 관리자 */
export function canAccessDeptFactEntry(user) {
  return (
    user?.role === ROLES.ADMIN
    || user?.role === ROLES.GROUP_ADMIN
    || user?.role === ROLES.DEPT_ADMIN
  )
}

/** 그룹 「지표 확인」 — admin · 해당 그룹 관리자 */
export function canConfirmGroupFacts(user, groupNameOrCode) {
  if (!user) return false
  if (user.role === ROLES.ADMIN) return true
  if (user.role !== ROLES.GROUP_ADMIN) return false
  if (!groupNameOrCode) return true
  const allowed = resolveAllowedGroupList(user)
  return allowed.includes(groupNameOrCode)
}

/** 월 실적 최종 확정(Freeze) — admin only */
export function canFreezePeriod(user) {
  return user?.role === ROLES.ADMIN
}

export function canAccessBankKpi(user) {
  return user?.role === ROLES.ADMIN || user?.role === ROLES.EXECUTIVE
}

/** 접근 가능 그룹 목록. allowedGroups 배열이 있으면(빈 배열 포함) 그것만 사용. */
export function resolveAllowedGroupList(user) {
  if (!user) return []
  if (Array.isArray(user.allowedGroups)) {
    return user.allowedGroups.filter(Boolean)
  }
  return user.group ? [user.group] : []
}

/** 전행 「전체 현황」 대시보드 — admin만 (메뉴 3종과 동일) */
export function canAccessDashboard(user) {
  return canAccessAdminMenu(user)
}

/** 사이드바 「메뉴」 구간(전체 현황 · AI Agent · 이상치) — admin만 */
export function canAccessTopMenu(user) {
  return canAccessAdminMenu(user)
}

/** 그룹·부서 관리자의 배정 그룹 후보 (전행 제외 역할용) */
export function preferredGroupsForUser(user) {
  if (!user) return []
  if (user.role === ROLES.ADMIN || user.role === ROLES.EXECUTIVE) return []
  return resolveAllowedGroupList(user)
}

/**
 * 역할별 로그인 홈.
 * - admin → dashboard
 * - 그 외 → 환영 홈(home). 그룹 상세는 사이드바/바로가기로 진입
 */
export function resolveHomeForUser(user, availableGroups = []) {
  if (!user) return { view: 'home', selectedGroup: null }
  if (canAccessDashboard(user)) {
    return { view: 'dashboard', selectedGroup: null }
  }
  return { view: 'home', selectedGroup: null }
}

/** 전행 = 은행 KPI. 별도 '은행KPI' 메뉴 없이 그룹으로만 노출. */
export function isBankWideGroup(groupName) {
  return String(groupName || '').trim() === '전행'
}

export function canWriteKpi(user, def) {
  if (!user || !def) return false
  if (user.role === ROLES.ADMIN) return true
  if (user.role === ROLES.GROUP_ADMIN) {
    return canReadGroup(user, def.group)
  }
  if (user.role !== ROLES.DEPT_ADMIN) return false
  const allowedDepartments = user.allowedDepartments?.length ? user.allowedDepartments : [user.department]
  return allowedDepartments.includes(def.dept)
}

export function canReadGroup(user, groupName) {
  if (!user || !groupName) return false
  if (isBankWideGroup(groupName) && !canAccessBankKpi(user)) return false
  if (user.role === ROLES.ADMIN || user.role === ROLES.EXECUTIVE) return true
  return resolveAllowedGroupList(user).includes(groupName)
}

export function canReadDefinition(user, def) {
  if (!user || !def) return false
  if (user.role === ROLES.ADMIN || user.role === ROLES.EXECUTIVE) return true
  if (user.role === ROLES.GROUP_ADMIN) return canReadGroup(user, def.group)
  if (user.role === ROLES.DEPT_ADMIN) {
    const groups = resolveAllowedGroupList(user)
    const departments = user.allowedDepartments?.length ? user.allowedDepartments : [user.department]
    return groups.includes(def.group) && departments.includes(def.dept)
  }
  return false
}

export function filterDefinitionsForUser(user, definitions) {
  return (definitions || []).filter(def => canReadDefinition(user, def))
}

export function filterResultsForUser(user, results, definitions) {
  const allowedCodes = new Set(filterDefinitionsForUser(user, definitions).map(def => def.code))
  return (results || []).filter(result => allowedCodes.has(result.code))
}

export function allowedGroupsForUser(user, groups) {
  if (!user) return []
  const base = (groups || []).filter(group => {
    if (isBankWideGroup(group) && !canAccessBankKpi(user)) return false
    return true
  })
  if (user.role === ROLES.ADMIN || user.role === ROLES.EXECUTIVE) return base
  const allowed = resolveAllowedGroupList(user)
  return base.filter(group => allowed.includes(group))
}

export function roleDescription(role) {
  if (role === ROLES.ADMIN) return '관리·메뉴(전체현황/Agent/이상치)와 전체 데이터 조회/쓰기 · 메인: 전체 현황'
  if (role === ROLES.EXECUTIVE) return '메뉴·관리 제외, 전행 포함 그룹 조회 · 메인: 환영 홈'
  if (role === ROLES.GROUP_ADMIN) return '배정 그룹 평가지표·실적 수정, 지표 확인 · 메인: 환영 홈'
  if (role === ROLES.DEPT_ADMIN) return '배정 부서 실적 입력 · 메인: 환영 홈'
  return '권한 미정'
}
