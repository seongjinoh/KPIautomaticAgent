# -*- coding: utf-8 -*-
"""2026년 평가배치에 내부통제(ADJUST) 가라데이터 생성.

- 전행(SHB) 제외
- ICT 마스터 기반 지표코드 확보 후 평가배치 편성
- 월별 가감점(actual) + group_score 재계산
"""
from __future__ import annotations

import hashlib
from db import compose_indicator_code, get_connection, init_schema
from fact_pipeline import eval_ym
from rollup_engine import recompute_group_scores

YEAR = 2026
PERF = "PTS"  # 가감 점수용

# 공통 내부통제 항목 (lv2명, 지표명) — 코드는 이름 조회 후 없으면 0001부터 발번
IC_ITEMS = [
    ("내부통제", "내부통제 종합 가감"),
    ("불완전판매", "불완전판매 가감"),
    ("금융사고", "금융사고 가감"),
    ("감사·준법", "감사·준법 지적 가감"),
    ("AML·제재", "AML·제재 가감"),
]


def _stable_points(group: str, common: str, month: int) -> float:
    """그룹·항목·월별 -3~+3 정수 가감점 (0 포함)."""
    h = hashlib.md5(f"{group}:{common}:{month}:ic2026".encode()).hexdigest()
    n = int(h[:8], 16)
    return float((n % 7) - 3)  # -3..+3


def ensure_ic_master(conn) -> list[dict]:
    """ICT common + lv2 를 이름으로 재사용하고, 없으면 0001부터 발번."""
    from migrate_lv2_independent import next_lv2_code
    from migrate_lv3_unique import next_lv3_code

    conn.execute(
        "INSERT OR IGNORE INTO code_lv1(code, name, sort_order, use_yn) VALUES ('ICT','내부통제',99,'Y')"
    )

    def _ensure_lv2(name: str) -> str:
        row = conn.execute("SELECT code FROM code_lv2 WHERE name=? LIMIT 1", (name,)).fetchone()
        if row:
            return str(row["code"])
        code = next_lv2_code(conn)
        conn.execute(
            "INSERT INTO code_lv2(code, name, sort_order, use_yn) VALUES (?,?,?, 'Y')",
            (code, name, int(code)),
        )
        return code

    commons = []
    for lv2_name, name in IC_ITEMS:
        existing = conn.execute(
            """
            SELECT common_code, lv2_code, lv3_code FROM indicator_common
            WHERE name=? AND lv1_code='ICT' LIMIT 1
            """,
            (name,),
        ).fetchone()
        if existing:
            commons.append({
                "common_code": existing["common_code"],
                "lv2": existing["lv2_code"],
                "lv3": existing["lv3_code"],
                "name": name,
            })
            continue
        lv2 = _ensure_lv2(lv2_name)
        lv3 = next_lv3_code(conn)
        common = f"ICT-{lv2}-{lv3}"
        conn.execute(
            """
            INSERT INTO indicator_common(common_code, lv1_code, lv2_code, lv3_code, name, unit, allowed_perf, common_yn, use_yn,
              definition_text, calc_logic_text, dept, calc_cycle, calc_timing, data_source_kind, data_source)
            VALUES (?,?,?,?,?, '점', '', '공통', 'Y',
              ?, '내부통제 가감 점수 합산', '준법감시', '월간', '월말', '기타', '수기/내부통제 시스템')
            ON CONFLICT(common_code) DO UPDATE SET
              name=excluded.name,
              unit=excluded.unit,
              definition_text=excluded.definition_text,
              calc_logic_text=excluded.calc_logic_text,
              dept=excluded.dept,
              calc_cycle=excluded.calc_cycle,
              calc_timing=excluded.calc_timing,
              data_source_kind=excluded.data_source_kind,
              data_source=excluded.data_source,
              use_yn='Y'
            """,
            (common, "ICT", lv2, lv3, name, f"{name} 내부통제 가감 항목"),
        )
        commons.append({"common_code": common, "lv2": lv2, "lv3": lv3, "name": name})
    return commons


