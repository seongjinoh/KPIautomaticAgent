# -*- coding: utf-8 -*-
"""2026년 1~6월 가상 실적 생성 → fixtures + fact refresh.

월간목표 대비 달성률이 대체로 80~115% 구간에 분포하도록 actual을 산출한다.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from achievement_engine import compute_monthly_target, normalize_direction
from db import get_connection
from fact_pipeline import list_plan_items, refresh_facts, resolve_plan_set

YEAR = 2026
MONTHS = list(range(1, 7))
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _stable_unit(code: str, month: int) -> float:
    """0~1 안정 난수."""
    h = hashlib.md5(f"{code}:{month}".encode("utf-8")).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def _target_achievement(code: str, month: int) -> float:
    """목표 달성률(%) — 월이 갈수록 평균이 살짝 오르고, 지표별 분산."""
    u = _stable_unit(code, month)
    # 월 진행 보너스: 1월 ~92, 6월 ~102 중심
    base = 88.0 + month * 2.2
    # ±18%p 스프레드 (일부 부진/초과)
    spread = (u - 0.5) * 36.0
    # 소수는 의도적으로 부진/초과
    if u < 0.08:
        ach = 68.0 + u * 80
    elif u > 0.94:
        ach = 112.0 + (u - 0.94) * 80
    else:
        ach = base + spread
    return max(55.0, min(128.0, round(ach, 2)))


def _actual_from_target(target: float, ach: float, direction: str) -> float:
    if target is None or not math.isfinite(target) or target == 0:
        # 목표가 0이면 달성률 공식상 특수 — 소액 실적만
        return 0.0
    if direction == "decrease":
        # ach = 100 + (target-actual)/target*100  → actual = target * (2 - ach/100)
        ratio = 2.0 - (ach / 100.0)
        ratio = max(0.05, min(1.8, ratio))
        actual = target * ratio
    else:
        actual = target * (ach / 100.0)
    return round(actual * 100) / 100


def build_month_items(items: list[dict], year: int, month: int) -> list[dict]:
    out = []
    for item in items:
        code = item["indicator_code"]
        target = compute_monthly_target(item, month, year)
        if target is None:
            continue
        ach = _target_achievement(code, month)
        direction = normalize_direction(item.get("goal_direction"))
        actual = _actual_from_target(float(target), ach, direction)
        out.append({"indicator_code": code, "actual": actual})
    return out


def main():
    FIXTURES.mkdir(parents=True, exist_ok=True)
    with get_connection() as conn:
        plan = resolve_plan_set(conn, YEAR, 1)
        if not plan:
            raise SystemExit("no 2026 eval plan")
        items = list_plan_items(conn, plan["id"])
        print(f"plan_set_id={plan['id']} indicators={len(items)}")

    summaries = []
    for month in MONTHS:
        rows = build_month_items(items, YEAR, month)
        path = FIXTURES / f"corporate_facts_{YEAR}{month:02d}.json"
        path.write_text(json.dumps({"items": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"wrote {path.name} n={len(rows)}")

        with get_connection() as conn:
            result = refresh_facts(conn, YEAR, month)
        summaries.append((month, result.get("collect"), result.get("achievement")))

    print("=== refresh ===")
    for month, collect, ach in summaries:
        print(f"  {YEAR}-{month:02d}: collect={collect} achievement={ach}")

    # 샘플 달성률 분포
    with get_connection() as conn:
        print("=== IAG achievement sample (Jun) ===")
        for r in conn.execute(
            """
            SELECT label, monthly_target, actual, converted_achievement
            FROM achievement_result
            WHERE eval_ym='202606' AND group_code='IAG'
            ORDER BY label LIMIT 8
            """
        ):
            print(
                f"  ach={r['converted_achievement']!s:>7} "
                f"tgt={r['monthly_target']!s:>8} act={r['actual']!s:>8} | {r['label']}"
            )
        dist = list(conn.execute(
            """
            SELECT
              SUM(CASE WHEN converted_achievement < 80 THEN 1 ELSE 0 END) AS under80,
              SUM(CASE WHEN converted_achievement >= 80 AND converted_achievement < 100 THEN 1 ELSE 0 END) AS mid,
              SUM(CASE WHEN converted_achievement >= 100 THEN 1 ELSE 0 END) AS over100,
              ROUND(AVG(converted_achievement), 1) AS avg_ach
            FROM achievement_result
            WHERE eval_ym='202606' AND converted_achievement IS NOT NULL
            """
        ))
        print("Jun distribution:", dict(dist[0]))


if __name__ == "__main__":
    main()
