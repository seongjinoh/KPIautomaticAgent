# -*- coding: utf-8 -*-
"""Lv2 중분류를 Lv1과 독립된 전역 코드로 재편.

배경
----
동일 Lv2 번호(0001)가 Lv1마다 다른 의미(종합손익 vs 비용효율)를 가지면
전행(좌수)·영업점(Point)처럼 같은 중분류를 다른 대분류/그룹에
자유롭게 조합할 수 없다.

규칙
----
- code_lv2.code 는 전역 PK (lv1 종속 제거)
- 같은 4자리 = 같은 중분류명
- indicator_common 은 임의의 Lv1 × 임의의 Lv2 조합 가능
"""
from __future__ import annotations

import re
import sqlite3


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return bool(row)


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def lv2_is_independent(conn: sqlite3.Connection) -> bool:
    if not _table_exists(conn, "code_lv2"):
        return True
    cols = _columns(conn, "code_lv2")
    return "lv1_code" not in cols and "code" in cols


def _next_codes(n: int, start: int = 1) -> list[str]:
    """0001, 0002, ... 형태."""
    return [f"{start + i:04d}" for i in range(n)]


def next_lv2_code(conn: sqlite3.Connection) -> str:
    """사용 중인 숫자 4자리 중 최대값 + 1 (0001부터)."""
    used = {
        str(r["code"]).strip()
        for r in conn.execute(
            "SELECT code FROM code_lv2 WHERE TRIM(COALESCE(code,'')) <> ''"
        )
    }
    max_n = 0
    for code in used:
        if len(code) == 4 and code.isdigit():
            max_n = max(max_n, int(code))
    nxt = max_n + 1
    if nxt > 9999:
        raise ValueError("Lv2 코드 한도(9999) 초과")
    return f"{nxt:04d}"


INDICATOR_CODE_TABLES = (
    ("eval_plan_item", "indicator_code"),
    ("fact_collect", "indicator_code"),
    ("fact_calc", "indicator_code"),
    ("custom_achievement", "indicator_code"),
    ("achievement_result", "indicator_code"),
    ("fact_formula", "output_indicator_code"),
    ("bank_export_item", "indicator_code"),
    ("fact_upload_item", "indicator_code"),
    ("fact_upload_change_log", "indicator_code"),
)


