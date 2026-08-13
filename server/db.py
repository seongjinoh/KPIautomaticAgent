# -*- coding: utf-8 -*-
"""SQLite 연결·스키마 초기화."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent
# 이미지에 번들된 데모 gz 등 (읽기 전용으로 둘 수 있음)
BUNDLE_DATA_DIR = SERVER_DIR / "data"
# Railway Volume 등: KPI_DATA_DIR=/data 로 영속 SQLite
DATA_DIR = Path(os.environ.get("KPI_DATA_DIR") or BUNDLE_DATA_DIR)
DB_PATH = DATA_DIR / "kpi.sqlite"
SCHEMA_PATH = SERVER_DIR / "schema_kpi.sql"

EVAL_ITEM_EXTRA_COLUMNS = {
    "data_source": "TEXT NOT NULL DEFAULT ''",
    "definition_text": "TEXT NOT NULL DEFAULT ''",
    "calc_logic_text": "TEXT NOT NULL DEFAULT ''",
    "h1_target": "REAL",
    "h2_target": "REAL",
    "score_rule": "TEXT NOT NULL DEFAULT ''",
    "penalty_rule": "TEXT NOT NULL DEFAULT ''",
    "cap_max": "REAL",
    "cap_min": "REAL",
    "remark": "TEXT NOT NULL DEFAULT ''",
    "adj_band": "TEXT NOT NULL DEFAULT ''",
    "filters_json": "TEXT",
    "formula_id": "INTEGER",
    "is_core": "TEXT NOT NULL DEFAULT 'N'",
    "contribution_mode": "TEXT NOT NULL DEFAULT 'WEIGHT'",
    "target_start_month": "INTEGER NOT NULL DEFAULT 1",
    "target_end_month": "INTEGER NOT NULL DEFAULT 12",
}


def compose_indicator_code(lv1: str, lv2: str, lv3: str, perf: str, group: str) -> str:
    """Lv1-Lv2-Lv3-실적구분-그룹코드."""
    parts = [str(lv1 or "").strip(), str(lv2 or "").strip(), str(lv3 or "").strip(),
             str(perf or "").strip().upper(), str(group or "").strip().upper()]
    if not all(parts):
        raise ValueError("lv1, lv2, lv3, perf, group are all required")
    return "-".join(parts)


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema(conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    if own:
        conn = get_connection()
    try:
        _prepare_eval_table_migration(conn)
        # 구 계층형 code_lv2 → 독립 마스터 (스키마 인덱스 적용 전)
        from migrate_lv2_independent import migrate_lv2_independent, seed_supersol_demo
        migrate_lv2_independent(conn)
        sql = SCHEMA_PATH.read_text(encoding="utf-8")
        conn.executescript(sql)
        _migrate_eval_tables(conn)
        _migrate_eval_item_columns(conn)
        _migrate_indicator_common_unit(conn)
        _migrate_indicator_definitions(conn)
        _migrate_indicator_sort_order(conn)
        _migrate_ownership_columns(conn)
        _migrate_fact_upload_tables(conn)
        _migrate_fact_period_tables(conn)
        _migrate_owner_group_org(conn)
        from migrate_s22_to_sg2 import migrate_s22_to_sg2
        from migrate_lv3_unique import migrate_lv3_unique
        from migrate_lv2_from_0001 import migrate_lv2_from_0001
        migrate_s22_to_sg2(conn)
        migrate_lv3_unique(conn)
        migrate_lv2_from_0001(conn)
        # 가라 데모 지표 자동 재주입 비활성 (필요 시 SEED_SUPERSOL_DEMO=1)
        if os.environ.get("SEED_SUPERSOL_DEMO", "").strip() in ("1", "true", "TRUE", "yes"):
            seed_supersol_demo(conn)
        if _table_exists(conn, "code_lv2") and "sort_order" in _columns(conn, "code_lv2"):
            conn.execute("CREATE INDEX IF NOT EXISTS ix_code_lv2_sort ON code_lv2(sort_order, code)")
        conn.commit()
    finally:
        if own:
            conn.close()


def counts(conn: sqlite3.Connection) -> dict:
    tables = [
        "owner_group", "code_lv1", "code_lv2", "indicator_common", "indicator_code",
        "eval_plan_set", "eval_plan_item", "fact_formula", "fact_collect", "fact_calc",
        "custom_achievement", "achievement_result", "sync_batch",
        "bank_export_batch", "bank_export_item",
        "fact_upload_batch", "fact_upload_item", "fact_upload_change_log",
        "fact_group_confirm", "fact_period_status",
        "group_score_result", "score_rollup_set", "score_rollup_rule",
        "score_rollup_term", "score_rollup_term_group",
    ]
    out = {}
    for t in tables:
        if not _table_exists(conn, t):
            out[t] = 0
            continue
        out[t] = conn.execute(f"SELECT COUNT(*) AS c FROM {t}").fetchone()["c"]
    return out


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {r["name"] for r in rows}


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return bool(row)


def _eval_plan_item_ddl() -> str:
    return """
        CREATE TABLE IF NOT EXISTS eval_plan_set (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          year                 INTEGER NOT NULL,
          effective_from_month INTEGER NOT NULL,
          change_reason        TEXT NOT NULL DEFAULT '',
          created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (year, effective_from_month)
        );

        CREATE TABLE IF NOT EXISTS eval_plan_item (
          id                        INTEGER PRIMARY KEY AUTOINCREMENT,
          plan_set_id               INTEGER NOT NULL,
          group_code                TEXT NOT NULL,
          indicator_code            TEXT NOT NULL,
          mgmt_tool                 TEXT NOT NULL DEFAULT 'KPI',
          eval_category_lv1         TEXT NOT NULL DEFAULT '',
          eval_category_lv2         TEXT NOT NULL DEFAULT '',
          eval_category_lv3         TEXT NOT NULL DEFAULT '',
          label                     TEXT NOT NULL DEFAULT '',
          unit                      TEXT NOT NULL DEFAULT '',
          weight                    REAL NOT NULL DEFAULT 0,
          is_core                   TEXT NOT NULL DEFAULT 'N',
          annual_target             REAL NOT NULL DEFAULT 0,
          monthly_target            REAL,
          baseline_actual           REAL NOT NULL DEFAULT 0,
          data_source               TEXT NOT NULL DEFAULT '',
          definition_text           TEXT NOT NULL DEFAULT '',
          calc_logic_text           TEXT NOT NULL DEFAULT '',
          h1_target                 REAL,
          h2_target                 REAL,
          score_rule                TEXT NOT NULL DEFAULT '',
          penalty_rule              TEXT NOT NULL DEFAULT '',
          cap_max                   REAL,
          cap_min                   REAL,
          remark                    TEXT NOT NULL DEFAULT '',
          adj_band                  TEXT NOT NULL DEFAULT '',
          filters_json              TEXT,
          formula_id                INTEGER,
          achievement_mode          TEXT NOT NULL DEFAULT 'linear',
          goal_direction            TEXT NOT NULL DEFAULT 'increase',
          custom_achievement_expr   TEXT NOT NULL DEFAULT '',
          custom_monthly_targets_json TEXT,
          sort_order                INTEGER NOT NULL DEFAULT 0,
          use_yn                    TEXT NOT NULL DEFAULT 'Y',
          contribution_mode         TEXT NOT NULL DEFAULT 'WEIGHT',
          target_start_month        INTEGER NOT NULL DEFAULT 1,
          target_end_month          INTEGER NOT NULL DEFAULT 12,
          created_at                TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at                TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (plan_set_id) REFERENCES eval_plan_set(id) ON DELETE CASCADE,
          FOREIGN KEY (indicator_code) REFERENCES indicator_code(indicator_code),
          FOREIGN KEY (group_code) REFERENCES owner_group(code),
          UNIQUE (plan_set_id, group_code, indicator_code, mgmt_tool)
        );

        CREATE INDEX IF NOT EXISTS ix_eval_plan_set_year_month ON eval_plan_set(year, effective_from_month);
        CREATE INDEX IF NOT EXISTS ix_eval_plan_item_plan_set ON eval_plan_item(plan_set_id);
        CREATE INDEX IF NOT EXISTS ix_eval_plan_item_group ON eval_plan_item(group_code, plan_set_id);
        CREATE INDEX IF NOT EXISTS ix_eval_plan_item_indicator ON eval_plan_item(indicator_code, plan_set_id);
        """


def _migrate_eval_item_columns(conn: sqlite3.Connection) -> None:
    if not _table_exists(conn, "eval_plan_item"):
        return
    cols = _columns(conn, "eval_plan_item")
    for name, decl in EVAL_ITEM_EXTRA_COLUMNS.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE eval_plan_item ADD COLUMN {name} {decl}")


def _migrate_indicator_sort_order(conn: sqlite3.Connection) -> None:
    """코드북 전 탭에서 수동 표시순서를 저장할 수 있게 한다."""
    for table, key in (("indicator_common", "common_code"), ("indicator_code", "indicator_code")):
        if not _table_exists(conn, table):
            continue
        if "sort_order" not in _columns(conn, table):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            rows = conn.execute(f"SELECT {key} FROM {table} ORDER BY {key}").fetchall()
            for index, row in enumerate(rows):
                conn.execute(
                    f"UPDATE {table} SET sort_order=? WHERE {key}=?",
                    (index, row[key]),
                )


def _migrate_indicator_common_unit(conn: sqlite3.Connection) -> None:
    """단위의 단일 출처를 Lv3(indicator_common)로 옮김. 기존 지표마스터 단위를 백필."""
    if not _table_exists(conn, "indicator_common"):
        return
    cols = _columns(conn, "indicator_common")
    if "unit" not in cols:
        conn.execute("ALTER TABLE indicator_common ADD COLUMN unit TEXT NOT NULL DEFAULT ''")
    # 자식 지표마스터에 단위가 있으면 비어 있는 Lv3에 채움
    if _table_exists(conn, "indicator_code"):
        conn.execute(
            """
            UPDATE indicator_common
            SET unit = (
              SELECT ic.unit FROM indicator_code ic
              WHERE ic.common_code = indicator_common.common_code
                AND TRIM(COALESCE(ic.unit, '')) <> ''
              ORDER BY ic.indicator_code
              LIMIT 1
            )
            WHERE TRIM(COALESCE(unit, '')) = ''
              AND EXISTS (
                SELECT 1 FROM indicator_code ic
                WHERE ic.common_code = indicator_common.common_code
                  AND TRIM(COALESCE(ic.unit, '')) <> ''
              )
            """
        )
        # 이후 조회는 Lv3 단위 우선 — 자식 컬럼도 동기화
        conn.execute(
            """
            UPDATE indicator_code
            SET unit = (
              SELECT cm.unit FROM indicator_common cm
              WHERE cm.common_code = indicator_code.common_code
            )
            WHERE EXISTS (
              SELECT 1 FROM indicator_common cm
              WHERE cm.common_code = indicator_code.common_code
                AND TRIM(COALESCE(cm.unit, '')) <> ''
            )
            """
        )


def _migrate_indicator_definitions(conn: sqlite3.Connection) -> None:
    """Lv3·지표마스터에 지표정의 컬럼 추가. 평가배치에 남아 있던 정의를 1회 백필."""
    from indicator_definition import (
        DEFINITION_COLUMN_DDL_CODE,
        DEFINITION_COLUMN_DDL_COMMON,
        LV3_DEFINITION_FIELDS,
        normalize_data_source_kind,
    )

    if _table_exists(conn, "indicator_common"):
        cols = _columns(conn, "indicator_common")
        for name, decl in DEFINITION_COLUMN_DDL_COMMON.items():
            if name not in cols:
                conn.execute(f"ALTER TABLE indicator_common ADD COLUMN {name} {decl}")
        # 기존 data_source만 있으면 종류 추정
        if "data_source_kind" in _columns(conn, "indicator_common"):
            rows = conn.execute(
                "SELECT common_code, data_source, data_source_kind FROM indicator_common"
            ).fetchall()
            for r in rows:
                if str(r["data_source_kind"] or "").strip():
                    continue
                ds = str(r["data_source"] or "")
                kind = ""
                low = ds.lower()
                if any(k in low for k in ("dw", "warehouse", "웨어하우스", "view")):
                    kind = "Data Warehouse"
                elif ds.strip():
                    kind = "기타"
                if kind:
                    conn.execute(
                        "UPDATE indicator_common SET data_source_kind=? WHERE common_code=?",
                        (kind, r["common_code"]),
                    )

    if _table_exists(conn, "indicator_code"):
        cols = _columns(conn, "indicator_code")
        for name, decl in DEFINITION_COLUMN_DDL_CODE.items():
            if name not in cols:
                conn.execute(f"ALTER TABLE indicator_code ADD COLUMN {name} {decl}")

    if not _table_exists(conn, "eval_plan_item") or not _table_exists(conn, "indicator_code"):
        return

    # 평가배치 → 지표마스터 상세정의(기존 definition_text가 있으면 상세로도 복사하지 않고 Lv3 백필용)
    eval_fields_to_code = ("definition_text", "calc_logic_text", "data_source", "remark")
    for field in eval_fields_to_code:
        if field not in _columns(conn, "eval_plan_item"):
            continue
        if field not in _columns(conn, "indicator_code"):
            continue
        conn.execute(
            f"""
            UPDATE indicator_code
            SET {field} = (
              SELECT e.{field} FROM eval_plan_item e
              WHERE e.indicator_code = indicator_code.indicator_code
                AND TRIM(COALESCE(e.{field}, '')) <> ''
              ORDER BY e.id DESC
              LIMIT 1
            )
            WHERE TRIM(COALESCE({field}, '')) = ''
              AND EXISTS (
                SELECT 1 FROM eval_plan_item e
                WHERE e.indicator_code = indicator_code.indicator_code
                  AND TRIM(COALESCE(e.{field}, '')) <> ''
              )
            """
        )

    # Lv3: 자식 마스터 공통값 백필 (Lv3 필드만)
    for field in LV3_DEFINITION_FIELDS:
        if field not in _columns(conn, "indicator_common"):
            continue
        if field in ("calc_cycle", "calc_timing", "data_source_kind"):
            continue  # 마스터에 없는 신규 필드
        if field not in _columns(conn, "indicator_code"):
            continue
        conn.execute(
            f"""
            UPDATE indicator_common
            SET {field} = (
              SELECT ic.{field} FROM indicator_code ic
              WHERE ic.common_code = indicator_common.common_code
                AND TRIM(COALESCE(ic.{field}, '')) <> ''
              GROUP BY ic.{field}
              ORDER BY COUNT(*) DESC, ic.{field}
              LIMIT 1
            )
            WHERE TRIM(COALESCE({field}, '')) = ''
              AND EXISTS (
                SELECT 1 FROM indicator_code ic
                WHERE ic.common_code = indicator_common.common_code
                  AND TRIM(COALESCE(ic.{field}, '')) <> ''
              )
            """
        )

    # data_source_kind 정규화
    if _table_exists(conn, "indicator_common") and "data_source_kind" in _columns(conn, "indicator_common"):
        for r in conn.execute("SELECT common_code, data_source_kind FROM indicator_common").fetchall():
            norm = normalize_data_source_kind(r["data_source_kind"])
            if norm != (r["data_source_kind"] or ""):
                conn.execute(
                    "UPDATE indicator_common SET data_source_kind=? WHERE common_code=?",
                    (norm, r["common_code"]),
                )


def _migrate_eval_tables(conn: sqlite3.Connection) -> None:
    """구 평가 스키마 및 제거된 수집방식/Ownership부서 컬럼을 정리한다."""
    if not _table_exists(conn, "eval_plan_item"):
        return

    item_cols = _columns(conn, "eval_plan_item")
    set_exists = _table_exists(conn, "eval_plan_set")
    modern = set_exists and "plan_set_id" in item_cols and "year" not in item_cols
    removed_cols = {"result_code", "collect_type", "dept"}
    if modern and not (removed_cols & item_cols):
        return

    preserved_sets = []
    preserved_items = []
    if modern:
        preserved_sets = [dict(r) for r in conn.execute("SELECT * FROM eval_plan_set").fetchall()]
        cols = [c for c in item_cols if c not in removed_cols]
        col_sql = ", ".join(cols)
        preserved_items = [dict(r) for r in conn.execute(f"SELECT {col_sql} FROM eval_plan_item").fetchall()]

    conn.execute("DROP TABLE IF EXISTS eval_plan_item")
    conn.execute("DROP TABLE IF EXISTS eval_plan_set")
    conn.executescript(_eval_plan_item_ddl())

    if preserved_sets:
        for row in preserved_sets:
            conn.execute(
                """
                INSERT INTO eval_plan_set(id, year, effective_from_month, change_reason, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"],
                    row["year"],
                    row["effective_from_month"],
                    row.get("change_reason") or "",
                    row.get("created_at"),
                    row.get("updated_at"),
                ),
            )
        for row in preserved_items:
            keys = [k for k in row.keys() if k not in removed_cols]
            placeholders = ", ".join("?" for _ in keys)
            conn.execute(
                f"INSERT INTO eval_plan_item({', '.join(keys)}) VALUES ({placeholders})",
                [row[k] for k in keys],
            )


