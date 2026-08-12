# -*- coding: utf-8 -*-
"""S22(오타) → SG2 정식 코드로 정리."""
from __future__ import annotations

import sqlite3


GROUP_TABLES = (
    ("indicator_code", "group_code"),
    ("eval_plan_item", "group_code"),
    ("fact_calc", "group_code"),
    ("custom_achievement", "group_code"),
    ("achievement_result", "group_code"),
    ("bank_export_item", "group_code"),
    ("fact_upload_item", "group_code"),
    ("fact_upload_change_log", "group_code"),
    ("fact_group_confirm", "group_code"),
    ("group_score_result", "group_code"),
    ("score_rollup_rule", "target_group_code"),
    ("score_rollup_term_group", "group_code"),
    ("owner_group", "parent_code"),
    ("indicator_common", "owner_group_code"),
    ("indicator_code", "owner_group_code"),
)


def _table_exists(conn, table):
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone())


def _columns(conn, table):
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def migrate_s22_to_sg2(conn: sqlite3.Connection) -> dict:
    if not _table_exists(conn, "owner_group"):
        return {"skipped": True}
    has_s22 = conn.execute("SELECT 1 FROM owner_group WHERE code='S22'").fetchone()
    if not has_s22:
        return {"skipped": True, "reason": "no S22"}
    has_sg2 = conn.execute("SELECT 1 FROM owner_group WHERE code='SG2'").fetchone()

    conn.commit()
    conn.execute("PRAGMA foreign_keys=OFF")

    # SG2 먼저 확보 (자식 FK 교체 전)
    if not has_sg2:
        row = conn.execute(
            "SELECT name, sort_order, use_yn, org_level, parent_code FROM owner_group WHERE code='S22'"
        ).fetchone()
        conn.execute(
            """
            INSERT INTO owner_group(code, name, sort_order, use_yn, org_level, parent_code)
            VALUES (?,?,?,?,?,?)
            """,
            (
                "SG2",
                (row["name"] if row else "영업추진2그룹") or "영업추진2그룹",
                row["sort_order"] if row else 2,
                row["use_yn"] if row else "Y",
                row["org_level"] if row else "GROUP",
                (row["parent_code"] if row and row["parent_code"] != "S22" else None) or "SHB",
            ),
        )

    # 1) 자식 group_code 교체
    updated = {}
    for table, col in GROUP_TABLES:
        if table == "owner_group" and col == "code":
            continue
        if not _table_exists(conn, table):
            continue
        if col not in _columns(conn, table):
            continue
        cur = conn.execute(f'UPDATE "{table}" SET "{col}"=? WHERE "{col}"=?', ("SG2", "S22"))
        updated[f"{table}.{col}"] = cur.rowcount

    # 2) indicator_code PK 접미사
    if _table_exists(conn, "indicator_code"):
        rows = conn.execute(
            "SELECT * FROM indicator_code WHERE indicator_code LIKE '%-S22'"
        ).fetchall()
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(indicator_code)")]
        for row in rows:
            d = dict(row)
            old = d["indicator_code"]
            new = old[:-3] + "SG2" if old.endswith("-S22") else old.replace("-S22", "-SG2")
            d["indicator_code"] = new
            d["group_code"] = "SG2"
            for table, col in (
                ("eval_plan_item", "indicator_code"),
                ("fact_collect", "indicator_code"),
                ("fact_calc", "indicator_code"),
                ("custom_achievement", "indicator_code"),
                ("achievement_result", "indicator_code"),
                ("fact_formula", "output_indicator_code"),
                ("bank_export_item", "indicator_code"),
                ("fact_upload_item", "indicator_code"),
                ("fact_upload_change_log", "indicator_code"),
            ):
                if _table_exists(conn, table) and col in _columns(conn, table):
                    conn.execute(f'UPDATE "{table}" SET "{col}"=? WHERE "{col}"=?', (new, old))
            conn.execute("DELETE FROM indicator_code WHERE indicator_code=?", (old,))
            placeholders = ",".join("?" for _ in cols)
            conn.execute(
                f"INSERT OR REPLACE INTO indicator_code ({','.join(cols)}) VALUES ({placeholders})",
                tuple(d.get(c) for c in cols),
            )

    # 3) S22 제거
    conn.execute("DELETE FROM owner_group WHERE code='S22'")
    conn.commit()
    conn.execute("PRAGMA foreign_keys=ON")
    return {"skipped": False, "updated": updated}