def ensure_group_codes(conn, groups: list[str], commons: list[dict]) -> dict[str, list[str]]:
    """그룹별 ICT-…-PTS-{GROUP} 지표코드 생성. 반환: group -> [indicator_code...]"""
    out: dict[str, list[str]] = {}
    for g in groups:
        codes = []
        for cm in commons:
            code = compose_indicator_code("ICT", cm["lv2"], cm["lv3"], PERF, g)
            conn.execute(
                """
                INSERT INTO indicator_code(
                  indicator_code, common_code, group_code, perf_code, display_name, unit, agg_type, use_yn
                ) VALUES (?,?,?,?,?,?, 'SUM', 'Y')
                ON CONFLICT(indicator_code) DO UPDATE SET
                  display_name=excluded.display_name,
                  unit=excluded.unit,
                  use_yn='Y'
                """,
                (code, cm["common_code"], g, PERF, cm["name"], "점"),
            )
            codes.append(code)
        out[g] = codes
    return out


def revert_bogus_adjust(conn, plan_set_id: int):
    """이전에 KPI를 ADJUST로 바꿔 둔 비ICT 항목 복구."""
    conn.execute(
        """
        UPDATE eval_plan_item
        SET contribution_mode='WEIGHT',
            label=REPLACE(label, '내부통제·', '')
        WHERE plan_set_id=?
          AND contribution_mode='ADJUST'
          AND indicator_code NOT LIKE 'ICT-%'
        """,
        (plan_set_id,),
    )