def _migrate_fact_upload_tables(conn: sqlite3.Connection) -> None:
    """실적 엑셀 업로드 staging·변경로그 테이블 보장 (기존 DB용)."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS fact_upload_batch (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          filename      TEXT NOT NULL DEFAULT '',
          status        TEXT NOT NULL DEFAULT 'running',
          counts_json   TEXT NOT NULL DEFAULT '{}',
          error_text    TEXT NOT NULL DEFAULT '',
          uploaded_by   TEXT NOT NULL DEFAULT 'ui',
          created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at   TEXT
        );

        CREATE TABLE IF NOT EXISTS fact_upload_item (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          batch_id        INTEGER NOT NULL,
          eval_ym         TEXT NOT NULL,
          indicator_code  TEXT NOT NULL,
          group_code      TEXT NOT NULL DEFAULT '',
          actual          REAL,
          prev_actual     REAL,
          change_kind     TEXT NOT NULL DEFAULT '',
          status          TEXT NOT NULL DEFAULT 'ok',
          error_text      TEXT NOT NULL DEFAULT '',
          export_status   TEXT NOT NULL DEFAULT 'pending',
          exported_at     TEXT,
          row_no          INTEGER,
          FOREIGN KEY (batch_id) REFERENCES fact_upload_batch(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS fact_upload_change_log (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          batch_id        INTEGER NOT NULL,
          eval_ym         TEXT NOT NULL,
          indicator_code  TEXT NOT NULL,
          group_code      TEXT NOT NULL DEFAULT '',
          prev_actual     REAL,
          new_actual      REAL,
          change_kind     TEXT NOT NULL DEFAULT '',
          action          TEXT NOT NULL,
          acted_by        TEXT NOT NULL DEFAULT 'ui',
          created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (batch_id) REFERENCES fact_upload_batch(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS ix_fact_upload_batch_created ON fact_upload_batch(created_at);
        CREATE INDEX IF NOT EXISTS ix_fact_upload_item_batch ON fact_upload_item(batch_id);
        CREATE INDEX IF NOT EXISTS ix_fact_upload_item_export ON fact_upload_item(export_status, eval_ym);
        CREATE INDEX IF NOT EXISTS ix_fact_upload_change_log_batch ON fact_upload_change_log(batch_id);
        CREATE INDEX IF NOT EXISTS ix_fact_upload_change_log_created ON fact_upload_change_log(created_at);
        """
    )
    if _table_exists(conn, "fact_upload_item"):
        cols = _columns(conn, "fact_upload_item")
        if "prev_actual" not in cols:
            conn.execute("ALTER TABLE fact_upload_item ADD COLUMN prev_actual REAL")
        if "change_kind" not in cols:
            conn.execute("ALTER TABLE fact_upload_item ADD COLUMN change_kind TEXT NOT NULL DEFAULT ''")


