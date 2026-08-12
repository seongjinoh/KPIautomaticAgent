# -*- coding: utf-8 -*-
"""Lv3 4자리를 전역 유일 코드로 재편.

배경
----
기존 lv3_code 는 Lv1-Lv2 아래 일련번호(0001, 0002…)라
같은 0001 이 서로 다른 지표를 가리켰다.
신규 발번을 자동화하려면 4자리가 전역에서 하나여야 한다.

규칙
----
- indicator_common.lv3_code UNIQUE
- 신규는 next_lv3_code() (기존 max + 1)
"""
from __future__ import annotations

import sqlite3

from migrate_lv2_independent import INDICATOR_CODE_TABLES, _columns, _table_exists


def lv3_is_unique(conn: sqlite3.Connection) -> bool:
    if not _table_exists(conn, "indicator_common"):
        return True
    row = conn.execute(
        """
        SELECT COUNT(*) AS n, COUNT(DISTINCT lv3_code) AS d
        FROM indicator_common
        WHERE TRIM(COALESCE(lv3_code, '')) <> ''
        """
    ).fetchone()
    if not row or int(row["n"] or 0) == 0:
        return True
    return int(row["n"]) == int(row["d"])


def next_lv3_code(conn: sqlite3.Connection) -> str:
    """사용 중인 숫자 4자리 중 최대값 + 1."""
    used = {
        str(r["lv3_code"]).strip()
        for r in conn.execute(
            "SELECT lv3_code FROM indicator_common WHERE TRIM(COALESCE(lv3_code,'')) <> ''"
        )
    }
    max_n = 0
    for code in used:
        if len(code) == 4 and code.isdigit():
            max_n = max(max_n, int(code))
    nxt = max_n + 1
    if nxt > 9999:
        raise ValueError("Lv3 코드 한도(9999) 초과")
    return f"{nxt:04d}"


def ensure_lv3_unique_index(conn: sqlite3.Connection) -> None:
    if not _table_exists(conn, "indicator_common"):
        return
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_indicator_common_lv3 ON indicator_common(lv3_code)"
    )


def migrate_lv3_unique(conn: sqlite3.Connection) -> dict:
    if not _table_exists(conn, "indicator_common"):
        return {"skipped": True, "reason": "no indicator_common"}
    if lv3_is_unique(conn):
        ensure_lv3_unique_index(conn)
        return {"skipped": True, "reason": "already_unique"}

    commons = conn.execute(
        "SELECT * FROM indicator_common ORDER BY common_code"
    ).fetchall()
    common_cols = [r["name"] for r in conn.execute("PRAGMA table_info(indicator_common)")]

    old_common_to_new: dict[str, str] = {}
    new_commons: list[dict] = []
    for i, row in enumerate(commons, start=1):
        d = dict(row)
        old_common = str(d.get("common_code") or "").strip().upper()
        lv1 = str(d.get("lv1_code") or "").strip().upper()
        lv2 = str(d.get("lv2_code") or "").strip()
        new_lv3 = f"{i:04d}"
        new_common = f"{lv1}-{lv2}-{new_lv3}".upper()
        old_common_to_new[old_common] = new_common
        d["common_code"] = new_common
        d["lv3_code"] = new_lv3
        new_commons.append(d)

    codes = conn.execute("SELECT * FROM indicator_code ORDER BY indicator_code").fetchall()
    old_ind_to_new: dict[str, str] = {}
    new_inds: list[dict] = []
    for row in codes:
        d = dict(row)
        old_ind = str(d.get("indicator_code") or "").strip().upper()
        old_common = str(d.get("common_code") or "").strip().upper()
        new_common = old_common_to_new.get(old_common, old_common)
        perf = str(d.get("perf_code") or "").strip().upper()
        group = str(d.get("group_code") or "").strip().upper()
        if perf and group:
            new_ind = f"{new_common}-{perf}-{group}"
        else:
            new_ind = old_ind.replace(old_common, new_common, 1) if old_common in old_ind else old_ind
        old_ind_to_new[old_ind] = new_ind
        d["indicator_code"] = new_ind
        d["common_code"] = new_common
        new_inds.append(d)

    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")

    # 2단계: 자식 테이블 PK/UNIQUE 충돌 방지 (임시 코드 → 최종)
    for table, col in INDICATOR_CODE_TABLES:
        if not _table_exists(conn, table):
            continue
        if col not in _columns(conn, table):
            continue
        for old_c, new_c in old_ind_to_new.items():
            if old_c == new_c:
                continue
            conn.execute(
                f'UPDATE "{table}" SET "{col}"=? WHERE "{col}"=?',
                (f"__LV3__{old_c}", old_c),
            )
        for old_c, new_c in old_ind_to_new.items():
            if old_c == new_c:
                continue
            conn.execute(
                f'UPDATE "{table}" SET "{col}"=? WHERE "{col}"=?',
                (new_c, f"__LV3__{old_c}"),
            )

    ind_cols = [r["name"] for r in conn.execute("PRAGMA table_info(indicator_code)").fetchall()]
    conn.execute("DELETE FROM indicator_code")
    if new_inds:
        placeholders = ",".join("?" for _ in ind_cols)
        col_sql = ",".join(ind_cols)
        conn.executemany(
            f"INSERT INTO indicator_code ({col_sql}) VALUES ({placeholders})",
            [tuple(d.get(c) for c in ind_cols) for d in new_inds],
        )

    conn.execute("DELETE FROM indicator_common")
    if new_commons:
        placeholders = ",".join("?" for _ in common_cols)
        col_sql = ",".join(common_cols)
        conn.executemany(
            f"INSERT INTO indicator_common ({col_sql}) VALUES ({placeholders})",
            [tuple(d.get(c) for c in common_cols) for d in new_commons],
        )

    ensure_lv3_unique_index(conn)
    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON")

    return {
        "skipped": False,
        "mapped": len(old_common_to_new),
        "indicators": len(new_inds),
    }
