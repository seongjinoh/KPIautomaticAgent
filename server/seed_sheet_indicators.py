# -*- coding: utf-8 -*-
"""엑셀 시트 지표를 데모 DB에 반영.

- 동명(표시명/Lv3명) + 동일 그룹(+가능하면 실적구분) 지표가 있으면 indicator_code 를 시트 코드로 교체
- 없으면 Lv1/Lv2/공통/마스터 신규 등록
- Lv3 전역유일 충돌 시 기존 점유 공통지표의 Lv3를 재발번(코드 cascade)

실행 (server/):
  python seed_sheet_indicators.py
  python seed_sheet_indicators.py --refresh-facts
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import shutil
import sqlite3
from pathlib import Path

from db import DATA_DIR, DB_PATH, get_connection, init_schema
from migrate_lv2_independent import INDICATOR_CODE_TABLES, _columns, _table_exists
from migrate_lv3_unique import ensure_lv3_unique_index, next_lv3_code

SERVER_DIR = Path(__file__).resolve().parent
FIXTURES = SERVER_DIR / "fixtures"
DEMO_GZ = DATA_DIR / "kpi.demo.sqlite.gz"

# (indicator_code, lv1_name, lv2_name, indicator_name, unit_hint)
SHEET_ROWS: list[tuple[str, str, str, str, str]] = [
    # image 2
    ("STR-0001-0001-NEW-SHB", "전략Seg", "군인", "군인전용대출 취급좌수", "좌"),
    ("STR-0001-0002-NEW-SHB", "전략Seg", "군인", "군인전용대출 취급액", "원"),
    ("STR-0002-0003-NEW-SHB", "전략Seg", "청년", "대학생 체크카드 발급좌수", "좌"),
    ("STR-0002-0004-TOT-SHB", "전략Seg", "청년", "20+뛰어요 가입고객 수", "명"),
    ("FIN-0003-0005-NET-IAG", "재무", "세전이익", "세전이익(조정후) (기관)", "원"),
    ("RPM-0004-0006-ETC-IAG", "RAPM", "ROC", "위험자본평잔 (기관)", "원"),
    ("RPM-0004-0007-RAT-IAG", "RAPM", "ROC", "조정ROC (기관)", "%"),
    ("RPM-0004-0008-NET-IAG", "RAPM", "ROC", "세후이익(연환산) (기관)", "원"),
    ("SND-0005-0009-TOT-IAG", "건전성", "연체", "총대출 (기관)", "원"),
    ("SND-0005-0010-TOT-IAG", "건전성", "연체", "연체대출 (기관)", "원"),
    ("SND-0005-0011-RAT-IAG", "건전성", "연체", "연체율 (기관)", "%"),
    ("COA-0006-0012-NEW-SHB", "제휴", "상품판매", "토스페이적금 가입좌수", "좌"),
    ("COA-0006-0013-NEW-SHB", "제휴", "상품판매", "Npay Biz 신한통장 가입좌수", "좌"),
    ("MAS-0007-0014-NET-SHB", "Mass고객", "고객메인화", "실거래고객", "명"),
    ("MAS-0007-0015-NET-SHB", "Mass고객", "고객메인화", "활동성고객", "명"),
    ("INC-0008-0016-ETC-SHB", "기관", "기관수익성", "기관 유동성 핵심예금", "원"),
    # image 1
    ("SOL-0009-0017-NEW-SHB", "금융플랫폼", "SOL Bank / New Super SOL", "SOL 가입고객수", "명"),
    ("SOL-0009-0018-TOT-SHB", "금융플랫폼", "SOL Bank / New Super SOL", "SOL MAU (전체)", "명"),
    ("SOL-0009-0019-RAT-SHB", "금융플랫폼", "SOL Bank / New Super SOL", "SOL MAU 유지율 (로그인 고객 限)", "%"),
    ("SOL-0009-0020-TOT-SHB", "금융플랫폼", "SOL Bank / New Super SOL", "SOL진성고객 (3개월 연속 이용고객)", "명"),
    ("SOL-0010-0021-TOT-SHB", "금융플랫폼", "SOL BIZ", "SOL BIZ MAU", "명"),
    ("SOL-0011-0022-TOT-SHB", "금융플랫폼", "핵심서비스 MAU", "걸어요 50+ MAU", "명"),
    ("SOL-0011-0023-TOT-SHB", "금융플랫폼", "핵심서비스 MAU", "뛰어요 20+ MAU", "명"),
    ("SOL-0011-0024-TOT-SHB", "금융플랫폼", "핵심서비스 MAU", "급여클럽+ MAU", "명"),
    ("SOL-0011-0025-TOT-SHB", "금융플랫폼", "핵심서비스 MAU", "머니버스 MAU", "명"),
    ("SOL-0011-0026-TOT-SHB", "금융플랫폼", "핵심서비스 MAU", "쏠야구 MAU", "명"),
    ("SOL-0011-0027-TOT-SHB", "금융플랫폼", "핵심서비스 MAU", "디지털자산관리 MAU", "명"),
    ("SND-0005-0009-TOT-CSI", "건전성", "연체", "총대출 (개인)", "원"),
    ("SND-0005-0010-TOT-CSI", "건전성", "연체", "연체대출 (개인)", "원"),
    ("SND-0005-0011-RAT-CSI", "건전성", "연체", "연체율 (개인)", "%"),
    ("SND-0005-0009-TOT-CSC", "건전성", "연체", "총대출 (기업)", "원"),
    ("SND-0005-0010-TOT-CSC", "건전성", "연체", "연체대출 (기업)", "원"),
    ("SND-0005-0011-RAT-CSC", "건전성", "연체", "연체율 (기업)", "%"),
]

EXTRA_GROUPS = [
    ("CSI", "개인여신(데모)", 90),
    ("CSC", "기업여신(데모)", 91),
]

CODE_RE = re.compile(
    r"^([A-Z0-9]{2,4})-([A-Z0-9]{3,4})-(\d{3,4})-([A-Z]{3})-([A-Z0-9]{2,4})$",
    re.I,
)


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", str(s or "")).lower().replace("（", "(").replace("）", ")")


def _parse(code: str) -> tuple[str, str, str, str, str]:
    m = CODE_RE.match(code.strip().upper())
    if not m:
        raise ValueError(f"bad indicator code: {code}")
    return m.group(1).upper(), m.group(2), m.group(3), m.group(4).upper(), m.group(5).upper()


def _ensure_group(conn: sqlite3.Connection, code: str, name: str, sort_order: int = 99) -> None:
    row = conn.execute("SELECT code FROM owner_group WHERE code=?", (code,)).fetchone()
    if row:
        return
    conn.execute(
        "INSERT INTO owner_group(code, name, sort_order, use_yn, org_level) VALUES (?,?,?,?,?)",
        (code, name, sort_order, "Y", "GROUP"),
    )


def _ensure_lv1(conn: sqlite3.Connection, code: str, name: str) -> None:
    row = conn.execute("SELECT code, name FROM code_lv1 WHERE code=?", (code,)).fetchone()
    if row:
        if str(row["name"]) != name:
            conn.execute("UPDATE code_lv1 SET name=? WHERE code=?", (name, code))
        return
    mx = conn.execute("SELECT COALESCE(MAX(sort_order),0) FROM code_lv1").fetchone()[0]
    conn.execute(
        "INSERT INTO code_lv1(code, name, sort_order, use_yn) VALUES (?,?,?,?)",
        (code, name, int(mx) + 1, "Y"),
    )


def _ensure_lv2(conn: sqlite3.Connection, code: str, name: str) -> None:
    row = conn.execute("SELECT code, name FROM code_lv2 WHERE code=?", (code,)).fetchone()
    if row:
        # 전역 Lv2 코드는 이미 다른 용도로 쓰일 수 있음 → 이름 덮어쓰지 않음
        return
    mx = conn.execute("SELECT COALESCE(MAX(sort_order),0) FROM code_lv2").fetchone()[0]
    conn.execute(
        "INSERT INTO code_lv2(code, name, sort_order, use_yn) VALUES (?,?,?,?)",
        (code, name, int(mx) + 1, "Y"),
    )


def _rewrite_indicator_code(conn: sqlite3.Connection, old: str, new: str) -> None:
    old, new = old.upper(), new.upper()
    if old == new:
        return
    if conn.execute("SELECT 1 FROM indicator_code WHERE indicator_code=?", (new,)).fetchone():
        # target already exists: merge by deleting old after moving refs that don't conflict
        pass
    # child tables first
    for table, col in INDICATOR_CODE_TABLES:
        if not _table_exists(conn, table):
            continue
        if col not in _columns(conn, table):
            continue
        try:
            conn.execute(
                f"UPDATE {table} SET {col}=? WHERE {col}=?",
                (new, old),
            )
        except sqlite3.IntegrityError:
            # unique conflict: drop old-code rows (keep new)
            conn.execute(f"DELETE FROM {table} WHERE {col}=?", (old,))
    # formulas output + operands json
    if _table_exists(conn, "fact_formula"):
        conn.execute(
            "UPDATE fact_formula SET output_indicator_code=? WHERE output_indicator_code=?",
            (new, old),
        )
        for row in conn.execute("SELECT id, operands_json FROM fact_formula").fetchall():
            raw = row["operands_json"] or ""
            if old not in raw:
                continue
            try:
                ops = json.loads(raw) if isinstance(raw, str) else dict(raw)
            except Exception:
                continue
            changed = False
            for k, v in list(ops.items()):
                if str(v).strip().upper() == old:
                    ops[k] = new
                    changed = True
            if changed:
                conn.execute(
                    "UPDATE fact_formula SET operands_json=? WHERE id=?",
                    (json.dumps(ops, ensure_ascii=False), row["id"]),
                )
    # finally master row
    exists_new = conn.execute(
        "SELECT 1 FROM indicator_code WHERE indicator_code=?", (new,)
    ).fetchone()
    if exists_new:
        conn.execute("DELETE FROM indicator_code WHERE indicator_code=?", (old,))
    else:
        conn.execute(
            "UPDATE indicator_code SET indicator_code=? WHERE indicator_code=?",
            (new, old),
        )


def _relocate_lv3_holder(conn: sqlite3.Connection, lv3: str, keep_common: str | None = None) -> str | None:
    """lv3 를 쓰는 다른 공통지표가 있으면 새 lv3 로 옮기고 indicator_code cascade."""
    rows = conn.execute(
        "SELECT * FROM indicator_common WHERE lv3_code=?",
        (lv3,),
    ).fetchall()
    moved = None
    for row in rows:
        common = str(row["common_code"])
        if keep_common and common == keep_common:
            continue
        new_lv3 = next_lv3_code(conn)
        old_lv1, old_lv2, old_lv3 = row["lv1_code"], row["lv2_code"], row["lv3_code"]
        new_common = f"{old_lv1}-{old_lv2}-{new_lv3}"
        # update common
        conn.execute(
            "UPDATE indicator_common SET lv3_code=?, common_code=? WHERE common_code=?",
            (new_lv3, new_common, common),
        )
        # rewrite all indicator codes under this common
        for ic in conn.execute(
            "SELECT indicator_code, perf_code, group_code FROM indicator_code WHERE common_code=?",
            (common,),
        ).fetchall():
            # common_code already updated above if FK cascades? we updated PK of common — need update children common_code first
            pass
        # children still point to old common_code — fix
        conn.execute(
            "UPDATE indicator_code SET common_code=? WHERE common_code=?",
            (new_common, common),
        )
        # actually we already changed common PK — SQLite may not cascade. Re-read.
        # We updated common_code in place from old→new in same UPDATE — children still have old.
        # Fix: do it properly
        moved = new_lv3
    return moved


def _free_lv3(conn: sqlite3.Connection, wanted_lv3: str, wanted_common: str) -> None:
    holders = conn.execute(
        "SELECT common_code, lv1_code, lv2_code, lv3_code, name FROM indicator_common WHERE lv3_code=?",
        (wanted_lv3,),
    ).fetchall()
    for h in holders:
        if str(h["common_code"]) == wanted_common:
            continue
        old_common = str(h["common_code"])
        new_lv3 = next_lv3_code(conn)
        # avoid collision with wanted
        while new_lv3 == wanted_lv3:
            # bump artificially
            used = {new_lv3}
            n = int(new_lv3) + 1
            new_lv3 = f"{n:04d}"
            if new_lv3 in used:
                new_lv3 = next_lv3_code(conn)
                break
        lv1, lv2 = h["lv1_code"], h["lv2_code"]
        new_common = f"{lv1}-{lv2}-{new_lv3}"
        codes = conn.execute(
            "SELECT indicator_code, perf_code, group_code, display_name, unit, agg_type, use_yn FROM indicator_code WHERE common_code=?",
            (old_common,),
        ).fetchall()
        # insert new common row, migrate codes, delete old common
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(indicator_common)")]
        data = {k: h[k] for k in h.keys()}
        data["common_code"] = new_common
        data["lv3_code"] = new_lv3
        vals = []
        for c in cols:
            v = data.get(c)
            if v is None and c not in ("id",):
                v = ""
            vals.append(v)
        placeholders = ",".join("?" for _ in cols)
        conn.execute(
            f"INSERT INTO indicator_common({','.join(cols)}) VALUES ({placeholders})",
            vals,
        )
        for ic in codes:
            old_code = str(ic["indicator_code"])
            new_code = f"{lv1}-{lv2}-{new_lv3}-{ic['perf_code']}-{ic['group_code']}"
            # point to new common first under a temp approach: rewrite code
            conn.execute(
                "UPDATE indicator_code SET common_code=? WHERE indicator_code=?",
                (new_common, old_code),
            )
            _rewrite_indicator_code(conn, old_code, new_code)
        conn.execute("DELETE FROM indicator_common WHERE common_code=?", (old_common,))
        print(f"  relocated lv3 {wanted_lv3}: {old_common} → {new_common}")


def _find_rename_candidate(
    conn: sqlite3.Connection, name: str, group: str, perf: str
) -> str | None:
    """동명 지표 코드 찾기. 이미 목표 코드면 None(스킵)."""
    target_norm = _norm(name)
    rows = conn.execute(
        """
        SELECT ic.indicator_code, ic.display_name, cm.name AS lv3_name,
               ic.group_code, ic.perf_code
        FROM indicator_code ic
        JOIN indicator_common cm ON cm.common_code = ic.common_code
        WHERE ic.group_code = ?
        """,
        (group,),
    ).fetchall()
    exact, soft = [], []
    for r in rows:
        dn = _norm(r["display_name"] or "")
        ln = _norm(r["lv3_name"] or "")
        code = str(r["indicator_code"]).upper()
        if dn == target_norm or ln == target_norm:
            if str(r["perf_code"]).upper() == perf:
                exact.append(code)
            else:
                soft.append(code)
        # "활동성고객 연간순증" 등 접두 매칭 (NET 우선)
        elif dn.startswith(target_norm) or ln.startswith(target_norm):
            if str(r["perf_code"]).upper() == perf:
                soft.append(code)
    if exact:
        return exact[0]
    if soft:
        return soft[0]
    return None


def _upsert_common(
    conn: sqlite3.Connection,
    *,
    lv1: str,
    lv2: str,
    lv3: str,
    name: str,
    unit: str,
    group: str,
) -> str:
    common = f"{lv1}-{lv2}-{lv3}"
    _free_lv3(conn, lv3, common)
    row = conn.execute(
        "SELECT common_code FROM indicator_common WHERE common_code=?",
        (common,),
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE indicator_common SET name=?, unit=?, lv1_code=?, lv2_code=?, lv3_code=?, use_yn='Y' WHERE common_code=?",
            (name, unit, lv1, lv2, lv3, common),
        )
        return common
    # also check by lv3 after free
    conn.execute(
        """
        INSERT INTO indicator_common(
          common_code, lv1_code, lv2_code, lv3_code, name, unit,
          allowed_perf, common_yn, use_yn, owner_group_code, data_source
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            common, lv1, lv2, lv3, name, unit,
            "", "단독", "Y", group, "데모시드(시트지표)",
        ),
    )
    return common


