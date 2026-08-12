# -*- coding: utf-8 -*-
"""단위에서 만/억/조(및 천원)를 제거하고 저장값을 기본단위(원 등)로 환산."""
from __future__ import annotations

import json
from db import get_connection, init_schema


def normalize_unit(unit: str, label: str = "") -> tuple[str, float]:
    """(새 단위, 곱할 스케일)."""
    u = (unit or "").strip()
    text = label or ""
    ratio_like = any(k in text for k in ("률", "율", "비중", "ROC", "RORWA", "NIM", "점수"))
    if u in ("억원", "천원", "만원", "조원") and ratio_like:
        return "%", 1.0
    if u == "억원":
        return "원", 100_000_000.0
    if u == "천원":
        return "원", 1_000.0
    if u == "만원":
        return "원", 10_000.0
    if u == "조원":
        return "원", 1_000_000_000_000.0
    if any(k in u for k in ("억", "만", "조", "천원")):
        if ratio_like:
            return "%", 1.0
        parts = [p for p in u.replace("억원", "").replace("만원", "").replace("조원", "")
                 .replace("천원", "").replace("억", "").replace("만", "").replace("조", "")
                 .split("/") if p.strip()]
        return (parts[0] if parts else "건"), 1.0
    if u == "명/개":
        return "명", 1.0
    return u, 1.0


def _scale_num(v, scale: float):
    if v is None or scale == 1.0:
        return v
    try:
        return round(float(v) * scale, 2)
    except (TypeError, ValueError):
        return v


def _scale_monthly_json(raw, scale: float):
    if not raw or scale == 1.0:
        return raw
    try:
        data = json.loads(raw) if isinstance(raw, str) else dict(raw)
    except Exception:
        return raw
    out = {}
    for k, v in data.items():
        out[str(k)] = _scale_num(v, scale)
    return json.dumps(out, ensure_ascii=False)


def migrate_stale_achievement_units(conn) -> int:
    """eval_plan 정규화 이후에도 남아 있는 achievement_result 구단위 행을 보정."""
    scales = {"억원": 1e8, "만원": 1e4, "천원": 1e3, "조원": 1e12}
    total = 0
    for unit, scale in scales.items():
        cur = conn.execute(
            """
            UPDATE achievement_result
            SET
              unit = '원',
              annual_target = CASE WHEN annual_target IS NOT NULL THEN ROUND(annual_target * ?, 2) ELSE NULL END,
              monthly_target = CASE WHEN monthly_target IS NOT NULL THEN ROUND(monthly_target * ?, 2) ELSE NULL END,
              actual = CASE WHEN actual IS NOT NULL THEN ROUND(actual * ?, 2) ELSE NULL END
            WHERE unit = ?
            """,
            (scale, scale, scale, unit),
        )
        total += cur.rowcount
    return total


def migrate(conn) -> dict:
    stats = {"items": 0, "codes": 0, "facts_collect": 0, "facts_calc": 0, "achievements": 0, "stale_achievements": 0}
    code_scale: dict[str, float] = {}

    rows = conn.execute(
        "SELECT id, indicator_code, label, unit, annual_target, monthly_target, baseline_actual, "
        "h1_target, h2_target, custom_monthly_targets_json FROM eval_plan_item"
    ).fetchall()
    for row in rows:
        new_unit, scale = normalize_unit(row["unit"], row["label"] or "")
        if new_unit == (row["unit"] or "") and scale == 1.0:
            continue
        code_scale[row["indicator_code"]] = scale
        conn.execute(
            """
            UPDATE eval_plan_item SET
              unit = ?,
              annual_target = ?,
              monthly_target = ?,
              baseline_actual = ?,
              h1_target = ?,
              h2_target = ?,
              custom_monthly_targets_json = ?
            WHERE id = ?
            """,
            (
                new_unit,
                _scale_num(row["annual_target"], scale),
                _scale_num(row["monthly_target"], scale),
                _scale_num(row["baseline_actual"], scale),
                _scale_num(row["h1_target"], scale),
                _scale_num(row["h2_target"], scale),
                _scale_monthly_json(row["custom_monthly_targets_json"], scale),
                row["id"],
            ),
        )
        stats["items"] += 1

    for row in conn.execute("SELECT indicator_code, unit, display_name FROM indicator_code").fetchall():
        new_unit, scale = normalize_unit(row["unit"], row["display_name"] or "")
        if new_unit == (row["unit"] or ""):
            continue
        if row["indicator_code"] not in code_scale:
            code_scale[row["indicator_code"]] = scale
        conn.execute(
            "UPDATE indicator_code SET unit = ? WHERE indicator_code = ?",
            (new_unit, row["indicator_code"]),
        )
        stats["codes"] += 1

    for code, scale in code_scale.items():
        if scale == 1.0:
            continue
        for table, col in (("fact_collect", "actual"), ("fact_calc", "actual")):
            cur = conn.execute(
                f"UPDATE {table} SET {col} = ROUND({col} * ?, 2) WHERE indicator_code = ? AND {col} IS NOT NULL",
                (scale, code),
            )
            stats["facts_collect" if table == "fact_collect" else "facts_calc"] += cur.rowcount
        # achievement_result: 과거 스크립트가 target 컬럼을 기대해 누락됨 → annual/monthly/actual/unit 보정
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(achievement_result)").fetchall()}
        if "monthly_target" in cols and "annual_target" in cols:
            cur = conn.execute(
                """
                UPDATE achievement_result
                SET
                  unit = '원',
                  annual_target = CASE WHEN annual_target IS NOT NULL THEN ROUND(annual_target * ?, 2) ELSE NULL END,
                  monthly_target = CASE WHEN monthly_target IS NOT NULL THEN ROUND(monthly_target * ?, 2) ELSE NULL END,
                  actual = CASE WHEN actual IS NOT NULL THEN ROUND(actual * ?, 2) ELSE NULL END
                WHERE indicator_code = ?
                  AND unit IN ('억원', '만원', '천원', '조원')
                """,
                (scale, scale, scale, code),
            )
            stats["achievements"] += cur.rowcount
        elif {"target", "actual"} <= cols:
            cur = conn.execute(
                "UPDATE achievement_result SET target = ROUND(target * ?, 2), actual = ROUND(actual * ?, 2) "
                "WHERE indicator_code = ?",
                (scale, scale, code),
            )
            stats["achievements"] += cur.rowcount

    stats["stale_achievements"] = migrate_stale_achievement_units(conn)
    conn.commit()
    return stats


def main():
    init_schema()
    with get_connection() as conn:
        stats = migrate(conn)
        units = conn.execute(
            "SELECT unit, COUNT(*) n FROM eval_plan_item GROUP BY unit ORDER BY n DESC"
        ).fetchall()
    print("migrated", stats)
    print("units", [(r["unit"], r["n"]) for r in units])


if __name__ == "__main__":
    main()
