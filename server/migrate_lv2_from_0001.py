# -*- coding: utf-8 -*-
"""Lv2 4자리를 0001부터 전역 일련으로 재편.

기존 독립 마스터는 0100부터 붙였고 슈퍼SOL은 9000 예약이었다.
신규 발번·Lv3와 맞춰 0001..N 으로 다시 매긴다.
"""
from __future__ import annotations

import sqlite3

from migrate_lv2_independent import INDICATOR_CODE_TABLES, _columns, _table_exists


def lv2_is_from_0001(conn: sqlite3.Connection) -> bool:
    if not _table_exists(conn, "code_lv2"):
        return True
    nums: list[int] = []
    for r in conn.execute("SELECT code FROM code_lv2 WHERE TRIM(COALESCE(code,'')) <> ''"):
        code = str(r["code"]).strip()
        if not (len(code) == 4 and code.isdigit()):
            return False
        nums.append(int(code))
    if not nums:
        return True
    nums.sort()
    return nums == list(range(1, len(nums) + 1))


def _rewrite_formula_refs(conn: sqlite3.Connection, old_ind_to_new: dict[str, str]) -> None:
    if not _table_exists(conn, "fact_formula"):
        return
    cols = _columns(conn, "fact_formula")
    if "id" not in cols:
        return
    pairs = sorted(
        ((o, n) for o, n in old_ind_to_new.items() if o != n),
        key=lambda x: len(x[0]),
        reverse=True,
    )
    if not pairs:
        return
    has_ops = "operands_json" in cols
    has_expr = "expr" in cols
    select_cols = ["id"]
    if has_ops:
        select_cols.append("operands_json")
    if has_expr:
        select_cols.append("expr")
    rows = conn.execute(f"SELECT {', '.join(select_cols)} FROM fact_formula").fetchall()
    for row in rows:
        ops = str(row["operands_json"] or "") if has_ops else ""
        expr = str(row["expr"] or "") if has_expr else ""
        new_ops, new_expr = ops, expr
        for old, new in pairs:
            if has_ops:
                new_ops = new_ops.replace(old, new)
            if has_expr:
                new_expr = new_expr.replace(old, new)
        if new_ops == ops and new_expr == expr:
            continue
        if has_ops and has_expr:
            conn.execute(
                "UPDATE fact_formula SET operands_json=?, expr=? WHERE id=?",
                (new_ops, new_expr, row["id"]),
            )
        elif has_ops:
            conn.execute(
                "UPDATE fact_formula SET operands_json=? WHERE id=?",
                (new_ops, row["id"]),
            )
        elif has_expr:
            conn.execute(
                "UPDATE fact_formula SET expr=? WHERE id=?",
                (new_expr, row["id"]),
            )


def migrate_lv2_from_0001(conn: sqlite3.Connection) -> dict:
    if not _table_exists(conn, "code_lv2"):
        return {"skipped": True, "reason": "no code_lv2"}
    if lv2_is_from_0001(conn):
        return {"skipped": True, "reason": "already_from_0001"}

    lv2_rows = conn.execute(
        "SELECT * FROM code_lv2 ORDER BY sort_order, code"
    ).fetchall()
    lv2_cols = [r["name"] for r in conn.execute("PRAGMA table_info(code_lv2)")]
    old_lv2_to_new: dict[str, str] = {}
    new_lv2_rows: list[dict] = []
    for i, row in enumerate(lv2_rows, start=1):
        d = dict(row)
        old = str(d.get("code") or "").strip()
        new = f"{i:04d}"
        old_lv2_to_new[old] = new
        d["code"] = new
        d["sort_order"] = i
        new_lv2_rows.append(d)

    commons = conn.execute(
        "SELECT * FROM indicator_common ORDER BY common_code"
    ).fetchall()
    common_cols = [r["name"] for r in conn.execute("PRAGMA table_info(indicator_common)")]
    old_common_to_new: dict[str, str] = {}
    new_commons: list[dict] = []
    for row in commons:
        d = dict(row)
        old_common = str(d.get("common_code") or "").strip().upper()
        lv1 = str(d.get("lv1_code") or "").strip().upper()
        old_lv2 = str(d.get("lv2_code") or "").strip()
        lv3 = str(d.get("lv3_code") or "").strip()
        new_lv2 = old_lv2_to_new.get(old_lv2, old_lv2)
        new_common = f"{lv1}-{new_lv2}-{lv3}".upper()
        old_common_to_new[old_common] = new_common
        d["common_code"] = new_common
        d["lv2_code"] = new_lv2
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
                (f"__LV2__{old_c}", old_c),
            )
        for old_c, new_c in old_ind_to_new.items():
            if old_c == new_c:
                continue
            conn.execute(
                f'UPDATE "{table}" SET "{col}"=? WHERE "{col}"=?',
                (new_c, f"__LV2__{old_c}"),
            )

    _rewrite_formula_refs(conn, old_ind_to_new)

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

    conn.execute("DELETE FROM code_lv2")
    if new_lv2_rows:
        placeholders = ",".join("?" for _ in lv2_cols)
        col_sql = ",".join(lv2_cols)
        conn.executemany(
            f"INSERT INTO code_lv2 ({col_sql}) VALUES ({placeholders})",
            [tuple(d.get(c) for c in lv2_cols) for d in new_lv2_rows],
        )

    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON")

    return {
        "skipped": False,
        "mapped": len(old_lv2_to_new),
        "commons": len(new_commons),
        "indicators": len(new_inds),
    }