def _migrate_ownership_columns(conn: sqlite3.Connection) -> None:
    """Lv3·지표마스터 Ownership 그룹 컬럼 + 기존 주관부서 기반 1회 백필."""
    if _table_exists(conn, "indicator_common"):
        cols = _columns(conn, "indicator_common")
        if "owner_group_code" not in cols:
            conn.execute(
                "ALTER TABLE indicator_common ADD COLUMN owner_group_code TEXT NOT NULL DEFAULT ''"
            )
    if _table_exists(conn, "indicator_code"):
        cols = _columns(conn, "indicator_code")
        if "owner_group_code" not in cols:
            conn.execute(
                "ALTER TABLE indicator_code ADD COLUMN owner_group_code TEXT NOT NULL DEFAULT ''"
            )

    if not _table_exists(conn, "indicator_common"):
        return
    if "owner_group_code" not in _columns(conn, "indicator_common"):
        return

    # 주관부서 → 단일 피평가그룹이면 Ownership 그룹 후보로 백필
    dept_map: dict[str, str] = {}
    if _table_exists(conn, "eval_plan_item") and "dept" in _columns(conn, "eval_plan_item"):
        rows = conn.execute(
            """
            SELECT TRIM(dept) AS d, group_code, COUNT(*) AS n
            FROM eval_plan_item
            WHERE TRIM(COALESCE(dept, '')) <> ''
            GROUP BY TRIM(dept), group_code
            """
        ).fetchall()
        by_dept: dict[str, list[str]] = {}
        for r in rows:
            by_dept.setdefault(r["d"], []).append(r["group_code"])
        for d, codes in by_dept.items():
            uniq = sorted({c for c in codes if c})
            if len(uniq) == 1:
                dept_map[d] = uniq[0]
        for d, g in dept_map.items():
            conn.execute(
                """
                UPDATE indicator_common
                SET owner_group_code=?
                WHERE TRIM(COALESCE(dept, ''))=?
                  AND TRIM(COALESCE(owner_group_code, ''))=''
                """,
                (g, d),
            )

    # 자식 마스터 group_code가 1종이면 Ownership 그룹으로
    if _table_exists(conn, "indicator_code"):
        conn.execute(
            """
            UPDATE indicator_common
            SET owner_group_code = (
              SELECT ic.group_code
              FROM indicator_code ic
              WHERE ic.common_code = indicator_common.common_code
              GROUP BY ic.common_code
              HAVING COUNT(DISTINCT ic.group_code) = 1
            )
            WHERE TRIM(COALESCE(owner_group_code, '')) = ''
              AND (
                SELECT COUNT(DISTINCT ic.group_code)
                FROM indicator_code ic
                WHERE ic.common_code = indicator_common.common_code
              ) = 1
            """
        )