def migrate_lv2_independent(conn: sqlite3.Connection) -> dict:
    """기존 계층형 code_lv2 → 전역 유일 코드로 재편 + 참조 갱신."""
    if not _table_exists(conn, "code_lv2"):
        return {"skipped": True, "reason": "no code_lv2"}
    if lv2_is_independent(conn):
        return {"skipped": True, "reason": "already_independent"}

    old_lv2 = conn.execute(
        """
        SELECT lv1_code, code, name, use_yn
        FROM code_lv2
        ORDER BY lv1_code, code, name
        """
    ).fetchall()
    if not old_lv2:
        # empty → just rebuild schema shape
        conn.execute("DROP TABLE code_lv2")
        conn.execute(
            """
            CREATE TABLE code_lv2 (
              code       TEXT PRIMARY KEY,
              name       TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0,
              use_yn     TEXT NOT NULL DEFAULT 'Y'
            )
            """
        )
        return {"skipped": False, "mapped": 0, "empty_rebuild": True}

    # (old_lv1, old_code) → new_code ; name is unique per old row
    new_codes = _next_codes(len(old_lv2))
    pair_to_new: dict[tuple[str, str], str] = {}
    new_rows: list[tuple] = []
    for i, row in enumerate(old_lv2):
        lv1 = str(row["lv1_code"] or "").strip().upper()
        old = str(row["code"] or "").strip()
        name = str(row["name"] or "").strip() or old
        use_yn = str(row["use_yn"] or "Y").strip() or "Y"
        new_code = new_codes[i]
        pair_to_new[(lv1, old)] = new_code
        new_rows.append((new_code, name, i + 1, use_yn))

    # common_code / indicator_code remaps
    commons = conn.execute(
        "SELECT * FROM indicator_common ORDER BY common_code"
    ).fetchall()
    common_cols = [d[0] for d in conn.execute("PRAGMA table_info(indicator_common)").fetchall()]
    # pragma returns (cid, name, type, notnull, default, pk) - use name
    common_cols = [r["name"] for r in conn.execute("PRAGMA table_info(indicator_common)").fetchall()]

    old_common_to_new: dict[str, str] = {}
    new_commons: list[dict] = []
    for row in commons:
        d = dict(row)
        lv1 = str(d.get("lv1_code") or "").strip().upper()
        old_lv2 = str(d.get("lv2_code") or "").strip()
        lv3 = str(d.get("lv3_code") or "").strip()
        old_common = str(d.get("common_code") or "").strip().upper()
        new_lv2 = pair_to_new.get((lv1, old_lv2))
        if not new_lv2:
            # orphan: keep old lv2 digit if somehow missing
            new_lv2 = old_lv2
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
        # indicator_code = common + perf + group
        parts = old_ind.split("-")
        if len(parts) >= 5:
            # Lv1-Lv2-Lv3-PERF-GROUP (Lv1 may be 2-4 letters, Lv2/Lv3 4 digits)
            # safer: replace prefix common
            perf = str(d.get("perf_code") or "").strip().upper()
            group = str(d.get("group_code") or "").strip().upper()
            new_ind = f"{new_common}-{perf}-{group}"
        else:
            new_ind = old_ind.replace(old_common, new_common, 1) if old_common in old_ind else old_ind
        old_ind_to_new[old_ind] = new_ind
        d["indicator_code"] = new_ind
        d["common_code"] = new_common
        new_inds.append(d)

    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")

    # child indicator_code refs
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
                (new_c, old_c),
            )

    # rebuild indicator_code
    ind_cols = [r["name"] for r in conn.execute("PRAGMA table_info(indicator_code)").fetchall()]
    conn.execute("DELETE FROM indicator_code")
    if new_inds:
        placeholders = ",".join("?" for _ in ind_cols)
        col_sql = ",".join(ind_cols)
        conn.executemany(
            f"INSERT INTO indicator_code ({col_sql}) VALUES ({placeholders})",
            [tuple(d.get(c) for c in ind_cols) for d in new_inds],
        )

    # rebuild indicator_common
    conn.execute("DELETE FROM indicator_common")
    if new_commons:
        placeholders = ",".join("?" for _ in common_cols)
        col_sql = ",".join(common_cols)
        conn.executemany(
            f"INSERT INTO indicator_common ({col_sql}) VALUES ({placeholders})",
            [tuple(d.get(c) for c in common_cols) for d in new_commons],
        )

    # rebuild code_lv2 independent
    conn.execute("DROP TABLE code_lv2")
    conn.execute(
        """
        CREATE TABLE code_lv2 (
          code       TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          use_yn     TEXT NOT NULL DEFAULT 'Y'
        )
        """
    )
    conn.executemany(
        "INSERT INTO code_lv2(code, name, sort_order, use_yn) VALUES (?,?,?,?)",
        new_rows,
    )

    # recreate indicator_common without composite FK (SQLite can't DROP FK in place)
    # Rebuild indicator_common table definition if still has composite FK from old schema.
    # After DELETE/INSERT data is fine; FK enforcement on recreate:
    _rebuild_indicator_common_table(conn)

    conn.execute("PRAGMA foreign_keys = ON")

    return {
        "skipped": False,
        "mapped": len(pair_to_new),
        "commons": len(new_commons),
        "indicators": len(new_inds),
        "sample": list(pair_to_new.items())[:5],
    }


