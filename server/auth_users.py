# -*- coding: utf-8 -*-
"""사용자 계정·로그인 (SQLite). 프론트 localStorage POC 대체."""
from __future__ import annotations

import json
import re
import time
from typing import Any

# 프론트 authService.hashPassword 와 동일 알고리즘 (POC 해시)
def hash_password(value: str | None) -> str:
    h = 2166136261 & 0xFFFFFFFF
    for ch in str(value or ""):
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return f"poc-{h:08x}"


DEFAULT_SEED_USERS = [
    {
        "id": "u-admin",
        "employee_no": "00000001",
        "name": "시스템 관리자",
        "password": "admin123!",
        "role": "admin",
        "group_name": "",
        "department": "디지털혁신부",
        "allowed_groups": [],
        "allowed_departments": [],
        "active": True,
    },
    {
        "id": "u-exec",
        "employee_no": "00000002",
        "name": "임원 사용자",
        "password": "exec123!",
        "role": "executive",
        "group_name": "",
        "department": "경영진",
        "allowed_groups": [],
        "allowed_departments": [],
        "active": True,
    },
    {
        "id": "u-group",
        "employee_no": "10000001",
        "name": "영업추진1그룹 관리자",
        "password": "group123!",
        "role": "group_admin",
        "group_name": "영업추진1그룹",
        "department": "영업추진1부",
        "allowed_groups": ["영업추진1그룹"],
        "allowed_departments": [],
        "active": True,
    },
    {
        "id": "u-dept",
        "employee_no": "20000001",
        "name": "고객솔루션부 관리자",
        "password": "dept123!",
        "role": "dept_admin",
        "group_name": "고객솔루션그룹",
        "department": "고객솔루션부",
        "allowed_groups": ["고객솔루션그룹"],
        "allowed_departments": ["고객솔루션부"],
        "active": True,
    },
]


