import { useEffect, useMemo, useState } from 'react'
import { Plus, Save, Shield, Search, Upload } from 'lucide-react'
import {
  ROLE_LABELS,
  ROLES,
  listUsers,
  readLegacyLocalUsers,
  roleDescription,
  syncLegacyUsersToServer,
  upsertUser,
} from '../lib/authService'

const emptyDraft = {
  employeeNo: '',
  name: '',
  password: '',
  role: ROLES.GROUP_ADMIN,
  group: '',
  department: '',
  allowedGroups: [],
  allowedDepartmentsText: '',
  active: true,
}

export default function UserAdminView({ groups = [] }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(emptyDraft)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const legacyCount = useMemo(() => readLegacyLocalUsers().length, [users, message])

  const reload = async () => {
    setLoading(true)
    try {
      const items = await listUsers()
      setUsers(items)
    } catch (e) {
      setMessage(e?.data?.message || e?.message || '사용자 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(user =>
      user.employeeNo?.includes(q) ||
      user.name?.toLowerCase().includes(q) ||
      user.department?.toLowerCase().includes(q) ||
      ROLE_LABELS[user.role]?.toLowerCase().includes(q)
    )
  }, [users, query])

  const editUser = (user) => {
    setDraft({
      ...user,
      password: '',
      allowedDepartmentsText: (user.allowedDepartments || []).join(', '),
    })
    setMessage('')
  }

  const resetDraft = () => {
    setDraft(emptyDraft)
    setMessage('')
  }

  const toggleGroup = (group) => {
    setDraft(prev => {
      const exists = prev.allowedGroups?.includes(group)
      const allowedGroups = exists
        ? prev.allowedGroups.filter(g => g !== group)
        : [...(prev.allowedGroups || []), group]
      return { ...prev, allowedGroups, group: allowedGroups[0] || '' }
    })
  }

  const save = async () => {
    if (!/^\d{8}$/.test(draft.employeeNo)) {
      setMessage('사번은 8자리 숫자여야 합니다.')
      return
    }
    if (!draft.name.trim()) {
      setMessage('사용자명을 입력해 주세요.')
      return
    }
    if (!draft.id && !draft.password) {
      setMessage('신규 사용자는 초기 비밀번호가 필요합니다.')
      return
    }
    if (users.some(user => user.employeeNo === draft.employeeNo && user.id !== draft.id)) {
      setMessage('동일한 사번이 이미 존재합니다.')
      return
    }

    const allowedDepartments = draft.allowedDepartmentsText
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)

    const allowedGroups = Array.isArray(draft.allowedGroups) ? draft.allowedGroups.filter(Boolean) : []
    const payload = {
      id: draft.id,
      employeeNo: draft.employeeNo,
      name: draft.name,
      role: draft.role,
      department: draft.department,
      allowedGroups,
      group: allowedGroups[0] || '',
      allowedDepartments,
      active: draft.active !== false,
    }
    if (draft.password) payload.password = draft.password

    setSaving(true)
    try {
      const next = await upsertUser(payload)
      setUsers(next)
      setMessage('서버에 권한 정보가 저장되었습니다. 다른 PC에서도 로그인할 수 있습니다.')
      setDraft(emptyDraft)
    } catch (e) {
      setMessage(e?.data?.message || e?.message || '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const syncLegacy = async () => {
    setSaving(true)
    try {
      const result = await syncLegacyUsersToServer()
      if (result?.ok === false && result?.reason) {
        setMessage(result.reason)
        return
      }
      await reload()
      const errN = (result?.errors || []).length
      setMessage(
        `로컬 사용자 ${result?.imported ?? 0}명을 서버로 이관했습니다.`
        + (errN ? ` (실패 ${errN}건)` : '')
        + ' 이제 다른 PC에서도 동일 계정으로 로그인됩니다.',
      )
    } catch (e) {
      setMessage(e?.data?.message || e?.message || '이관에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-black text-slate-800">사용자 권한관리</h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              사용자 정보는 서버(SQLite)에 저장됩니다. 한 번 등록하면 모든 PC에서 로그인할 수 있습니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {legacyCount > 0 && (
              <button
                type="button"
                disabled={saving}
                onClick={syncLegacy}
                className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 disabled:opacity-50"
                title="이 브라우저 localStorage에 남아 있는 예전 사용자를 서버로 옮깁니다"
              >
                <Upload className="w-3.5 h-3.5" />
                로컬 {legacyCount}명 → 서버 이관
              </button>
            )}
            <button onClick={resetDraft} className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">
              <Plus className="w-3.5 h-3.5" />
              신규 사용자
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.95fr] gap-5">
        <section className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
            <h4 className="text-sm font-bold text-slate-700">
              회원 목록 {loading ? '(불러오는 중…)' : `(${users.length})`}
            </h4>
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="사번/이름/부서 검색"
                className="w-44 bg-transparent outline-none text-xs text-slate-700"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">사번</th>
                  <th className="px-3 py-2 text-left">이름</th>
                  <th className="px-3 py-2 text-left">역할</th>
                  <th className="px-3 py-2 text-left">그룹</th>
                  <th className="px-3 py-2 text-left">부서</th>
                  <th className="px-3 py-2 text-center">상태</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(user => (
                  <tr key={user.id} onClick={() => editUser(user)} className="border-t border-slate-100 cursor-pointer hover:bg-blue-50/50">
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{user.employeeNo}</td>
                    <td className="px-3 py-2 font-semibold text-slate-800">{user.name}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                        {ROLE_LABELS[user.role]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{(user.allowedGroups || []).filter(Boolean).join(', ') || '-'}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{user.department || '-'}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${user.active === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>
                        {user.active === false ? '비활성' : '활성'}
                      </span>
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-400">등록된 사용자가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h4 className="text-sm font-bold text-slate-700">{draft.id ? '사용자 수정' : '신규 사용자 등록'}</h4>
            <p className="text-[11px] text-slate-400 mt-1">{roleDescription(draft.role)}</p>
          </div>
          <div className="p-4 space-y-3">
            <Field label="사번(8자리)">
              <input value={draft.employeeNo} onChange={e => setDraft(p => ({ ...p, employeeNo: e.target.value.replace(/\D/g, '').slice(0, 8) }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-blue-400" />
            </Field>
            <Field label="이름">
              <input value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-blue-400" />
            </Field>
            <Field label={draft.id ? '비밀번호 재설정(선택)' : '초기 비밀번호'}>
              <input value={draft.password} onChange={e => setDraft(p => ({ ...p, password: e.target.value }))} type="password" className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-blue-400" />
            </Field>
            <Field label="역할">
              <select value={draft.role} onChange={e => setDraft(p => ({ ...p, role: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-blue-400">
                {Object.values(ROLES).map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
              </select>
            </Field>
            <Field label="대표 부서">
              <input value={draft.department} onChange={e => setDraft(p => ({ ...p, department: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-blue-400" />
            </Field>
            <Field label="접근 가능 그룹">
              <div className="grid grid-cols-2 gap-1.5">
                {groups.map(group => (
                  <label key={group} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-600">
                    <input type="checkbox" checked={draft.allowedGroups?.includes(group)} onChange={() => toggleGroup(group)} />
                    <span className="truncate">{group}</span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label="접근 가능 부서(쉼표 구분)">
              <input
                value={draft.allowedDepartmentsText}
                onChange={e => setDraft(p => ({ ...p, allowedDepartmentsText: e.target.value }))}
                placeholder="예: 고객솔루션부, 플랫폼영업부"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-blue-400"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={draft.active !== false} onChange={e => setDraft(p => ({ ...p, active: e.target.checked }))} />
              활성 사용자
            </label>

            {message && <p className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600 whitespace-pre-wrap">{message}</p>}
          </div>
          <div className="px-4 py-3 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block text-xs text-slate-500 space-y-1">
      <span className="font-semibold">{label}</span>
      {children}
    </label>
  )
}