def _rebuild_indicator_common_table(conn: sqlite3.Connection) -> None:
    """indicator_common FK 를 Lv1·Lv2 각각 독립 참조로 재생성.

    SQLite는 RENAME 시 다른 테이블 FK가 __old 를 가리키게 되므로
    indicator_code 도 함께 재생성한다.
    """
    if not _table_exists(conn, "indicator_common"):
        return

    common_rows = [dict(r) for r in conn.execute("SELECT * FROM indicator_common").fetchall()]
    code_rows = []
    code_cols = []
    if _table_exists(conn, "indicator_code"):
        code_cols = [r["name"] for r in conn.execute("PRAGMA table_info(indicator_code)").fetchall()]
        code_rows = [dict(r) for r in conn.execute("SELECT * FROM indicator_code").fetchall()]

    conn.execute("DROP TABLE IF EXISTS indicator_code")
    conn.execute("DROP TABLE IF EXISTS indicator_common")

    conn.execute(
        """
        CREATE TABLE indicator_common (
          common_code  TEXT PRIMARY KEY,
          lv1_code     TEXT NOT NULL,
          lv2_code     TEXT NOT NULL,
          lv3_code     TEXT NOT NULL,
          name         TEXT NOT NULL,
          unit         TEXT NOT NULL DEFAULT '',
          allowed_perf TEXT NOT NULL DEFAULT '',
          common_yn    TEXT NOT NULL DEFAULT '단독',
          use_yn       TEXT NOT NULL DEFAULT 'Y',
          definition_text  TEXT NOT NULL DEFAULT '',
          calc_logic_text  TEXT NOT NULL DEFAULT '',
          owner_group_code TEXT NOT NULL DEFAULT '',
          dept             TEXT NOT NULL DEFAULT '',
          calc_cycle       TEXT NOT NULL DEFAULT '',
          calc_timing      TEXT NOT NULL DEFAULT '',
          data_source_kind TEXT NOT NULL DEFAULT '',
          data_source      TEXT NOT NULL DEFAULT '',
          collect_type     TEXT NOT NULL DEFAULT '',
          remark           TEXT NOT NULL DEFAULT '',
          FOREIGN KEY (lv1_code) REFERENCES code_lv1(code),
          FOREIGN KEY (lv2_code) REFERENCES code_lv2(code)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE indicator_code (
          indicator_code TEXT PRIMARY KEY,
          common_code    TEXT NOT NULL,
          group_code     TEXT NOT NULL,
          perf_code      TEXT NOT NULL,
          display_name   TEXT,
          unit           TEXT,
          agg_type       TEXT,
          use_yn         TEXT NOT NULL DEFAULT 'Y',
          detailed_definition_text TEXT NOT NULL DEFAULT '',
          definition_text  TEXT NOT NULL DEFAULT '',
          calc_logic_text  TEXT NOT NULL DEFAULT '',
          data_source      TEXT NOT NULL DEFAULT '',
          collect_type     TEXT NOT NULL DEFAULT '',
          owner_group_code TEXT NOT NULL DEFAULT '',
          dept             TEXT NOT NULL DEFAULT '',
          remark           TEXT NOT NULL DEFAULT '',
          FOREIGN KEY (common_code) REFERENCES indicator_common(common_code),
          FOREIGN KEY (group_code) REFERENCES owner_group(code)
        )
        """
    )

    if common_rows:
        new_cols = [r["name"] for r in conn.execute("PRAGMA table_info(indicator_common)").fetchall()]
        use_cols = [c for c in new_cols if c in common_rows[0]]
        placeholders = ",".join("?" for _ in use_cols)
        col_sql = ",".join(use_cols)
        conn.executemany(
            f"INSERT INTO indicator_common ({col_sql}) VALUES ({placeholders})",
            [tuple(r.get(c, "") for c in use_cols) for r in common_rows],
        )

    if code_rows and code_cols:
        use_cols = [c for c in code_cols if c in code_rows[0]]
        # ensure columns exist on new table
        new_code_cols = {r["name"] for r in conn.execute("PRAGMA table_info(indicator_code)").fetchall()}
        use_cols = [c for c in use_cols if c in new_code_cols]
        placeholders = ",".join("?" for _ in use_cols)
        col_sql = ",".join(use_cols)
        conn.executemany(
            f"INSERT INTO indicator_code ({col_sql}) VALUES ({placeholders})",
            [tuple(r.get(c) for c in use_cols) for r in code_rows],
        )

    conn.execute("CREATE INDEX IF NOT EXISTS ix_indicator_common_lv ON indicator_common(lv1_code, lv2_code)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_indicator_code_common ON indicator_code(common_code)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_indicator_code_group ON indicator_code(group_code)")


