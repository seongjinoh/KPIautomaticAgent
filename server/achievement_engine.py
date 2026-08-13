# -*- coding: utf-8 -*-
"""달성률·월목표 산정 엔진 (프론트 achievementEngine.js 와 동일 규칙)."""
from __future__ import annotations

import calendar
import json
import math
import re
from datetime import date
from typing import Any


ACHIEVEMENT_MODES = ("linear", "flat", "custom")
GOAL_DIRECTIONS = ("increase", "decrease")


def round_value(value: float | None, digits: int = 2) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    unit = 10 ** digits
    return round(value * unit) / unit


def _parse_percent_like(value: Any, fallback: float) -> float:
    if value is None or value == "":
        return fallback
    try:
        parsed = float(str(value).replace("%", "").replace(",", "").strip())
        return parsed if math.isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


def apply_achievement_policy(def_row: dict, raw_achievement: float | None) -> float | None:
    """상·하한, 승수, 조정구간을 프론트와 동일하게 적용한다."""
    if raw_achievement is None:
        return None
    try:
        raw = float(raw_achievement)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(raw):
        return None

    lower = _parse_percent_like(def_row.get("cap_min"), 40.0)
    upper = _parse_percent_like(def_row.get("cap_max"), 150.0)
    multiplier = _parse_percent_like(def_row.get("score_rule"), 1.0)
    band = _parse_percent_like(def_row.get("adj_band"), 120.0)
    adjust = _parse_percent_like(def_row.get("penalty_rule"), 0.1)

    converted = 100.0 + ((raw - 100.0) * multiplier)
    converted = max(converted, lower)
    if converted >= band:
        converted = band + ((converted - band) * adjust)
    converted = min(max(converted, lower), upper)
    return round_value(converted, 2)


def is_leap_year(year: int) -> bool:
    return calendar.isleap(int(year))


def days_in_year(year: int) -> int:
    return 366 if is_leap_year(year) else 365


def days_to_month_end(year: int, month: int) -> int:
    y, m = int(year), int(month)
    if m < 1 or m > 12:
        raise ValueError("month must be 1..12")
    end = date(y, m, calendar.monthrange(y, m)[1])
    start = date(y, 1, 1)
    return (end - start).days + 1


def days_in_month(year: int, month: int) -> int:
    y, m = int(year), int(month)
    if m < 1 or m > 12:
        raise ValueError("month must be 1..12")
    return calendar.monthrange(y, m)[1]


def days_from_period_start(year: int, month: int, start_month: int = 1) -> int | None:
    y, m, start = int(year), int(month), int(start_month or 1)
    if m < start or m > 12:
        return None
    return sum(days_in_month(y, mo) for mo in range(start, m + 1))


def days_in_eval_period(year: int, start_month: int = 1, end_month: int = 12) -> int | None:
    y, start, end = int(year), int(start_month or 1), int(end_month or 12)
    if start < 1 or start > 12 or end < 1 or end > 12 or start > end:
        return None
    return sum(days_in_month(y, mo) for mo in range(start, end + 1))


def normalize_eval_period(def_row: dict) -> tuple[int, int]:
    start = int(def_row.get("target_start_month") or def_row.get("targetStartMonth") or 1)
    end = int(def_row.get("target_end_month") or def_row.get("targetEndMonth") or 12)
    if start < 1 or start > 12:
        start = 1
    if end < 1 or end > 12:
        end = 12
    if start > end:
        start, end = end, start
    return start, end


def normalize_mode(mode: str | None) -> str:
    m = str(mode or "linear").strip().lower()
    if m in ("flat", "custom"):
        return m
    return "linear"


def normalize_direction(direction: str | None, lower_is_better: bool = False) -> str:
    d = str(direction or "").strip().lower()
    if d == "decrease" or lower_is_better:
        return "decrease"
    return "increase"


def _parse_custom_monthly(raw: Any) -> dict[str, float]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        out = {}
        for k, v in raw.items():
            try:
                out[str(int(k))] = float(v)
            except Exception:
                continue
        return out
    if isinstance(raw, str) and raw.strip():
        try:
            return _parse_custom_monthly(json.loads(raw))
        except Exception:
            return {}
    return {}


