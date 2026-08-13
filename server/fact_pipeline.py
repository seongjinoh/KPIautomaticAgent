# -*- coding: utf-8 -*-
"""실적 취합 → 산출 → Custom → 달성률산정 파이프라인."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from achievement_engine import (
    apply_achievement_policy,
    calculate_achievement_rate,
    compute_monthly_target,
    evaluate_formula_expr,
    normalize_mode,
)
from corporate_fact_client import get_corporate_client

INDICATOR_CODE_RE = re.compile(r"^[A-Z0-9]{2,4}-[A-Z0-9]{3,4}-\d{3,4}-[A-Z]{3}-[A-Z0-9]{2,4}$", re.I)


def eval_ym(year: int, month: int) -> str:
    return f"{int(year)}{int(month):02d}"


def parse_ym(ym: str) -> tuple[int, int]:
    s = str(ym).strip()
    if len(s) == 6 and s.isdigit():
        return int(s[:4]), int(s[4:6])
    raise ValueError(f"invalid eval_ym: {ym}")


def resolve_plan_set(conn, year: int, month: int):
    row = conn.execute(
        """
        SELECT * FROM eval_plan_set
        WHERE year=? AND effective_from_month <= ?
        ORDER BY effective_from_month DESC
        LIMIT 1
        """,
        (year, month),
    ).fetchone()
    return dict(row) if row else None


def list_plan_items(conn, plan_set_id: int) -> list[dict]:
    rows = conn.execute(
        """
        SELECT e.*, og.name AS group_name
        FROM eval_plan_item e
        LEFT JOIN owner_group og ON og.code = e.group_code
        WHERE e.plan_set_id=? AND e.use_yn='Y'
        ORDER BY e.sort_order, e.id
        """,
        (plan_set_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _parse_filters(raw: Any) -> dict[str, str]:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items() if v is not None and str(v).strip() != ""}
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items() if v is not None and str(v).strip() != ""}
    except Exception:
        pass
    return {}


def _resolve_filter_values(conn, eval_ym_str: str, group_code: str, filters: dict[str, str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for i in range(1, 31):
        key = str(i)
        raw = filters.get(key) or filters.get(f"filter{i}") or filters.get(f"Filter{i}") or ""
        raw = str(raw).strip()
        var_name = f"filter{i}"
        if not raw:
            out[var_name] = 0.0
            continue
        if INDICATOR_CODE_RE.match(raw):
            row = conn.execute(
                "SELECT actual FROM fact_calc WHERE eval_ym=? AND group_code=? AND indicator_code=?",
                (eval_ym_str, group_code, raw.upper()),
            ).fetchone()
            out[var_name] = float(row["actual"]) if row and row["actual"] is not None else 0.0
        else:
            try:
                out[var_name] = float(raw)
            except Exception:
                out[var_name] = 0.0
    return out


def _topo_formulas(formulas: list[dict]) -> list[dict]:
    """operands의 indicator 의존을 느슨히 정렬 (output이 다른 formula operand면 뒤로)."""
    outputs = {f["output_indicator_code"]: f for f in formulas}
    remaining = list(formulas)
    ordered = []
    guard = 0
    while remaining and guard < 1000:
        guard += 1
        progressed = False
        for f in list(remaining):
            try:
                ops = json.loads(f.get("operands_json") or "{}")
            except Exception:
                ops = {}
            deps = [str(v).upper() for v in ops.values() if INDICATOR_CODE_RE.match(str(v))]
            if any(d in outputs and outputs[d]["id"] != f["id"] and outputs[d] in remaining for d in deps):
                continue
            ordered.append(f)
            remaining.remove(f)
            progressed = True
        if not progressed:
            ordered.extend(remaining)
            break
    return ordered


def refresh_facts(conn, year: int, month: int, *, skip_collect: bool = False) -> dict[str, Any]:
    """실적 동기화. skip_collect=True 이면 기존 fact_collect를 유지한 채 산출·달성만 재계산."""
    ym = eval_ym(year, month)
    client = get_corporate_client()
    mode = type(client).__name__.replace("CorporateFactClient", "").lower() or "mock"
    if "mock" in mode:
        mode = "mock"
    elif "http" in mode:
        mode = "http"
    if skip_collect:
        mode = "upload_recompute"

    cur = conn.execute(
        "INSERT INTO sync_batch(mode, eval_ym, status) VALUES (?,?,?)",
        (mode, ym, "running"),
    )
    batch_id = cur.lastrowid
    counts = {"collect": 0, "calc_direct": 0, "calc_derived": 0, "custom": 0, "achievement": 0, "errors": []}

    try:
        # 1) collect (엑셀 업로드 반영 후 재계산 시에는 건너뜀)
        if not skip_collect:
            rows = client.fetch_collect_rows(ym)
            for row in rows:
                code = str(row["indicator_code"]).upper()
                exists = conn.execute(
                    "SELECT 1 FROM indicator_code WHERE indicator_code=?", (code,)
                ).fetchone()
                if not exists:
                    counts["errors"].append(f"unknown indicator_code: {code}")
                    continue
                conn.execute(
                    """
                    INSERT INTO fact_collect(eval_ym, indicator_code, actual, batch_id, fetched_at)
                    VALUES (?,?,?,?,?)
                    ON CONFLICT(eval_ym, indicator_code) DO UPDATE SET
                      actual=excluded.actual, batch_id=excluded.batch_id, fetched_at=excluded.fetched_at
                    """,
                    (ym, code, float(row["actual"]), batch_id, datetime.now(timezone.utc).isoformat()),
                )
                counts["collect"] += 1
        else:
            n = conn.execute(
                "SELECT COUNT(*) AS n FROM fact_collect WHERE eval_ym=?", (ym,)
            ).fetchone()
            counts["collect"] = int(n["n"] if n else 0)

        plan = resolve_plan_set(conn, year, month)
        items = list_plan_items(conn, plan["id"]) if plan else []

        # clear prior calc/custom/achievement for ym (recompute)
        conn.execute("DELETE FROM fact_calc WHERE eval_ym=?", (ym,))
        conn.execute("DELETE FROM custom_achievement WHERE eval_ym=?", (ym,))
        conn.execute("DELETE FROM achievement_result WHERE eval_ym=?", (ym,))

        # 2) DIRECT calc for plan items
        for item in items:
            code = item["indicator_code"]
            group = item["group_code"]
            crow = conn.execute(
                "SELECT actual FROM fact_collect WHERE eval_ym=? AND indicator_code=?",
                (ym, code),
            ).fetchone()
            if crow is None:
                continue
            conn.execute(
                """
                INSERT INTO fact_calc(eval_ym, group_code, indicator_code, actual, calc_kind, formula_id, batch_id)
                VALUES (?,?,?,?,?,?,?)
                """,
                (ym, group, code, crow["actual"], "DIRECT", item.get("formula_id"), batch_id),
            )
            counts["calc_direct"] += 1

        # Also map collect rows whose indicator belongs to a group even if not in plan? Plan says plan-scoped only.

        # 3) DERIVED formulas
        formulas = [dict(r) for r in conn.execute(
            "SELECT * FROM fact_formula WHERE use_yn='Y' ORDER BY id"
        ).fetchall()]
        for f in _topo_formulas(formulas):
            try:
                ops_map = json.loads(f.get("operands_json") or "{}")
            except Exception:
                ops_map = {}
            # Determine group: from output indicator
            out_code = f["output_indicator_code"]
            out_row = conn.execute(
                "SELECT group_code FROM indicator_code WHERE indicator_code=?", (out_code,)
            ).fetchone()
            if not out_row:
                counts["errors"].append(f"formula output missing: {out_code}")
                continue
            group = out_row["group_code"]
            # Only compute if output is in plan for that group, or always write calc
            operand_vals = {}
            missing = False
            for key, ref in ops_map.items():
                ref_s = str(ref).strip()
                if INDICATOR_CODE_RE.match(ref_s):
                    r = conn.execute(
                        "SELECT actual FROM fact_calc WHERE eval_ym=? AND group_code=? AND indicator_code=?",
                        (ym, group, ref_s.upper()),
                    ).fetchone()
                    if r is None:
                        r = conn.execute(
                            "SELECT actual FROM fact_collect WHERE eval_ym=? AND indicator_code=?",
                            (ym, ref_s.upper()),
                        ).fetchone()
                    if r is None or r["actual"] is None:
                        missing = True
                        break
                    operand_vals[key] = float(r["actual"])
                else:
                    try:
                        operand_vals[key] = float(ref_s)
                    except Exception:
                        missing = True
                        break
            if missing:
                continue
            actual = evaluate_formula_expr(f.get("expr") or "", operand_vals)
            if actual is None:
                counts["errors"].append(f"formula eval failed: {f.get('name')}")
                continue
            conn.execute(
                """
                INSERT INTO fact_calc(eval_ym, group_code, indicator_code, actual, calc_kind, formula_id, batch_id)
                VALUES (?,?,?,?,?,?,?)
                ON CONFLICT(eval_ym, group_code, indicator_code) DO UPDATE SET
                  actual=excluded.actual, calc_kind=excluded.calc_kind, formula_id=excluded.formula_id, batch_id=excluded.batch_id
                """,
                (ym, group, out_code, actual, "DERIVED", f["id"], batch_id),
            )
            counts["calc_derived"] += 1

        # 4) custom + 5) achievement_result
        for item in items:
            code = item["indicator_code"]
            group = item["group_code"]
            calc = conn.execute(
                "SELECT actual FROM fact_calc WHERE eval_ym=? AND group_code=? AND indicator_code=?",
                (ym, group, code),
            ).fetchone()
            actual = float(calc["actual"]) if calc and calc["actual"] is not None else None
            monthly_target = compute_monthly_target(item, month, year)
            mode = normalize_mode(item.get("achievement_mode"))
            filters = _parse_filters(item.get("filters_json"))
            filter_vals = _resolve_filter_values(conn, ym, group, filters) if mode == "custom" else {}

            simple = calculate_achievement_rate(item, actual, month, year, None)
            raw_converted = simple
            if mode == "custom":
                raw_converted = calculate_achievement_rate(item, actual, month, year, filter_vals)
            converted = apply_achievement_policy(item, raw_converted)
            if mode == "custom":
                conn.execute(
                    """
                    INSERT INTO custom_achievement(eval_ym, group_code, indicator_code, actual, monthly_target, achievement, batch_id)
                    VALUES (?,?,?,?,?,?,?)
                    """,
                    (ym, group, code, actual, monthly_target, converted, batch_id),
                )
                counts["custom"] += 1

            conn.execute(
                """
                INSERT INTO achievement_result(
                  eval_ym, group_code, indicator_code, actual, annual_target, monthly_target,
                  simple_achievement, converted_achievement, achievement_mode, goal_direction,
                  weight, label, unit, eval_category_lv1, eval_category_lv2, eval_category_lv3,
                  mgmt_tool, batch_id
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    ym, group, code, actual,
                    item.get("annual_target"), monthly_target,
                    simple, converted, mode, item.get("goal_direction") or "increase",
                    item.get("weight") or 0, item.get("label") or "", item.get("unit") or "",
                    item.get("eval_category_lv1") or "", item.get("eval_category_lv2") or "",
                    item.get("eval_category_lv3") or "", item.get("mgmt_tool") or "KPI",
                    batch_id,
                ),
            )
            counts["achievement"] += 1

        conn.execute(
            "UPDATE sync_batch SET status=?, counts_json=?, finished_at=? WHERE id=?",
            ("ok", json.dumps(counts, ensure_ascii=False), datetime.now(timezone.utc).isoformat(), batch_id),
        )
        try:
            from rollup_engine import recompute_group_scores
            rollup = recompute_group_scores(conn, year, month)
            counts["group_scores"] = rollup.get("groups") or 0
        except Exception as rollup_err:
            # 지표 산정은 유지, 롤업 실패는 기록만
            counts["group_score_error"] = str(rollup_err)
        conn.commit()
        return {"ok": True, "batch_id": batch_id, "eval_ym": ym, "mode": mode, **counts}
    except Exception as e:
        conn.rollback()
        conn.execute(
            "UPDATE sync_batch SET status=?, error_text=?, finished_at=?, counts_json=? WHERE id=?",
            ("error", str(e), datetime.now(timezone.utc).isoformat(), json.dumps(counts, ensure_ascii=False), batch_id),
        )
        conn.commit()
        raise