def seed_supersol_demo(conn: sqlite3.Connection) -> dict:
    """슈퍼SOL: 전행 좌수(SHB) vs 영업점 Point(SG1/SG2) 구분 데모."""
    if not lv2_is_independent(conn):
        return {"ok": False, "reason": "lv2_not_independent"}

    from migrate_lv3_unique import next_lv3_code

    row = conn.execute(
        "SELECT code FROM code_lv2 WHERE name=? LIMIT 1", ("슈퍼SOL",)
    ).fetchone()
    if row:
        lv2 = str(row["code"])
    else:
        lv2 = next_lv2_code(conn)
        conn.execute(
            "INSERT INTO code_lv2(code, name, sort_order, use_yn) VALUES (?,?,?, 'Y')",
            (lv2, "슈퍼SOL", int(lv2),),
        )
    # Lv1 CUS preferred; fallback first lv1
    lv1 = "CUS"
    if not conn.execute("SELECT 1 FROM code_lv1 WHERE code=?", (lv1,)).fetchone():
        row = conn.execute("SELECT code FROM code_lv1 ORDER BY sort_order, code LIMIT 1").fetchone()
        lv1 = row["code"] if row else "CUS"
        if lv1 == "CUS":
            conn.execute(
                "INSERT OR IGNORE INTO code_lv1(code, name, sort_order, use_yn) VALUES ('CUS','고객',1,'Y')"
            )

    def _ensure_common(name: str, unit: str, definition: str) -> str:
        row = conn.execute(
            "SELECT common_code FROM indicator_common WHERE name=? AND lv2_code=? LIMIT 1",
            (name, lv2),
        ).fetchone()
        if row:
            return row["common_code"]
        lv3 = next_lv3_code(conn)
        common = f"{lv1}-{lv2}-{lv3}"
        conn.execute(
            """
            INSERT INTO indicator_common(
              common_code, lv1_code, lv2_code, lv3_code, name, unit,
              allowed_perf, common_yn, use_yn, definition_text, calc_logic_text
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                common, lv1, lv2, lv3, name, unit,
                "TOT", "공통", "Y", definition,
                "실적 집계 후 단위(좌수/Point)별 목표 대비 달성률 산정",
            ),
        )
        return common

    seat_common = _ensure_common(
        "슈퍼SOL신규가입",
        "좌수",
        "전행·그룹 배정 목표 기준(좌수). 영업점 Point 실적과 구분.",
    )
    point_common = _ensure_common(
        "슈퍼SOL신규가입(영업점Point)",
        "Point",
        "영업점 실적 Point 합산. 전행 좌수 목표와 동일 Lv2(슈퍼SOL)를 공유하되 Lv3·단위로 구분.",
    )

    # 좌수: SHB + SG1 + SG2 / Point: SG1 + SG2 only
    ind_specs = [
        (seat_common, "SHB", "좌수", "슈퍼SOL신규가입(전행·좌수)"),
        (seat_common, "SG1", "좌수", "슈퍼SOL신규가입(영추1·좌수배정)"),
        (seat_common, "SG2", "좌수", "슈퍼SOL신규가입(영추2·좌수배정)"),
        (point_common, "SG1", "Point", "슈퍼SOL신규가입(영추1·영업점Point)"),
        (point_common, "SG2", "Point", "슈퍼SOL신규가입(영추2·영업점Point)"),
    ]
    created = []
    for common, group, unit, display in ind_specs:
        # ensure group exists
        if not conn.execute("SELECT 1 FROM owner_group WHERE code=?", (group,)).fetchone():
            continue
        code = f"{common}-TOT-{group}"
        conn.execute(
            """
            INSERT INTO indicator_code(
              indicator_code, common_code, group_code, perf_code,
              display_name, unit, agg_type, use_yn, detailed_definition_text
            ) VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(indicator_code) DO UPDATE SET
              display_name=excluded.display_name, unit=excluded.unit, use_yn='Y',
              detailed_definition_text=excluded.detailed_definition_text
            """,
            (
                code, common, group, "TOT", display, unit, "SUM", "Y",
                f"{display}. 동일 Lv2({lv2} 슈퍼SOL) · 단위 {unit}로 구분.",
            ),
        )
        created.append(code)

    return {"ok": True, "lv1": lv1, "lv2": lv2, "indicators": created}
