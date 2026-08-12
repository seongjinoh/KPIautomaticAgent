# -*- coding: utf-8 -*-
"""데모용 풍성 시드: 평가배치(2022~2026) + 실적(2022-01~2026-12) + 가공식.

실행 (server/):
  python seed_demo_rich.py

전제: indicator_code 마스터가 이미 import 되어 있어야 함.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
from collections import defaultdict
from copy import deepcopy
from pathlib import Path

from achievement_engine import compute_monthly_target, normalize_direction
from db import get_connection, counts
from fact_pipeline import list_plan_items, refresh_facts, resolve_plan_set
from formula_service import operands_to_json, validate_formula
from kpi_api import Handler
from seed_eval_2026_from_map import _equal_weights, build_items as build_2026_base_items

YEARS = list(range(2022, 2027))
FACT_START = (2022, 1)
FACT_END = (2026, 12)
FIXTURES = Path(__file__).resolve().parent / "fixtures"
SEED = 20260630


def _rng(*parts) -> random.Random:
    h = hashlib.md5("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return random.Random(int(h[:16], 16))


def _stable01(code: str, month: int, salt: str = "") -> float:
    h = hashlib.md5(f"{code}:{month}:{salt}".encode("utf-8")).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


# ── 평가배치 변형 ──────────────────────────────────────────────

def _definition_text(item: dict) -> str:
    label = item.get("label") or item.get("indicator_code")
    unit = item.get("unit") or ""
    lv1 = item.get("eval_category_lv1") or ""
    lv2 = item.get("eval_category_lv2") or ""
    lv3 = item.get("eval_category_lv3") or ""
    direction = item.get("goal_direction") or "increase"
    better = "낮을수록 유리" if direction == "decrease" else "높을수록 유리"
    return (
        f"[{lv1}>{lv2}>{lv3}] {label} 지표정의. "
        f"측정단위 {unit or '—'}, {better}. "
        f"평가배치 목표 대비 실적 진척을 모니터링하며, 특이 변동 시 원인 분석을 수행한다."
    )


def _calc_logic_text(item: dict) -> str:
    mode = item.get("achievement_mode") or "linear"
    direction = item.get("goal_direction") or "increase"
    if mode == "flat":
        base = "월간목표=연간목표(매월 동일). "
    elif mode == "custom":
        base = "월간목표는 custom_monthly_targets 곡선 사용. 달성률은 custom 식 또는 표준식. "
    else:
        base = "월간목표=기준실적+(연간-기준)×연초누적일수/연간일수. "
    if direction == "decrease":
        formula = "달성률=100+(목표-실적)/목표×100."
    else:
        formula = "달성률=100+(실적-목표)/목표×100."
    return base + formula


def _seasonal_custom_targets(annual: float, year: int, code: str) -> dict[str, float]:
    """상저하고/하저상고 등 월별 커브."""
    r = _rng(code, year, "curve")
    style = r.choice(["ramp", "h1_heavy", "h2_heavy", "u_shape", "bell"])
    months = list(range(1, 13))
    if style == "ramp":
        weights = [0.55 + 0.08 * m for m in months]
    elif style == "h1_heavy":
        weights = [1.25 if m <= 6 else 0.75 for m in months]
    elif style == "h2_heavy":
        weights = [0.7 if m <= 6 else 1.3 for m in months]
    elif style == "u_shape":
        weights = [1.3 if m in (1, 2, 11, 12) else 0.85 for m in months]
    else:
        weights = [0.7 + 0.1 * (6 - abs(m - 6.5)) for m in months]
    s = sum(weights)
    # flat/custom에서 목표=절대값. 비율 지표는 annual 근처, 누적형은 월별 진행값처럼.
    out = {}
    for m, w in zip(months, weights):
        # 커스텀은 '그 달의 목표 수준'으로 해석 — annual의 월가중 버전
        out[str(m)] = round(float(annual) * (w / (s / 12.0)), 4)
    return out


def _enrich_item(item: dict, year: int, month: int, idx: int) -> dict:
    out = deepcopy(item)
    scale = 1.0 + 0.028 * (year - 2022) + (0.01 if month >= 7 else 0.0)
    annual = float(out.get("annual_target") or 0) * scale
    # 연도별 소폭 노이즈
    noise = 1.0 + (_stable01(out["indicator_code"], year, "tgt") - 0.5) * 0.06
    annual = round(annual * noise, 2)
    out["annual_target"] = annual

    mode = out.get("achievement_mode") or "linear"
    u = _stable01(out["indicator_code"], year, f"mode{month}")
    # 모드 믹스: flat / linear / custom
    if out.get("unit") == "%" or mode == "flat":
        if u < 0.22:
            mode = "custom"
        else:
            mode = "flat"
    else:
        if u < 0.18:
            mode = "custom"
        elif u < 0.55:
            mode = "linear"
        else:
            mode = "flat" if u > 0.88 else "linear"
    out["achievement_mode"] = mode

    if mode == "linear":
        out["baseline_actual"] = round(annual * (0.68 + _stable01(out["indicator_code"], year, "base") * 0.12), 2)
    else:
        out["baseline_actual"] = 0.0

    if mode == "custom":
        out["custom_monthly_targets"] = _seasonal_custom_targets(annual, year, out["indicator_code"])
        # 일부는 커스텀 달성률 식
        if _stable01(out["indicator_code"], year, "expr") > 0.55:
            if out.get("goal_direction") == "decrease":
                out["custom_achievement_expr"] = "100 + (target - actual) / target * 100"
            else:
                out["custom_achievement_expr"] = "actual / target * 100"

    # 하반기 배치: 가중치 살짝 흔들기 위해 remark 표시
    out["definition_text"] = _definition_text(out)
    out["calc_logic_text"] = _calc_logic_text(out)
    out["data_source"] = "데모시드(Mock Corporate Fact)"
    out["collect_type"] = "자동취합"
    out["dept"] = out.get("dept") or {
        "SHB": "종합기획부",
        "SG1": "영업추진1부",
        "S22": "영업추진2부",
        "IAG": "기관제휴부",
        "CSG": "고객솔루션부",
        "WMG": "자산관리부",
        "CIG": "CIB기획부",
        "CMG": "자본시장부",
        "GLG": "글로벌기획부",
        "AXG": "디지털혁신부",
    }.get(out.get("group_code"), "담당부서")
    out["h1_target"] = round(annual * 0.48, 2)
    out["h2_target"] = round(annual * 0.52, 2)
    out["remark"] = (
        f"데모시드 {year}년 {month}월적용 · mode={mode} · "
        f"코드={out['indicator_code']}"
    )
    # Core 비율 확대
    label = out.get("label") or ""
    if any(k in label for k in ("세전이익", "ROC", "RORWA", "핵심예금", "주거래", "NPL", "연체", "NIM", "MAU", "활성고객")):
        out["is_core"] = "Y"
    elif _stable01(out["indicator_code"], year, "core") < 0.12:
        out["is_core"] = "Y"
    return out


def _rebalance_group_weights(items: list[dict]) -> list[dict]:
    by_g: dict[str, list[dict]] = defaultdict(list)
    for it in items:
        by_g[it["group_code"]].append(it)
    out = []
    for g, rows in by_g.items():
        rows = sorted(rows, key=lambda x: (x.get("sort_order") or 0, x["indicator_code"]))
        weights = _equal_weights(len(rows))
        for i, row in enumerate(rows):
            row = deepcopy(row)
            row["weight"] = round(float(weights[i]), 2)
            row["sort_order"] = i + 1
            out.append(row)
    return out


def mutate_plan_for_year(
    base_items: list[dict],
    all_codes: list[dict],
    year: int,
    effective_month: int,
) -> list[dict]:
    """연·월별로 지표 구성·목표·모드를 소폭 다르게."""
    base_codes = {it["indicator_code"] for it in base_items}
    pool = [c for c in all_codes if c["indicator_code"] not in base_codes]
    r = _rng("plan", year, effective_month)

    # 그룹별 베이스
    by_g: dict[str, list[dict]] = defaultdict(list)
    for it in base_items:
        by_g[it["group_code"]].append(deepcopy(it))

    pool_by_g: dict[str, list[dict]] = defaultdict(list)
    for c in pool:
        pool_by_g[c["group_code"]].append(c)

    items: list[dict] = []
    for g, rows in by_g.items():
        rows = sorted(rows, key=lambda x: x["indicator_code"])
        # 연도마다 1~3개 교체 (하반기는 추가 1개)
        n_swap = 1 + ((year + effective_month + len(g)) % 3)
        if effective_month >= 7:
            n_swap += 1
        n_swap = min(n_swap, max(0, len(rows) - 3), len(pool_by_g.get(g, [])))
        drop = set()
        if n_swap > 0 and rows:
            drop = {x["indicator_code"] for x in r.sample(rows, n_swap)}
        kept = [x for x in rows if x["indicator_code"] not in drop]
        add_src = pool_by_g.get(g, [])
        added = []
        if n_swap > 0 and add_src:
            for meta in r.sample(add_src, min(n_swap, len(add_src))):
                label = meta.get("display_name") or meta["indicator_code"]
                unit = (meta.get("unit") or "%").strip() or "%"
                mode = "flat" if unit == "%" else "linear"
                added.append({
                    "indicator_code": meta["indicator_code"],
                    "group_code": g,
                    "mgmt_tool": "KPI",
                    "eval_category_lv1": "연결과 확장" if g != "SHB" else "디지털",
                    "eval_category_lv2": "데모추가",
                    "eval_category_lv3": "확장지표",
                    "label": label,
                    "unit": unit,
                    "weight": 0,
                    "is_core": "N",
                    "annual_target": 100.0 if unit == "%" else 1_000_000_000.0,
                    "baseline_actual": 0.0,
                    "achievement_mode": mode,
                    "goal_direction": "decrease" if any(k in label for k in ("연체", "부실", "이탈", "비용")) else "increase",
                    "score_rule": "1",
                    "penalty_rule": "1",
                    "cap_max": 130,
                    "cap_min": 0,
                    "remark": f"{year}년 데모 추가지표",
                    "sort_order": 900,
                    "use_yn": "Y",
                })
        group_items = kept + added
        items.extend(group_items)

    # 가공식 출력 지표가 플랜에 반드시 들어가도록(뒤에서 채움)
    items = _rebalance_group_weights(items)
    enriched = [
        _enrich_item(it, year, effective_month, i)
        for i, it in enumerate(items)
    ]
    return _rebalance_group_weights(enriched)


def ensure_formula_outputs_in_plan(items: list[dict], formula_outputs: list[dict], year: int, month: int) -> list[dict]:
    have = {it["indicator_code"] for it in items}
    extra = []
    for fo in formula_outputs:
        code = fo["output_indicator_code"]
        if code in have:
            continue
        meta = fo.get("meta") or {}
        label = meta.get("display_name") or code
        unit = meta.get("unit") or "%"
        extra.append(_enrich_item({
            "indicator_code": code,
            "group_code": meta.get("group_code") or code.rsplit("-", 1)[-1],
            "mgmt_tool": "KPI",
            "eval_category_lv1": "연결과 확장",
            "eval_category_lv2": "가공지표",
            "eval_category_lv3": "파생",
            "label": f"{label} (가공)",
            "unit": unit,
            "weight": 0,
            "is_core": "Y",
            "annual_target": 100.0 if unit == "%" else abs(float(meta.get("hint_target") or 1000)),
            "baseline_actual": 0.0,
            "achievement_mode": "flat" if unit == "%" else "linear",
            "goal_direction": "increase",
            "score_rule": "1",
            "penalty_rule": "1",
            "cap_max": 130,
            "cap_min": 0,
            "remark": f"가공식 출력 · {fo.get('name')}",
            "sort_order": 950,
            "use_yn": "Y",
            "formula_id": fo.get("id"),
        }, year, month, 0))
    if not extra:
        return items
    return _rebalance_group_weights(items + extra)


# ── 가공식 ────────────────────────────────────────────────────

def seed_formulas(conn) -> list[dict]:
    """NEW-OUT→NET, OUT/TOT→이탈률, NEW/TOT→신규비중 등."""
    conn.execute("UPDATE eval_plan_item SET formula_id=NULL WHERE formula_id IS NOT NULL")
    conn.execute("UPDATE fact_calc SET formula_id=NULL WHERE formula_id IS NOT NULL")
    conn.execute("DELETE FROM fact_formula")
    conn.commit()
    specs = []

    # NET = NEW - OUT (여러 그룹)
    pairs = list(conn.execute(
        """
        SELECT n.indicator_code AS new_code, o.indicator_code AS out_code,
               net.indicator_code AS net_code, n.group_code, net.display_name, net.unit
        FROM indicator_code n
        JOIN indicator_code o
          ON n.common_code=o.common_code AND n.group_code=o.group_code
         AND n.perf_code='NEW' AND o.perf_code='OUT'
        JOIN indicator_code net
          ON n.common_code=net.common_code AND n.group_code=net.group_code
         AND net.perf_code='NET'
        ORDER BY n.group_code, n.indicator_code
        """
    ))
    for i, row in enumerate(pairs[:12]):  # 상위 12개
        specs.append({
            "name": f"순증자동_{row['group_code']}_{i+1}",
            "output": row["net_code"],
            "expr": "NEW - OUT",
            "operands": {"NEW": row["new_code"], "OUT": row["out_code"]},
            "meta": {
                "group_code": row["group_code"],
                "display_name": row["display_name"],
                "unit": row["unit"] or "명",
                "hint_target": 10000,
            },
        })

    # 이탈률 = OUT / TOT * 100 (RAT 코드가 있으면 그걸 출력으로, 없으면 skip)
    churn = list(conn.execute(
        """
        SELECT o.indicator_code AS out_code, t.indicator_code AS tot_code,
               r.indicator_code AS rat_code, o.group_code, r.display_name, r.unit
        FROM indicator_code o
        JOIN indicator_code t
          ON o.common_code=t.common_code AND o.group_code=t.group_code
         AND o.perf_code='OUT' AND t.perf_code='TOT'
        JOIN indicator_code r
          ON o.common_code=r.common_code AND o.group_code=r.group_code
         AND r.perf_code='RAT'
        WHERE r.display_name LIKE '%이탈%' OR r.display_name LIKE '%유지%'
           OR r.unit='%'
        ORDER BY o.group_code
        """
    ))
    for i, row in enumerate(churn[:8]):
        specs.append({
            "name": f"이탈비중가공_{row['group_code']}_{i+1}",
            "output": row["rat_code"],
            "expr": "OUT / TOT * 100",
            "operands": {"OUT": row["out_code"], "TOT": row["tot_code"]},
            "meta": {
                "group_code": row["group_code"],
                "display_name": row["display_name"],
                "unit": "%",
                "hint_target": 8.0,
            },
        })

    # 신규기여 = NEW / TOT * 100 — ETC 지표를 출력으로 쓰는 케이스
    contrib = list(conn.execute(
        """
        SELECT n.indicator_code AS new_code, t.indicator_code AS tot_code,
               e.indicator_code AS etc_code, n.group_code, e.display_name, e.unit
        FROM indicator_code n
        JOIN indicator_code t
          ON n.common_code=t.common_code AND n.group_code=t.group_code
         AND n.perf_code='NEW' AND t.perf_code='TOT'
        JOIN indicator_code e
          ON n.common_code=e.common_code AND n.group_code=e.group_code
         AND e.perf_code='ETC'
        ORDER BY n.group_code
        """
    ))
    for i, row in enumerate(contrib[:6]):
        specs.append({
            "name": f"신규기여가공_{row['group_code']}_{i+1}",
            "output": row["etc_code"],
            "expr": "NEW / TOT * 100",
            "operands": {"NEW": row["new_code"], "TOT": row["tot_code"]},
            "meta": {
                "group_code": row["group_code"],
                "display_name": row["display_name"],
                "unit": row["unit"] or "%",
                "hint_target": 15.0,
            },
        })

    created = []
    for spec in specs:
        try:
            validate_formula(
                conn,
                name=spec["name"],
                output=spec["output"],
                expr=spec["expr"],
                operands=spec["operands"],
            )
        except ValueError as e:
            print(f"  skip formula {spec['name']}: {e}")
            continue
        cur = conn.execute(
            """
            INSERT INTO fact_formula(name, output_indicator_code, expr, operands_json, use_yn)
            VALUES (?,?,?,?, 'Y')
            """,
            (spec["name"], spec["output"], spec["expr"], operands_to_json(spec["operands"])),
        )
        created.append({
            "id": cur.lastrowid,
            "name": spec["name"],
            "output_indicator_code": spec["output"],
            "operands": spec["operands"],
            "meta": spec["meta"],
        })
    conn.commit()
    print(f"formulas created: {len(created)}")
    return created


# ── 실적 생성 ────────────────────────────────────────────────

def _achievement_profile(code: str) -> str:
    u = _stable01(code, 0, "profile")
    if u < 0.12:
        return "chronic_weak"      # 만성 부진
    if u < 0.22:
        return "recovering"        # 회복 중
    if u < 0.38:
        return "strong"            # 상시 초과
    if u < 0.52:
        return "volatile"          # 들쭉날쭉
    if u < 0.65:
        return "seasonal"          # 계절성
    return "normal"


def _target_achievement(code: str, year: int, month: int) -> float:
    profile = _achievement_profile(code)
    u = _stable01(code, month, str(year))
    # 연도 트렌드: 최근일수록 소폭 개선
    year_boost = (year - 2022) * 1.1

    if profile == "chronic_weak":
        ach = 62 + u * 18 + year_boost * 0.3
    elif profile == "recovering":
        ach = 70 + month * 3.2 + u * 10 + year_boost * 0.5
    elif profile == "strong":
        ach = 104 + u * 16 + year_boost * 0.2
    elif profile == "volatile":
        ach = 90 + (u - 0.5) * 55 + year_boost * 0.4
    elif profile == "seasonal":
        seasonal = 12 * math.sin((month - 1) / 12 * 2 * math.pi)
        ach = 92 + seasonal + (u - 0.5) * 14 + year_boost * 0.3
    else:
        ach = 88 + month * 1.8 + (u - 0.5) * 28 + year_boost * 0.4

    # 가끔 극단치
    if u < 0.03:
        ach = 48 + u * 40
    if u > 0.97:
        ach = 120 + (u - 0.97) * 100

    return max(45.0, min(135.0, round(ach, 2)))


def _actual_from_target(target: float, ach: float, direction: str) -> float:
    if target is None or not math.isfinite(float(target)) or float(target) == 0:
        return round(ach * 10, 2)
    target = float(target)
    if direction == "decrease":
        ratio = 2.0 - (ach / 100.0)
        ratio = max(0.05, min(1.85, ratio))
        actual = target * ratio
    else:
        actual = target * (ach / 100.0)
    return round(actual * 100) / 100


def _synthetic_nonplan_actual(meta: dict, year: int, month: int) -> float:
    """평가배치에 없는 지표용 실적."""
    code = meta["indicator_code"]
    unit = (meta.get("unit") or "").strip()
    u = _stable01(code, month, f"np{year}")
    trend = 1.0 + 0.03 * (year - 2022) + 0.01 * month
    if unit == "%" or meta.get("perf_code") == "RAT":
        return round(55 + u * 50 * trend / 1.2, 2)
    if unit == "명":
        return round((8000 + u * 40000) * trend, 2)
    if unit == "건":
        return round((2000 + u * 25000) * trend, 2)
    # 원 단위
    return round((5e8 + u * 8e9) * trend, 2)


def build_fixture_items(
    plan_items: list[dict],
    all_codes: list[dict],
    formula_outputs: set[str],
    formula_specs: list[dict],
    year: int,
    month: int,
) -> list[dict]:
    plan_by_code = {it["indicator_code"]: it for it in plan_items}
    meta_by_code = {m["indicator_code"]: m for m in all_codes}
    actuals: dict[str, float] = {}

    for meta in all_codes:
        code = meta["indicator_code"]
        if code in formula_outputs:
            continue
        if code in plan_by_code:
            item = plan_by_code[code]
            target = compute_monthly_target(item, month, year)
            if target is None:
                continue
            ach = _target_achievement(code, year, month)
            direction = normalize_direction(item.get("goal_direction"))
            actuals[code] = _actual_from_target(float(target), ach, direction)
        else:
            actuals[code] = _synthetic_nonplan_actual(meta, year, month)

    # 가공식 피연산자(NEW/OUT/TOT)를 같은 스케일로 맞춰 DERIVED 결과가 목표와 맞도록
    for spec in formula_specs:
        ops = spec.get("operands") or {}
        name = spec.get("name") or ""
        if "NEW" in ops and "OUT" in ops and ("NET" in name or "순증" in name):
            new_c, out_c = ops["NEW"], ops["OUT"]
            meta = meta_by_code.get(new_c) or {}
            # 공통코드의 TOT가 있으면 그걸 모수로
            tot_c = None
            common = meta.get("common_code")
            group = meta.get("group_code")
            if common and group:
                for m in all_codes:
                    if m["common_code"] == common and m["group_code"] == group and m["perf_code"] == "TOT":
                        tot_c = m["indicator_code"]
                        break
            u = _stable01(new_c, month, f"fam{year}")
            base = 18000 + u * 42000 + (year - 2022) * 1200
            if tot_c:
                actuals[tot_c] = round(base * (1.05 + month * 0.01), 2)
            new_v = round(base * (0.06 + u * 0.08), 2)
            out_v = round(new_v * (0.25 + u * 0.45), 2)  # OUT < NEW → NET>0
            actuals[new_c] = new_v
            actuals[out_c] = out_v
        elif "NEW" in ops and "TOT" in ops:
            new_c, tot_c = ops["NEW"], ops["TOT"]
            u = _stable01(new_c, month, f"ratio{year}")
            tot_v = 25000 + u * 50000 + (year - 2022) * 1500
            new_v = tot_v * (0.08 + u * 0.12)
            actuals[tot_c] = round(tot_v, 2)
            actuals[new_c] = round(new_v, 2)
        elif "OUT" in ops and "TOT" in ops:
            out_c, tot_c = ops["OUT"], ops["TOT"]
            u = _stable01(out_c, month, f"churn{year}")
            tot_v = 25000 + u * 50000
            out_v = tot_v * (0.03 + u * 0.07)
            actuals[tot_c] = round(tot_v, 2)
            actuals[out_c] = round(out_v, 2)

    return [{"indicator_code": k, "actual": v} for k, v in actuals.items()]


def align_formula_plan_targets(conn, formula_rows: list[dict]):
    """가공식 출력 지표의 연간/월간목표를 DERIVED 스케일에 맞게 보정."""
    for fo in formula_rows:
        code = fo["output_indicator_code"]
        meta = fo.get("meta") or {}
        unit = meta.get("unit") or "%"
        name = fo.get("name") or ""
        if "순증" in name or code.split("-")[3:4] == ["NET"]:
            annual = float(meta.get("hint_target") or 8000)
            unit = meta.get("unit") or "명"
        elif unit == "%" or "기여" in name or "이탈" in name:
            annual = float(meta.get("hint_target") or 12.0)
            unit = "%"
        else:
            annual = float(meta.get("hint_target") or 1000)
        monthly = {str(m): round(annual * (0.85 + 0.02 * m), 4) for m in range(1, 13)}
        conn.execute(
            """
            UPDATE eval_plan_item
            SET annual_target=?,
                monthly_target=?,
                baseline_actual=CASE WHEN achievement_mode='linear' THEN ?*0.75 ELSE 0 END,
                custom_monthly_targets_json=?,
                unit=?,
                updated_at=CURRENT_TIMESTAMP
            WHERE indicator_code=?
            """,
            (
                annual,
                monthly.get("1", annual),
                annual,
                json.dumps(monthly, ensure_ascii=False),
                unit,
                code,
            ),
        )
    conn.commit()


def iter_months(start: tuple[int, int], end: tuple[int, int]):
    y, m = start
    while (y, m) <= end:
        yield y, m
        m += 1
        if m > 12:
            m = 1
            y += 1


def clear_facts_outside_range(conn):
    """시드 범위 밖 실적 정리 + 범위 내 재생성 대비."""
    conn.execute("DELETE FROM achievement_result")
    conn.execute("DELETE FROM fact_calc")
    conn.execute("DELETE FROM fact_collect")
    conn.execute("DELETE FROM custom_achievement")
    conn.execute("DELETE FROM sync_batch")
    conn.commit()


def clear_eval_plans(conn):
    conn.execute("DELETE FROM eval_plan_item")
    conn.execute("DELETE FROM eval_plan_set")
    conn.commit()


def save_plan(year: int, month: int, items: list[dict], reason: str):
    handler = Handler.__new__(Handler)
    return handler._replace_eval_configs(year, month, items, reason)


# ── main ─────────────────────────────────────────────────────

def main():
    FIXTURES.mkdir(parents=True, exist_ok=True)
    with get_connection() as conn:
        c = counts(conn)
        if c.get("indicator_code", 0) < 50:
            raise SystemExit("indicator_code 마스터가 비어 있습니다. import_code_master.py 먼저 실행하세요.")
        print("before:", c)

        all_codes = [dict(r) for r in conn.execute(
            "SELECT indicator_code, group_code, display_name, unit, perf_code, common_code FROM indicator_code"
        )]

    print("=== formulas ===")
    with get_connection() as conn:
        formula_rows = seed_formulas(conn)
        formula_outputs = {f["output_indicator_code"] for f in formula_rows}

    print("=== eval plans ===")
    base_items, skipped, group_counts = build_2026_base_items()
    print(f"base map items={len(base_items)} groups={group_counts} skipped={len(skipped)}")

    clear_eval_plans_conn = get_connection()
    try:
        clear_eval_plans(clear_eval_plans_conn)
    finally:
        clear_eval_plans_conn.close()

    for year in YEARS:
        for eff_month in ([1, 7] if year >= 2023 else [1]):
            items = mutate_plan_for_year(base_items, all_codes, year, eff_month)
            items = ensure_formula_outputs_in_plan(items, formula_rows, year, eff_month)
            reason = f"데모시드 {year}년 {eff_month}월 적용배치 (목표·모드·구성 변형)"
            result = save_plan(year, eff_month, items, reason)
            print(
                f"  plan {year}-{eff_month:02d}: items={len(result.get('items') or items)} "
                f"id={result.get('plan_set_id')}"
            )

    with get_connection() as conn:
        align_formula_plan_targets(conn, formula_rows)

    print("=== facts fixtures + refresh ===")
    with get_connection() as conn:
        clear_facts_outside_range(conn)

    summaries = []
    for year, month in iter_months(FACT_START, FACT_END):
        with get_connection() as conn:
            plan = resolve_plan_set(conn, year, month)
            if not plan:
                print(f"  SKIP {year}-{month:02d}: no plan")
                continue
            plan_items = list_plan_items(conn, plan["id"])

        rows = build_fixture_items(plan_items, all_codes, formula_outputs, formula_rows, year, month)
        path = FIXTURES / f"corporate_facts_{year}{month:02d}.json"
        path.write_text(json.dumps({"items": rows}, ensure_ascii=False), encoding="utf-8")

        with get_connection() as conn:
            result = refresh_facts(conn, year, month)
            conn.commit()
        summaries.append((year, month, result))
        print(
            f"  {year}-{month:02d}: collect={result.get('collect')} "
            f"direct={result.get('calc_direct')} derived={result.get('calc_derived')} "
            f"ach={result.get('achievement')} err={len(result.get('errors') or [])}"
        )

    print("=== distribution sample ===")
    with get_connection() as conn:
        print("counts after:", counts(conn))
        print("plan years:", [dict(r) for r in conn.execute(
            """SELECT year, effective_from_month, COUNT(i.id) n
               FROM eval_plan_set s LEFT JOIN eval_plan_item i ON i.plan_set_id=s.id
               GROUP BY s.id ORDER BY year, effective_from_month"""
        )])
        print("ach months:", [dict(r) for r in conn.execute(
            """SELECT eval_ym, COUNT(*) n,
                      ROUND(AVG(converted_achievement),1) avg_ach,
                      SUM(CASE WHEN converted_achievement < 70 THEN 1 ELSE 0 END) weak,
                      SUM(CASE WHEN converted_achievement >= 100 THEN 1 ELSE 0 END) over100
               FROM achievement_result
               WHERE converted_achievement IS NOT NULL
               GROUP BY eval_ym ORDER BY eval_ym"""
        )][-8:])
        print("formulas:", [dict(r) for r in conn.execute(
            "SELECT id, name, output_indicator_code FROM fact_formula ORDER BY id"
        )])
        print("modes mix 2026-06:", [dict(r) for r in conn.execute(
            """SELECT achievement_mode, COUNT(*) n
               FROM achievement_result WHERE eval_ym='202606'
               GROUP BY achievement_mode"""
        )])
        print("derived calc sample:", [dict(r) for r in conn.execute(
            """SELECT eval_ym, group_code, indicator_code, actual, calc_kind
               FROM fact_calc WHERE calc_kind='DERIVED' ORDER BY eval_ym DESC LIMIT 8"""
        )])
        # non-plan collect exists
        print("non-plan collect 202606:", conn.execute(
            """SELECT COUNT(*) c FROM fact_collect fc
               WHERE eval_ym='202606' AND NOT EXISTS (
                 SELECT 1 FROM achievement_result ar
                 WHERE ar.eval_ym=fc.eval_ym AND ar.indicator_code=fc.indicator_code
               )"""
        ).fetchone()["c"])


if __name__ == "__main__":
    main()