def _upsert_indicator(
    conn: sqlite3.Connection,
    *,
    code: str,
    common: str,
    group: str,
    perf: str,
    name: str,
    unit: str,
) -> None:
    row = conn.execute(
        "SELECT indicator_code FROM indicator_code WHERE indicator_code=?",
        (code,),
    ).fetchone()
    if row:
        conn.execute(
            """
            UPDATE indicator_code
               SET common_code=?, group_code=?, perf_code=?, display_name=?, unit=?, use_yn='Y',
                   data_source=COALESCE(NULLIF(data_source,''), '데모시드(시트지표)')
             WHERE indicator_code=?
            """,
            (common, group, perf, name, unit, code),
        )
        return
    conn.execute(
        """
        INSERT INTO indicator_code(
          indicator_code, common_code, group_code, perf_code, display_name, unit, use_yn, data_source
        ) VALUES (?,?,?,?,?,?,?,?)
        """,
        (code, common, group, perf, name, unit, "Y", "데모시드(시트지표)"),
    )


def _attach_to_latest_2026_plan(
    conn: sqlite3.Connection,
    rows: list[tuple[str, str, str, str, str]],
) -> int:
    plan = conn.execute(
        """
        SELECT id FROM eval_plan_set
         WHERE year=2026
         ORDER BY effective_from_month DESC, id DESC
         LIMIT 1
        """
    ).fetchone()
    if not plan:
        return 0
    plan_id = int(plan["id"])
    added = 0
    sort0 = conn.execute(
        "SELECT COALESCE(MAX(sort_order),0) FROM eval_plan_item WHERE plan_set_id=?",
        (plan_id,),
    ).fetchone()[0]
    for i, (code, lv1_name, lv2_name, ind_name, unit) in enumerate(rows):
        exists = conn.execute(
            "SELECT 1 FROM eval_plan_item WHERE plan_set_id=? AND indicator_code=?",
            (plan_id, code),
        ).fetchone()
        if exists:
            # 라벨/카테고리만 시트 기준으로 보정
            conn.execute(
                """
                UPDATE eval_plan_item
                   SET label=?, eval_category_lv1=?, eval_category_lv2=?, eval_category_lv3=?,
                       unit=COALESCE(NULLIF(unit,''), ?)
                 WHERE plan_set_id=? AND indicator_code=?
                """,
                (ind_name, lv1_name, lv2_name, ind_name, unit, plan_id, code),
            )
            continue
        ic = conn.execute(
            "SELECT * FROM indicator_code WHERE indicator_code=?",
            (code,),
        ).fetchone()
        if not ic:
            continue
        u = ic["unit"] or unit
        annual = 100.0 if (ic["perf_code"] == "RAT" or u == "%") else 10000.0
        conn.execute(
            """
            INSERT INTO eval_plan_item(
              plan_set_id, group_code, indicator_code, mgmt_tool,
              eval_category_lv1, eval_category_lv2, eval_category_lv3,
              label, unit, weight, is_core, annual_target, monthly_target, baseline_actual,
              data_source, definition_text, calc_logic_text,
              achievement_mode, goal_direction, sort_order, use_yn, contribution_mode
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                plan_id, ic["group_code"], code, "KPI",
                lv1_name, lv2_name, ind_name,
                ind_name, u, 3.0, "Y", annual, annual, annual * 0.85,
                "데모시드(시트지표)",
                f"{ind_name} 데모 지표정의.",
                "월간목표=연간목표(매월 동일). 달성률=100+(실적-목표)/목표×100.",
                "flat", "increase", int(sort0) + 1 + i, "Y", "WEIGHT",
            ),
        )
        added += 1
    return added


def _patch_fixtures(codes: list[str]) -> int:
    patched = 0
    for path in sorted(FIXTURES.glob("corporate_facts_*.json")):
        if path.name.endswith("sample.json"):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        items = data.get("items") or []
        by = {str(x.get("indicator_code", "")).upper(): x for x in items}
        changed = False
        # stable-ish actual from code hash
        for code in codes:
            if code in by:
                continue
            h = abs(hash(code + path.stem)) % 10_000
            if code.endswith("-RAT-SHB") or "-RAT-" in code:
                actual = round(80 + (h % 40) + (h % 10) / 10, 2)
            elif "-NEW-" in code or code.split("-")[3] == "NEW":
                actual = float(1000 + h)
            else:
                actual = float(10_000 + h * 17)
            items.append({"indicator_code": code, "actual": actual})
            changed = True
        if changed:
            data["items"] = items
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            patched += 1
    return patched


def _write_demo_gz(conn: sqlite3.Connection) -> None:
    conn.commit()
    # copy live db to gz
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # ensure WAL checkpoint
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    with open(DB_PATH, "rb") as src, gzip.open(DEMO_GZ, "wb", compresslevel=9) as dst:
        shutil.copyfileobj(src, dst)
    print("wrote", DEMO_GZ, "bytes", DEMO_GZ.stat().st_size)


def run(*, refresh_facts: bool = False) -> dict:
    init_schema()
    conn = get_connection()
    stats = {"renamed": [], "created": [], "updated": [], "plan_added": 0, "fixtures": 0}

    try:
        for code, name, sort in EXTRA_GROUPS:
            _ensure_group(conn, code, name, sort)

        # ensure all target groups exist
        for full, *_rest in SHEET_ROWS:
            *_a, group = _parse(full)
            if not conn.execute("SELECT 1 FROM owner_group WHERE code=?", (group,)).fetchone():
                _ensure_group(conn, group, group, 99)

        ensure_lv3_unique_index(conn)

        final_codes: list[str] = []
        for full, lv1_name, lv2_name, ind_name, unit in SHEET_ROWS:
            lv1, lv2, lv3, perf, group = _parse(full)
            _ensure_lv1(conn, lv1, lv1_name)
            _ensure_lv2(conn, lv2, lv2_name)

            cand = _find_rename_candidate(conn, ind_name, group, perf)
            if cand and cand != full:
                # prepare common first
                common = _upsert_common(
                    conn, lv1=lv1, lv2=lv2, lv3=lv3, name=ind_name, unit=unit, group=group
                )
                # if cand points elsewhere, rewrite to full then upsert row
                _rewrite_indicator_code(conn, cand, full)
                _upsert_indicator(
                    conn, code=full, common=common, group=group, perf=perf, name=ind_name, unit=unit
                )
                stats["renamed"].append(f"{cand} → {full} ({ind_name})")
                print("rename", cand, "→", full)
            elif cand == full or conn.execute(
                "SELECT 1 FROM indicator_code WHERE indicator_code=?", (full,)
            ).fetchone():
                common = _upsert_common(
                    conn, lv1=lv1, lv2=lv2, lv3=lv3, name=ind_name, unit=unit, group=group
                )
                _upsert_indicator(
                    conn, code=full, common=common, group=group, perf=perf, name=ind_name, unit=unit
                )
                stats["updated"].append(full)
            else:
                common = _upsert_common(
                    conn, lv1=lv1, lv2=lv2, lv3=lv3, name=ind_name, unit=unit, group=group
                )
                _upsert_indicator(
                    conn, code=full, common=common, group=group, perf=perf, name=ind_name, unit=unit
                )
                stats["created"].append(full)
                print("create", full, ind_name)

            final_codes.append(full)

        stats["plan_added"] = _attach_to_latest_2026_plan(conn, SHEET_ROWS)
        conn.commit()

        stats["fixtures"] = _patch_fixtures(final_codes)

        if refresh_facts:
            from fact_pipeline import refresh_facts as do_refresh
            from rollup_engine import recompute_group_scores

            for month in range(1, 13):
                do_refresh(conn, 2026, month)
            recompute_group_scores(conn, 2026, 7)
            conn.commit()

        _write_demo_gz(conn)
    finally:
        conn.close()
    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh-facts", action="store_true")
    args = ap.parse_args()
    stats = run(refresh_facts=args.refresh_facts)
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
