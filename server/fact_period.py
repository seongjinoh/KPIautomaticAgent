# -*- coding: utf-8 -*-
"""실적 확인(그룹) · 최종 확정(Freeze) 상태."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fact_pipeline import eval_ym as to_eval_ym, resolve_plan_set


STATUS_OPEN = "open"
STATUS_CONFIRMED = "confirmed"
STATUS_FROZEN = "frozen"


def ensure_period_row(conn, ym: str) -> dict:
    row = conn.execute("SELECT * FROM fact_period_status WHERE eval_ym=?", (ym,)).fetchone()
    if row:
        return dict(row)
    conn.execute(
        "INSERT INTO fact_period_status(eval_ym, status) VALUES (?,?)",
        (ym, STATUS_OPEN),
    )
    conn.commit()
    return dict(conn.execute("SELECT * FROM fact_period_status WHERE eval_ym=?", (ym,)).fetchone())


def get_period_status(conn, year: int, month: int) -> dict[str, Any]:
    ym = to_eval_ym(year, month)
    period = ensure_period_row(conn, ym)
    plan = resolve_plan_set(conn, year, month)
    groups = []
    if plan:
        rows = conn.execute(
            """
            SELECT DISTINCT e.group_code, og.name AS group_name
            FROM eval_plan_item e
            JOIN owner_group og ON og.code = e.group_code
            WHERE e.plan_set_id=? AND COALESCE(e.use_yn,'Y')='Y'
            ORDER BY e.group_code
            """,
            (plan["id"],),
        ).fetchall()
        confirms = {
            r["group_code"]: dict(r)
            for r in conn.execute(
                "SELECT * FROM fact_group_confirm WHERE eval_ym=?", (ym,)
            ).fetchall()
        }
        for r in rows:
            c = confirms.get(r["group_code"]) or {}
            groups.append({
                "group_code": r["group_code"],
                "group_name": r["group_name"],
                "status": c.get("status") or STATUS_OPEN,
                "confirmed_by": c.get("confirmed_by") or "",
                "confirmed_at": c.get("confirmed_at"),
                "note": c.get("note") or "",
            })
    return {
        "year": year,
        "month": month,
        "eval_ym": ym,
        "period_status": period.get("status") or STATUS_OPEN,
        "frozen_by": period.get("frozen_by") or "",
        "frozen_at": period.get("frozen_at"),
        "note": period.get("note") or "",
        "groups": groups,
    }


def is_period_frozen(conn, ym: str) -> bool:
    row = conn.execute(
        "SELECT status FROM fact_period_status WHERE eval_ym=?", (ym,)
    ).fetchone()
    return bool(row and row["status"] == STATUS_FROZEN)


def is_group_confirmed(conn, ym: str, group_code: str) -> bool:
    row = conn.execute(
        """
        SELECT status FROM fact_group_confirm
        WHERE eval_ym=? AND group_code=?
        """,
        (ym, str(group_code or "").strip().upper()),
    ).fetchone()
    return bool(row and row["status"] == STATUS_CONFIRMED)


def assert_writable(
    conn,
    year: int,
    month: int,
    *,
    group_codes: list[str],
    actor_role: str = "",
) -> None:
    """저장 가능 여부. admin은 Freeze 전까지만, 그 외는 그룹 확인·Freeze 시 차단."""
    ym = to_eval_ym(year, month)
    if is_period_frozen(conn, ym):
        raise ValueError(f"{ym} 실적이 최종 확정(Freeze)되어 수정할 수 없습니다")
    role = str(actor_role or "").strip().lower()
    if role == "admin":
        return
    blocked = []
    for g in {str(x or "").strip().upper() for x in group_codes if x}:
        if is_group_confirmed(conn, ym, g):
            blocked.append(g)
    if blocked:
        raise ValueError(
            f"지표 확인 완료된 그룹은 관리자만 수정할 수 있습니다: {', '.join(sorted(blocked))}"
        )


def confirm_group(
    conn,
    year: int,
    month: int,
    *,
    group_code: str,
    acted_by: str = "ui",
    note: str = "",
) -> dict[str, Any]:
    ym = to_eval_ym(year, month)
    group_code = str(group_code or "").strip().upper()
    if not group_code:
        raise ValueError("group_code 필요")
    if is_period_frozen(conn, ym):
        raise ValueError(f"{ym} 은 이미 Freeze 상태입니다")
    now = datetime.now(timezone.utc).isoformat()
    ensure_period_row(conn, ym)
    existing = conn.execute(
        "SELECT status FROM fact_group_confirm WHERE eval_ym=? AND group_code=?",
        (ym, group_code),
    ).fetchone()
    if existing and existing["status"] == STATUS_CONFIRMED:
        return {"ok": True, "eval_ym": ym, "group_code": group_code, "status": STATUS_CONFIRMED, "message": "이미 확인됨"}
    conn.execute(
        """
        INSERT INTO fact_group_confirm(eval_ym, group_code, status, confirmed_by, confirmed_at, note)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(eval_ym, group_code) DO UPDATE SET
          status=excluded.status,
          confirmed_by=excluded.confirmed_by,
          confirmed_at=excluded.confirmed_at,
          note=excluded.note,
          revoked_by='',
          revoked_at=NULL
        """,
        (ym, group_code, STATUS_CONFIRMED, acted_by, now, note or ""),
    )
    conn.commit()
    return {"ok": True, "eval_ym": ym, "group_code": group_code, "status": STATUS_CONFIRMED, "confirmed_at": now}


def revoke_group_confirm(
    conn,
    year: int,
    month: int,
    *,
    group_code: str,
    acted_by: str = "ui",
    note: str = "",
) -> dict[str, Any]:
    ym = to_eval_ym(year, month)
    group_code = str(group_code or "").strip().upper()
    if is_period_frozen(conn, ym):
        raise ValueError(f"{ym} Freeze 상태에서는 확인 철회할 수 없습니다. 먼저 해동하세요.")
    now = datetime.now(timezone.utc).isoformat()
    cur = conn.execute(
        """
        UPDATE fact_group_confirm
        SET status=?, revoked_by=?, revoked_at=?, note=?
        WHERE eval_ym=? AND group_code=?
        """,
        (STATUS_OPEN, acted_by, now, note or "", ym, group_code),
    )
    if cur.rowcount == 0:
        conn.execute(
            """
            INSERT INTO fact_group_confirm(eval_ym, group_code, status, revoked_by, revoked_at, note)
            VALUES (?,?,?,?,?,?)
            """,
            (ym, group_code, STATUS_OPEN, acted_by, now, note or ""),
        )
    conn.commit()
    return {"ok": True, "eval_ym": ym, "group_code": group_code, "status": STATUS_OPEN}


def freeze_period(
    conn,
    year: int,
    month: int,
    *,
    acted_by: str = "ui",
    note: str = "",
    require_all_confirmed: bool = False,
) -> dict[str, Any]:
    ym = to_eval_ym(year, month)
    status = get_period_status(conn, year, month)
    if require_all_confirmed:
        open_groups = [g["group_code"] for g in status["groups"] if g["status"] != STATUS_CONFIRMED]
        if open_groups:
            raise ValueError(f"미확인 그룹이 있어 Freeze할 수 없습니다: {', '.join(open_groups[:20])}")
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO fact_period_status(eval_ym, status, frozen_by, frozen_at, note)
        VALUES (?,?,?,?,?)
        ON CONFLICT(eval_ym) DO UPDATE SET
          status=excluded.status,
          frozen_by=excluded.frozen_by,
          frozen_at=excluded.frozen_at,
          note=excluded.note,
          unfrozen_by='',
          unfrozen_at=NULL
        """,
        (ym, STATUS_FROZEN, acted_by, now, note or ""),
    )
    conn.commit()
    return {"ok": True, "eval_ym": ym, "status": STATUS_FROZEN, "frozen_at": now, "frozen_by": acted_by}


def unfreeze_period(
    conn,
    year: int,
    month: int,
    *,
    acted_by: str = "ui",
    note: str = "",
) -> dict[str, Any]:
    ym = to_eval_ym(year, month)
    now = datetime.now(timezone.utc).isoformat()
    ensure_period_row(conn, ym)
    conn.execute(
        """
        UPDATE fact_period_status
        SET status=?, unfrozen_by=?, unfrozen_at=?, note=?
        WHERE eval_ym=?
        """,
        (STATUS_OPEN, acted_by, now, note or "", ym),
    )
    conn.commit()
    return {"ok": True, "eval_ym": ym, "status": STATUS_OPEN, "unfrozen_at": now}
