"""
런타임 KPI 가라데이터 전부 삭제 (스키마 유지).
사용자 권한은 브라우저 localStorage라 DB에 없음 — 건드리지 않음.

  python wipe_runtime_data.py
  python wipe_runtime_data.py --rebuild-demo-gz
"""
from __future__ import annotations

import argparse
import gzip
import shutil
import sqlite3
import sys
from pathlib import Path

from db import BUNDLE_DATA_DIR, DATA_DIR, DB_PATH

SERVER_DIR = Path(__file__).resolve().parent
DEMO_GZ = BUNDLE_DATA_DIR / "kpi.demo.sqlite.gz"
FIXTURES_DIR = SERVER_DIR / "fixtures"
MARKER_KEY = "runtime_data_wiped_v1"

# FK 역순에 가까운 삭제 대상 (sqlite_master 기준 동적 + 이 목록 우선)
PREFERRED_ORDER = [
    "group_score_result",
    "score_rollup_term_group",
    "score_rollup_term",
    "score_rollup_rule",
    "score_rollup_set",
    "achievement_result",
    "custom_achievement",
    "fact_calc",
    "fact_collect",
    "fact_formula",
    "fact_upload_change_log",
    "fact_upload_item",
    "fact_upload_batch",
    "fact_group_confirm",
    "fact_period_status",
    "bank_export_item",
    "bank_export_batch",
    "sync_batch",
    "eval_plan_item",
    "eval_plan_set",
    "indicator_code",
    "indicator_common",
    "code_lv2",
    "code_lv1",
    "owner_group",
]


def _user_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        """
        SELECT name FROM sqlite_master
         WHERE type='table'
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name
        """
    ).fetchall()
    return [r[0] if not isinstance(r, sqlite3.Row) else r["name"] for r in rows]


def wipe_connection(conn: sqlite3.Connection, *, set_marker: bool = True) -> dict[str, int]:
    conn.execute("PRAGMA foreign_keys = OFF")
    tables = _user_tables(conn)
    ordered = [t for t in PREFERRED_ORDER if t in tables]
    ordered += [t for t in tables if t not in ordered and t != "app_meta"]
    deleted: dict[str, int] = {}
    for t in ordered:
        try:
            before = conn.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
            conn.execute(f"DELETE FROM [{t}]")
            deleted[t] = int(before)
        except sqlite3.Error as e:
            deleted[t] = -1
            print(f"skip {t}: {e}", file=sys.stderr)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
        """
    )
    if set_marker:
        conn.execute(
            "INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)",
            (MARKER_KEY, "1"),
        )
    conn.execute("PRAGMA foreign_keys = ON")
    conn.commit()
    return deleted


def wipe_db_file(db_path: Path) -> dict[str, int]:
    if not db_path.exists():
        return {}
    conn = sqlite3.connect(str(db_path))
    try:
        return wipe_connection(conn, set_marker=True)
    finally:
        conn.close()


def clear_fixtures() -> int:
    n = 0
    if not FIXTURES_DIR.exists():
        return 0
    empty = '{"year_month":"","items":[]}\n'
    for path in sorted(FIXTURES_DIR.glob("corporate_facts_*.json")):
        path.write_text(empty, encoding="utf-8")
        n += 1
    return n


def rebuild_empty_demo_gz() -> None:
    from db import get_connection, init_schema

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DATA_DIR / "kpi.empty.sqlite"
    for p in (tmp, Path(str(tmp) + "-wal"), Path(str(tmp) + "-shm")):
        if p.exists():
            p.unlink()
    conn = get_connection(tmp)
    try:
        init_schema(conn)
        wipe_connection(conn, set_marker=True)
    finally:
        conn.close()
    with open(tmp, "rb") as src, gzip.open(DEMO_GZ, "wb") as dst:
        shutil.copyfileobj(src, dst)
    tmp.unlink(missing_ok=True)
    print("Wrote", DEMO_GZ)


def ensure_wiped_once(conn: sqlite3.Connection) -> bool:
    """배포 DB에 한 번만 전체 wipe. 이미 마커 있으면 False."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
        """
    )
    row = conn.execute(
        "SELECT value FROM app_meta WHERE key=?", (MARKER_KEY,)
    ).fetchone()
    if row:
        return False
    wipe_connection(conn, set_marker=True)
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild-demo-gz", action="store_true")
    ap.add_argument("--skip-fixtures", action="store_true")
    args = ap.parse_args()

    deleted = wipe_db_file(DB_PATH)
    total = sum(v for v in deleted.values() if v > 0)
    print(f"Wiped {DB_PATH.name}: {total} rows across {len(deleted)} tables")
    for t, n in sorted(deleted.items(), key=lambda x: -x[1]):
        if n:
            print(f"  {t}: {n}")

    if not args.skip_fixtures:
        n = clear_fixtures()
        print(f"Cleared {n} fixture files")

    if args.rebuild_demo_gz:
        rebuild_empty_demo_gz()


if __name__ == "__main__":
    main()