def ensure_auth_tables(conn) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS app_user (
          user_id TEXT PRIMARY KEY,
          employee_no TEXT NOT NULL UNIQUE,
          user_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role_code TEXT NOT NULL,
          group_name TEXT NOT NULL DEFAULT '',
          department_name TEXT NOT NULL DEFAULT '',
          allowed_groups_json TEXT NOT NULL DEFAULT '[]',
          allowed_departments_json TEXT NOT NULL DEFAULT '[]',
          is_active TEXT NOT NULL DEFAULT 'Y',
          last_login_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS ix_app_user_employee_no ON app_user(employee_no);
        CREATE INDEX IF NOT EXISTS ix_app_user_role ON app_user(role_code);

        CREATE TABLE IF NOT EXISTS app_auth_audit (
          log_id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          employee_no TEXT,
          user_id TEXT,
          session_id TEXT,
          result TEXT NOT NULL,
          reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS ix_app_auth_audit_time ON app_auth_audit(created_at);
        """
    )
    seed_default_users(conn)


def seed_default_users(conn) -> int:
    row = conn.execute("SELECT COUNT(*) AS c FROM app_user").fetchone()
    if int(row["c"] if row else 0) > 0:
        return 0
    n = 0
    for u in DEFAULT_SEED_USERS:
        _insert_user(
            conn,
            {
                "id": u["id"],
                "employeeNo": u["employee_no"],
                "name": u["name"],
                "passwordHash": hash_password(u["password"]),
                "role": u["role"],
                "group": u["group_name"],
                "department": u["department"],
                "allowedGroups": u["allowed_groups"],
                "allowedDepartments": u["allowed_departments"],
                "active": u["active"],
            },
            replace=False,
        )
        n += 1
    return n


def _yn(active: Any) -> str:
    if active is False or str(active).upper() in ("N", "0", "FALSE"):
        return "N"
    return "Y"


def _parse_json_list(raw: Any) -> list:
    if isinstance(raw, list):
        return [str(x) for x in raw if x is not None and str(x).strip() != ""]
    if not raw:
        return []
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
        if isinstance(data, list):
            return [str(x) for x in data if x is not None and str(x).strip() != ""]
    except Exception:
        pass
    return []


def row_to_user(row) -> dict:
    if row is None:
        return None
    d = dict(row)
    return {
        "id": d.get("user_id"),
        "employeeNo": d.get("employee_no"),
        "name": d.get("user_name"),
        "role": d.get("role_code"),
        "group": d.get("group_name") or "",
        "department": d.get("department_name") or "",
        "allowedGroups": _parse_json_list(d.get("allowed_groups_json")),
        "allowedDepartments": _parse_json_list(d.get("allowed_departments_json")),
        "active": str(d.get("is_active") or "Y").upper() != "N",
        "lastLoginAt": d.get("last_login_at"),
        "createdAt": d.get("created_at"),
        "updatedAt": d.get("updated_at"),
    }


def list_users(conn) -> list[dict]:
    cur = conn.execute(
        "SELECT * FROM app_user ORDER BY employee_no"
    )
    return [row_to_user(r) for r in cur.fetchall()]


def get_user_by_employee_no(conn, employee_no: str):
    cur = conn.execute(
        "SELECT * FROM app_user WHERE employee_no = ?",
        (str(employee_no or "").strip(),),
    )
    return cur.fetchone()


def append_audit(conn, *, event_type: str, employee_no: str = "", user_id: str = "",
                 session_id: str = "", result: str = "UNKNOWN", reason: str = "") -> None:
    log_id = f"audit-{int(time.time() * 1000)}-{abs(hash(f'{event_type}{employee_no}{time.time()}')) % 10**8}"
    conn.execute(
        """
        INSERT INTO app_auth_audit (log_id, event_type, employee_no, user_id, session_id, result, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (log_id, event_type, employee_no or "", user_id or "", session_id or "", result, reason or ""),
    )


def verify_login(conn, employee_no: str, password: str) -> dict:
    normalized = str(employee_no or "").strip()
    if not re.fullmatch(r"\d{8}", normalized):
        append_audit(conn, event_type="LOGIN_FAILED", employee_no=normalized, result="FAIL", reason="INVALID_EMPLOYEE_NO")
        return {"ok": False, "reason": "사번은 8자리 숫자로 입력해 주세요."}

    row = get_user_by_employee_no(conn, normalized)
    if row is None or str(row["is_active"] or "Y").upper() == "N":
        append_audit(conn, event_type="LOGIN_FAILED", employee_no=normalized, result="FAIL", reason="USER_NOT_FOUND_OR_INACTIVE")
        return {"ok": False, "reason": "사용자를 찾을 수 없거나 비활성 상태입니다."}

    if str(row["password_hash"] or "") != hash_password(password):
        append_audit(
            conn,
            event_type="LOGIN_FAILED",
            employee_no=normalized,
            user_id=row["user_id"],
            result="FAIL",
            reason="BAD_CREDENTIAL",
        )
        return {"ok": False, "reason": "사번 또는 비밀번호가 올바르지 않습니다."}

    conn.execute(
        "UPDATE app_user SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?",
        (row["user_id"],),
    )
    append_audit(
        conn,
        event_type="LOGIN_SUCCESS",
        employee_no=normalized,
        user_id=row["user_id"],
        result="SUCCESS",
        reason="PASSWORD",
    )
    fresh = get_user_by_employee_no(conn, normalized)
    return {"ok": True, "user": row_to_user(fresh)}


def _insert_user(conn, payload: dict, *, replace: bool = False) -> str:
    employee_no = str(payload.get("employeeNo") or payload.get("employee_no") or "").strip()
    if not re.fullmatch(r"\d{8}", employee_no):
        raise ValueError("사번은 8자리 숫자여야 합니다.")
    name = str(payload.get("name") or payload.get("user_name") or "").strip()
    if not name:
        raise ValueError("사용자명을 입력해 주세요.")
    role = str(payload.get("role") or payload.get("role_code") or "group_admin").strip()
    user_id = str(payload.get("id") or payload.get("user_id") or f"u-{int(time.time() * 1000)}")
    group_name = str(payload.get("group") or payload.get("group_name") or "").strip()
    department = str(payload.get("department") or payload.get("department_name") or "").strip()
    allowed_groups = payload.get("allowedGroups")
    if allowed_groups is None:
        allowed_groups = payload.get("allowed_groups")
    allowed_departments = payload.get("allowedDepartments")
    if allowed_departments is None:
        allowed_departments = payload.get("allowed_departments")
    allowed_groups = _parse_json_list(allowed_groups if allowed_groups is not None else [])
    allowed_departments = _parse_json_list(allowed_departments if allowed_departments is not None else [])
    if not group_name and allowed_groups:
        group_name = allowed_groups[0]

    password = payload.get("password")
    password_hash = payload.get("passwordHash") or payload.get("password_hash")
    if password:
        password_hash = hash_password(str(password))

    active = payload.get("active", True)
    if "is_active" in payload:
        active = str(payload.get("is_active")).upper() != "N"

    existing = get_user_by_employee_no(conn, employee_no)
    if existing:
        # 동일 사번은 기존 row 갱신 (id가 달라도 이관/재저장 가능)
        user_id = existing["user_id"]
        sets = [
            "user_name = ?",
            "role_code = ?",
            "group_name = ?",
            "department_name = ?",
            "allowed_groups_json = ?",
            "allowed_departments_json = ?",
            "is_active = ?",
            "updated_at = datetime('now')",
        ]
        params: list[Any] = [
            name,
            role,
            group_name,
            department,
            json.dumps(allowed_groups, ensure_ascii=False),
            json.dumps(allowed_departments, ensure_ascii=False),
            _yn(active),
        ]
        if password_hash:
            sets.insert(0, "password_hash = ?")
            params.insert(0, password_hash)
        params.append(user_id)
        conn.execute(f"UPDATE app_user SET {', '.join(sets)} WHERE user_id = ?", params)
        return user_id

    by_id = conn.execute("SELECT user_id FROM app_user WHERE user_id = ?", (user_id,)).fetchone()
    if by_id:
        sets = [
            "employee_no = ?",
            "user_name = ?",
            "role_code = ?",
            "group_name = ?",
            "department_name = ?",
            "allowed_groups_json = ?",
            "allowed_departments_json = ?",
            "is_active = ?",
            "updated_at = datetime('now')",
        ]
        params = [
            employee_no,
            name,
            role,
            group_name,
            department,
            json.dumps(allowed_groups, ensure_ascii=False),
            json.dumps(allowed_departments, ensure_ascii=False),
            _yn(active),
        ]
        if password_hash:
            sets.insert(2, "password_hash = ?")
            params.insert(2, password_hash)
        params.append(user_id)
        conn.execute(f"UPDATE app_user SET {', '.join(sets)} WHERE user_id = ?", params)
        return user_id

    if not password_hash:
        raise ValueError("비밀번호가 필요합니다.")

    conn.execute(
        """
        INSERT INTO app_user (
          user_id, employee_no, user_name, password_hash, role_code,
          group_name, department_name, allowed_groups_json, allowed_departments_json, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            employee_no,
            name,
            password_hash,
            role,
            group_name,
            department,
            json.dumps(allowed_groups, ensure_ascii=False),
            json.dumps(allowed_departments, ensure_ascii=False),
            _yn(active),
        ),
    )
    return user_id


def upsert_user(conn, payload: dict) -> dict:
    user_id = _insert_user(conn, payload, replace=True)
    row = conn.execute("SELECT * FROM app_user WHERE user_id = ?", (user_id,)).fetchone()
    append_audit(
        conn,
        event_type="PERMISSION_CHANGED",
        employee_no=row["employee_no"],
        user_id=user_id,
        result="SUCCESS",
        reason="사용자 저장",
    )
    return row_to_user(row)


def import_users(conn, users: list) -> dict:
    """localStorage 등에서 일괄 이관. passwordHash 또는 password 필수."""
    if not isinstance(users, list):
        raise ValueError("users(list) required")
    ok = 0
    errors = []
    for i, raw in enumerate(users):
        try:
            if not isinstance(raw, dict):
                raise ValueError("invalid user object")
            upsert_user(conn, raw)
            ok += 1
        except Exception as e:
            errors.append({"index": i, "employeeNo": (raw or {}).get("employeeNo"), "error": str(e)})
    return {"ok": True, "imported": ok, "errors": errors, "total": len(users)}