def _migrate_fact_period_tables(conn: sqlite3.Connection) -> None:
    """그룹 확인 · 월 Freeze 테이블 보장."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS fact_group_confirm (
          eval_ym       TEXT NOT NULL,
          group_code    TEXT NOT NULL,
          status        TEXT NOT NULL DEFAULT 'open',
          confirmed_by  TEXT NOT NULL DEFAULT '',
          confirmed_at  TEXT,
          revoked_by    TEXT NOT NULL DEFAULT '',
          revoked_at    TEXT,
          note          TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (eval_ym, group_code),
          FOREIGN KEY (group_code) REFERENCES owner_group(code)
        );
        CREATE INDEX IF NOT EXISTS ix_fact_group_confirm_ym ON fact_group_confirm(eval_ym, status);

        CREATE TABLE IF NOT EXISTS fact_period_status (
          eval_ym     TEXT NOT NULL PRIMARY KEY,
          status      TEXT NOT NULL DEFAULT 'open',
          frozen_by   TEXT NOT NULL DEFAULT '',
          frozen_at   TEXT,
          unfrozen_by TEXT NOT NULL DEFAULT '',
          unfrozen_at TEXT,
          note        TEXT NOT NULL DEFAULT ''
        );
        """
    )


def _migrate_owner_group_org(conn: sqlite3.Connection) -> None:
    """owner_group 조직 레벨·상위코드 (그룹 > 본부)."""
    if not _table_exists(conn, "owner_group"):
        return
    cols = _columns(conn, "owner_group")
    if "org_level" not in cols:
        conn.execute("ALTER TABLE owner_group ADD COLUMN org_level TEXT NOT NULL DEFAULT 'GROUP'")
    if "parent_code" not in cols:
        conn.execute("ALTER TABLE owner_group ADD COLUMN parent_code TEXT")

    conn.execute("UPDATE owner_group SET org_level='BANK' WHERE code='SHB'")
    conn.execute(
        """
        UPDATE owner_group
        SET org_level='HQ', parent_code='SG1', name='PWM본부'
        WHERE code='PWM'
        """
    )
    conn.execute(
        """
        UPDATE owner_group
        SET org_level='GROUP', parent_code='SHB'
        WHERE code NOT IN ('SHB', 'PWM')
          AND COALESCE(org_level, 'GROUP') = 'GROUP'
          AND (parent_code IS NULL OR TRIM(parent_code) = '')
        """
    )


def _prepare_eval_table_migration(conn: sqlite3.Connection) -> None:
    """Drop legacy eval tables before applying schema indexes."""
    if not _table_exists(conn, "eval_plan_item"):
        return
    item_cols = _columns(conn, "eval_plan_item")
    set_exists = _table_exists(conn, "eval_plan_set")
    if set_exists and "plan_set_id" in item_cols and "year" not in item_cols:
        return
    conn.execute("DROP TABLE IF EXISTS eval_plan_item")
    conn.execute("DROP TABLE IF EXISTS eval_plan_set")


if __name__ == "__main__":
    init_schema()
    with get_connection() as c:
        print("DB:", DB_PATH)
        print("counts:", counts(c))