def upsert_plan_adjust_items(conn, plan_set_id: int, group: str, codes: list[str], commons: list[dict]):
    # 기존 ICT ADJUST 정리 후 재삽입(동일 키면 update)
    for code, cm in zip(codes, commons):
        existing = conn.execute(
            """
            SELECT id FROM eval_plan_item
            WHERE plan_set_id=? AND group_code=? AND indicator_code=? AND mgmt_tool='KPI'
            """,
            (plan_set_id, group, code),
        ).fetchone()
        max_sort = conn.execute(
            "SELECT COALESCE(MAX(sort_order),0) AS m FROM eval_plan_item WHERE plan_set_id=? AND group_code=?",
            (plan_set_id, group),
        ).fetchone()["m"]
        fields = dict(
            label=cm["name"],
            unit="점",
            weight=0,
            contribution_mode="ADJUST",
            eval_category_lv1="내부통제",
            eval_category_lv2=cm["name"].split()[0] if cm["name"] else "내부통제",
            eval_category_lv3=cm["name"],
            annual_target=0,
            baseline_actual=0,
            achievement_mode="flat",
            goal_direction="increase",
            is_core="N",
            use_yn="Y",
            sort_order=int(max_sort) + 10,
            data_source="내부통제 점검표",
            definition_text="내부통제 가감 항목. 실적 1점 = 종합달성률 ±0.01%p.",
            calc_logic_text="가감점 합 × 0.01%p 를 그룹 L1에 더함.",
        )
        if existing:
            conn.execute(
                """
                UPDATE eval_plan_item SET
                  label=?, unit=?, weight=0, contribution_mode='ADJUST',
                  eval_category_lv1=?, eval_category_lv2=?, eval_category_lv3=?,
                  annual_target=0, baseline_actual=0, achievement_mode='flat',
                  is_core='N', use_yn='Y', data_source=?,
                  definition_text=?, calc_logic_text=?
                WHERE id=?
                """,
                (
                    fields["label"], fields["unit"],
                    fields["eval_category_lv1"], fields["eval_category_lv2"], fields["eval_category_lv3"],
                    fields["data_source"],
                    fields["definition_text"], fields["calc_logic_text"],
                    existing["id"],
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO eval_plan_item(
                  plan_set_id, group_code, indicator_code, mgmt_tool,
                  eval_category_lv1, eval_category_lv2, eval_category_lv3,
                  label, unit, weight, is_core, annual_target, baseline_actual,
                  data_source, definition_text, calc_logic_text,
                  achievement_mode, goal_direction, sort_order, use_yn, contribution_mode
                ) VALUES (?,?,?,'KPI',?,?,?,?,?,?, 'N', 0, 0,?,?,?, 'flat', 'increase', ?, 'Y', 'ADJUST')
                """,
                (
                    plan_set_id, group, code,
                    fields["eval_category_lv1"], fields["eval_category_lv2"], fields["eval_category_lv3"],
                    fields["label"], fields["unit"], 0,
                    fields["data_source"],
                    fields["definition_text"], fields["calc_logic_text"],
                    fields["sort_order"],
                ),
            )


def seed_achievements(conn, group: str, codes: list[str], commons: list[dict]):
    for month in range(1, 13):
        ym = eval_ym(YEAR, month)
        for code, cm in zip(codes, commons):
            pts = _stable_points(group, cm["common_code"], month)
            conn.execute(
                """
                INSERT INTO achievement_result(
                  eval_ym, group_code, indicator_code, actual, annual_target, monthly_target,
                  simple_achievement, converted_achievement, achievement_mode, goal_direction,
                  weight, label, unit, eval_category_lv1, eval_category_lv2, eval_category_lv3, mgmt_tool
                ) VALUES (?,?,?,?,0,NULL,NULL,NULL,'flat','increase',0,?,?,?,?,?,'KPI')
                ON CONFLICT(eval_ym, group_code, indicator_code) DO UPDATE SET
                  actual=excluded.actual,
                  weight=0,
                  simple_achievement=NULL,
                  converted_achievement=NULL,
                  label=excluded.label,
                  unit=excluded.unit,
                  eval_category_lv1=excluded.eval_category_lv1,
                  eval_category_lv2=excluded.eval_category_lv2,
                  eval_category_lv3=excluded.eval_category_lv3
                """,
                (
                    ym, group, code, pts,
                    cm["name"], "점",
                    "내부통제", cm["name"].split()[0], cm["name"],
                ),
            )


def main():
    init_schema()
    with get_connection() as conn:
        plans = conn.execute(
            "SELECT id, effective_from_month FROM eval_plan_set WHERE year=? ORDER BY effective_from_month",
            (YEAR,),
        ).fetchall()
        if not plans:
            raise SystemExit("2026 eval_plan_set 없음")

        groups = [
            r["group_code"]
            for r in conn.execute(
                """
                SELECT DISTINCT e.group_code
                FROM eval_plan_item e
                JOIN eval_plan_set s ON s.id=e.plan_set_id
                WHERE s.year=? AND e.group_code<>'SHB'
                ORDER BY e.group_code
                """,
                (YEAR,),
            )
        ]

        commons = ensure_ic_master(conn)
        code_map = ensure_group_codes(conn, groups, commons)

        for plan in plans:
            revert_bogus_adjust(conn, plan["id"])
            for g in groups:
                upsert_plan_adjust_items(conn, plan["id"], g, code_map[g], commons)

        for g in groups:
            seed_achievements(conn, g, code_map[g], commons)

        for month in range(1, 13):
            recompute_group_scores(conn, YEAR, month)

        conn.commit()

        print("groups", groups)
        print("items/group", len(commons))
        adj = conn.execute(
            """
            SELECT e.group_code, count(*) n
            FROM eval_plan_item e
            JOIN eval_plan_set s ON s.id=e.plan_set_id
            WHERE s.year=? AND e.contribution_mode='ADJUST'
            GROUP BY e.group_code ORDER BY 1
            """,
            (YEAR,),
        ).fetchall()
        print("ADJUST plan counts", [dict(r) for r in adj])

        sample = conn.execute(
            """
            SELECT group_code, round(base_score,2) base, adjust_points pts,
                   round(adjust_pp,4) pp, round(group_final_score,2) l2,
                   round(ultimate_score,2) l3
            FROM group_score_result
            WHERE eval_ym='202607' AND group_code IN ('SHB','SG1','S22','CSG','WMG')
            ORDER BY group_code
            """
        ).fetchall()
        print("scores 2026-07", [dict(r) for r in sample])

        pts = conn.execute(
            """
            SELECT group_code, indicator_code, actual, label
            FROM achievement_result
            WHERE eval_ym='202607' AND indicator_code LIKE 'ICT-%-PTS-%'
            ORDER BY group_code, indicator_code
            LIMIT 15
            """
        ).fetchall()
        print("sample points", [dict(r) for r in pts])


if __name__ == "__main__":
    main()
