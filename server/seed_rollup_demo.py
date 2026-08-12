# -*- coding: utf-8 -*-
"""데모: 내부통제 ADJUST 샘플 + 2025/2026 SG1 L3 롤업 규칙 + 재계산."""
from __future__ import annotations

from db import get_connection, init_schema
from fact_pipeline import resolve_plan_set
from rollup_engine import recompute_group_scores, replace_score_rollup


def _pick_adjust_codes(conn, plan_set_id: int, group_code: str, n: int = 2) -> list[str]:
    rows = conn.execute(
        """
        SELECT indicator_code FROM eval_plan_item
        WHERE plan_set_id=? AND group_code=? AND COALESCE(use_yn,'Y')='Y'
        ORDER BY sort_order, id
        """,
        (plan_set_id, group_code),
    ).fetchall()
    codes = [r["indicator_code"] for r in rows]
    if len(codes) < n:
        return codes
    return codes[-n:]


def patch_sg1_adjust(conn, year: int = 2026) -> list[str]:
    plan = resolve_plan_set(conn, year, 1)
    if not plan:
        print("no plan", year)
        return []
    # 해당 연도 모든 plan_set에 동일 코드 ADJUST 적용
    sets = conn.execute(
        "SELECT id FROM eval_plan_set WHERE year=? ORDER BY effective_from_month",
        (year,),
    ).fetchall()
    codes = _pick_adjust_codes(conn, plan["id"], "SG1", 2)
    for s in sets:
        for code in codes:
            conn.execute(
                """
                UPDATE eval_plan_item
                SET contribution_mode='ADJUST', weight=0,
                    eval_category_lv1=CASE
                      WHEN eval_category_lv1='' OR eval_category_lv1 IS NULL THEN '내부통제'
                      ELSE eval_category_lv1 END,
                    label=CASE
                      WHEN label NOT LIKE '%내부통제%' THEN '내부통제·' || label
                      ELSE label END
                WHERE plan_set_id=? AND group_code='SG1' AND indicator_code=?
                """,
                (s["id"], code),
            )
    print(f"SG1 ADJUST codes ({year}):", codes)
    return codes


def apply_adjust_actuals(conn, year: int, codes: list[str], points: list[float]):
    for month in range(1, 13):
        ym = f"{year}{month:02d}"
        for code, pts in zip(codes, points):
            conn.execute(
                """
                UPDATE achievement_result
                SET actual=?, weight=0, converted_achievement=NULL, simple_achievement=NULL
                WHERE eval_ym=? AND group_code='SG1' AND indicator_code=?
                """,
                (pts, ym, code),
            )


def seed_l3_rules(conn):
    replace_score_rollup(
        conn, 2025, 1,
        [{
            "target_group_code": "SG1",
            "terms": [
                {"term_type": "SELF", "weight": 0.7, "sort_order": 0},
                {"term_type": "AVG_GROUPS", "weight": 0.3, "sort_order": 1,
                 "groups": ["SG1", "S22", "IAG", "CSG"]},
            ],
        }],
        "데모 2025 L3",
    )
    replace_score_rollup(
        conn, 2026, 1,
        [{
            "target_group_code": "SG1",
            "terms": [
                {"term_type": "SELF", "weight": 0.7, "sort_order": 0},
                {"term_type": "AVG_GROUPS", "weight": 0.3, "sort_order": 1,
                 "groups": ["SG1", "S22"]},
            ],
        }],
        "데모 2026 L3",
    )
    print("L3 rules seeded for 2025/2026 SG1")


def main():
    init_schema()
    with get_connection() as conn:
        codes_2026 = patch_sg1_adjust(conn, 2026)
        codes_2025 = patch_sg1_adjust(conn, 2025)
        seed_l3_rules(conn)
        if codes_2026:
            apply_adjust_actuals(conn, 2026, codes_2026, [-1.0, 2.0][: len(codes_2026)])
        if codes_2025:
            apply_adjust_actuals(conn, 2025, codes_2025, [-2.0, 1.0][: len(codes_2025)])
        for year in (2025, 2026):
            for month in range(1, 13):
                recompute_group_scores(conn, year, month)
        conn.commit()

    with get_connection() as conn:
        for ym in ("202607", "202507"):
            rows = conn.execute(
                """
                SELECT group_code, round(base_score,2) base, adjust_points pts,
                       round(adjust_pp,4) pp, round(group_final_score,2) l2,
                       round(ultimate_score,2) l3, rollup_set_id
                FROM group_score_result
                WHERE eval_ym=? AND group_code IN ('SHB','SG1','S22')
                ORDER BY group_code
                """,
                (ym,),
            ).fetchall()
            print(ym, [dict(r) for r in rows])


if __name__ == "__main__":
    main()