def compute_monthly_target(def_row: dict, month: int, year: int | None = None) -> float | None:
    m = int(month)
    if m < 1 or m > 12:
        return None
    start, end = normalize_eval_period(def_row)
    if m < start or m > end:
        return None
    mode = normalize_mode(def_row.get("achievement_mode") or def_row.get("achievementMode"))
    annual = float(def_row.get("annual_target") if def_row.get("annual_target") is not None else def_row.get("annualTarget") or 0)
    baseline = float(def_row.get("baseline_actual") if def_row.get("baseline_actual") is not None else def_row.get("baselineActual") or 0)
    digits = 2 if abs(annual) < 10 else 1

    # DB에 저장된 월간목표가 있으면 그걸 우선 사용
    custom = _parse_custom_monthly(
        def_row.get("custom_monthly_targets_json")
        or def_row.get("customMonthlyTargets")
        or def_row.get("monthlyTargets")
    )
    if str(m) in custom:
        return round_value(custom[str(m)], digits)

    if mode == "flat":
        return round_value(annual, digits)

    if mode == "custom":
        return round_value(annual, digits)

    # Linear: baseline + (annual - baseline) / 평가기간일수 * 경과일수
    y = int(year if year is not None else def_row.get("year") or date.today().year)
    elapsed = days_from_period_start(y, m, start)
    period_days = days_in_eval_period(y, start, end)
    if elapsed is None or not period_days:
        return None
    return round_value(baseline + (annual - baseline) * elapsed / period_days, digits)


def build_monthly_targets_map(def_row: dict, year: int) -> dict[str, float]:
    """연간목표·산식 기준으로 1~12월 월간목표 맵을 생성한다."""
    out: dict[str, float] = {}
    # 생성 시 기존 custom 값을 무시하고 재산정하기 위해 복사본 사용
    base = {
        **def_row,
        "custom_monthly_targets_json": None,
        "customMonthlyTargets": None,
        "monthlyTargets": None,
    }
    for m in range(1, 13):
        v = compute_monthly_target(base, m, year)
        out[str(m)] = float(v if v is not None else 0)
    return out


def evaluate_expression(expr: str, vars_map: dict[str, float]) -> float | None:
    raw = str(expr or "").strip()
    if not raw:
        return None
    if not re.fullmatch(r"[0-9+\-*/().%,\s_a-zA-Z]+", raw):
        return None
    safe = {k: float(v) for k, v in vars_map.items() if isinstance(v, (int, float)) or str(v).replace(".", "", 1).lstrip("-").isdigit()}
    for i in range(1, 31):
        key = f"filter{i}"
        if key not in safe:
            safe[key] = 0.0
    for key in ("actual", "target", "month", "annualTarget", "baseline", "yearProgress"):
        if key not in safe:
            safe[key] = 0.0
    try:
        # Restrict names available to expression
        allowed = {
            **{k: safe[k] for k in safe},
            "min": min,
            "max": max,
            "abs": abs,
            "round": lambda v, d=2: round_value(float(v), int(d)),
        }
        result = eval(raw, {"__builtins__": {}}, allowed)  # noqa: S307 — controlled vars only
        return round_value(float(result), 2) if result is not None and math.isfinite(float(result)) else None
    except Exception:
        return None


def calculate_achievement_rate(
    def_row: dict,
    actual: float | None,
    month: int,
    year: int | None = None,
    filter_values: dict[str, float] | None = None,
) -> float | None:
    if actual is None:
        return None
    try:
        actual_num = float(actual)
    except Exception:
        return None
    if not math.isfinite(actual_num):
        return None

    target = compute_monthly_target(def_row, month, year)
    if target is None:
        return None
    if target == 0:
        return 100.0 if actual_num == 0 else None

    mode = normalize_mode(def_row.get("achievement_mode") or def_row.get("achievementMode"))
    direction = normalize_direction(
        def_row.get("goal_direction") or def_row.get("goalDirection"),
        bool(def_row.get("lowerIsBetter") or def_row.get("lower_is_better")),
    )
    y = int(year if year is not None else def_row.get("year") or date.today().year)

    if mode == "custom":
        expr = str(def_row.get("custom_achievement_expr") or def_row.get("customAchievementExpr") or "").strip()
        if expr:
            vars_map = {
                "actual": actual_num,
                "target": float(target),
                "month": float(month),
                "annualTarget": float(def_row.get("annual_target") or def_row.get("annualTarget") or 0),
                "baseline": float(def_row.get("baseline_actual") or def_row.get("baselineActual") or 0),
                "yearProgress": float(month) / 12.0,
            }
            if filter_values:
                vars_map.update(filter_values)
            return evaluate_expression(expr, vars_map)

    if direction == "decrease":
        return round_value(100 + ((target - actual_num) / target) * 100, 2)
    return round_value(100 + ((actual_num - target) / target) * 100, 2)


def evaluate_formula_expr(expr: str, operands: dict[str, float]) -> float | None:
    """가공식: operands(영문/한글 식별자)와 사칙연산."""
    raw = str(expr or "").strip()
    if not raw:
        return None
    if not re.fullmatch(r"[\w+\-*/().%\s]+", raw, re.UNICODE):
        return None
    safe = {
        str(k): float(v)
        for k, v in (operands or {}).items()
        if v is not None and math.isfinite(float(v))
    }
    try:
        result = eval(raw, {"__builtins__": {}}, {**safe, "min": min, "max": max, "abs": abs})  # noqa: S307
        return float(result) if result is not None and math.isfinite(float(result)) else None
    except Exception:
        return None
