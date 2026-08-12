# -*- coding: utf-8 -*-
"""가공식(fact_formula) 검증·미리보기."""
from __future__ import annotations

import json
import re
from typing import Any

from achievement_engine import evaluate_formula_expr
from fact_pipeline import INDICATOR_CODE_RE, eval_ym

EXPR_SAFE_RE = re.compile(r"^[\w+\-*/().%\s]+$", re.UNICODE)
OPERAND_KEY_RE = re.compile(r"^[^\W\d]\w*$", re.UNICODE)


def parse_operands(raw: Any) -> dict[str, str]:
    if raw is None or raw == "":
        return {}
    if isinstance(raw, dict):
        return {str(k).strip(): str(v).strip() for k, v in raw.items() if str(k).strip()}
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except Exception as e:
            raise ValueError(f"operands_json invalid: {e}") from e
        if not isinstance(data, dict):
            raise ValueError("operands must be an object")
        return {str(k).strip(): str(v).strip() for k, v in data.items() if str(k).strip()}
    raise ValueError("operands must be object or JSON string")


def operands_to_json(operands: dict[str, str]) -> str:
    return json.dumps(operands, ensure_ascii=False)


def _is_indicator_ref(value: str) -> bool:
    return bool(INDICATOR_CODE_RE.match(str(value or "").strip()))


def _indicator_exists(conn, code: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM indicator_code WHERE indicator_code=?",
        (code.upper(),),
    ).fetchone()
    return bool(row)


def validate_formula(
    conn,
    *,
    name: str,
    output: str,
    expr: str,
    operands: dict[str, str],
    exclude_id: int | None = None,
) -> None:
    name = str(name or "").strip()
    output = str(output or "").strip().upper()
    expr = str(expr or "").strip()
    if not name:
        raise ValueError("name is required")
    if not output:
        raise ValueError("output_indicator_code is required")
    if not expr:
        raise ValueError("expr is required")
    if not EXPR_SAFE_RE.match(expr):
        raise ValueError("expr contains unsafe characters")
    if not _indicator_exists(conn, output):
        raise ValueError(f"output_indicator_code not found: {output}")
    if not operands:
        raise ValueError("operands is required")

    for key, ref in operands.items():
        if not OPERAND_KEY_RE.fullmatch(key):
            raise ValueError(f"invalid operand key: {key} (한글·영문·숫자·_ 가능, 숫자로 시작 불가)")
        if not str(ref).strip():
            raise ValueError(f"empty operand value for {key}")
        if _is_indicator_ref(ref):
            code = ref.strip().upper()
            if code == output:
                raise ValueError("output cannot reference itself as operand")
            if not _indicator_exists(conn, code):
                raise ValueError(f"operand indicator not found: {code}")
        else:
            try:
                float(ref)
            except Exception as e:
                raise ValueError(f"operand {key} must be indicator_code or number") from e

    # 느슨한 순환: 기존 활성 식들 + 이번 식의 출력→피연산자 그래프
    edges: dict[str, set[str]] = {}
    rows = conn.execute(
        "SELECT id, output_indicator_code, operands_json FROM fact_formula WHERE use_yn='Y'"
    ).fetchall()
    for row in rows:
        if exclude_id is not None and int(row["id"]) == int(exclude_id):
            continue
        out = str(row["output_indicator_code"] or "").upper()
        try:
            ops = parse_operands(row["operands_json"])
        except Exception:
            ops = {}
        deps = {str(v).strip().upper() for v in ops.values() if _is_indicator_ref(v)}
        edges.setdefault(out, set()).update(deps)
    edges.setdefault(output, set()).update(
        {str(v).strip().upper() for v in operands.values() if _is_indicator_ref(v)}
    )

    # output 에서 시작해 역방향(의존) 따라가며 자기 자신 재방문 시 순환
    stack = list(edges.get(output, set()))
    seen = {output}
    while stack:
        cur = stack.pop()
        if cur == output:
            raise ValueError("circular formula dependency detected")
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(edges.get(cur, set()))

    # expr dry-run with dummy numbers
    dummy = {k: 1.0 for k in operands}
    if evaluate_formula_expr(expr, dummy) is None:
        raise ValueError("expr evaluation failed")


def preview_formula(
    conn,
    *,
    year: int,
    month: int,
    expr: str,
    operands: dict[str, str],
    group_code: str | None = None,
) -> dict[str, Any]:
    ym = eval_ym(year, month)
    expr = str(expr or "").strip()
    if not expr or not EXPR_SAFE_RE.match(expr):
        raise ValueError("expr invalid")
    if not operands:
        raise ValueError("operands required")

    group = (group_code or "").strip().upper() or None

    operand_vals: dict[str, float] = {}
    missing: list[str] = []
    missing_detail: list[str] = []
    sources: dict[str, Any] = {}
    groups_seen: list[str] = []

    for key, ref in operands.items():
        ref_s = str(ref).strip()
        if _is_indicator_ref(ref_s):
            code = ref_s.upper()
            code_row = conn.execute(
                "SELECT group_code FROM indicator_code WHERE indicator_code=?",
                (code,),
            ).fetchone()
            op_group = (code_row["group_code"] if code_row else None) or group
            if op_group and op_group not in groups_seen:
                groups_seen.append(op_group)
            row = None
            src = None
            if op_group:
                row = conn.execute(
                    "SELECT actual FROM fact_calc WHERE eval_ym=? AND group_code=? AND indicator_code=?",
                    (ym, op_group, code),
                ).fetchone()
                if row is not None:
                    src = "calc"
            if row is None:
                row = conn.execute(
                    "SELECT actual FROM fact_calc WHERE eval_ym=? AND indicator_code=? LIMIT 1",
                    (ym, code),
                ).fetchone()
                if row is not None:
                    src = "calc"
            if row is None:
                row = conn.execute(
                    "SELECT actual FROM fact_collect WHERE eval_ym=? AND indicator_code=?",
                    (ym, code),
                ).fetchone()
                if row is not None:
                    src = "collect"
            if row is None or row["actual"] is None:
                missing.append(key)
                missing_detail.append(f"{key}({code}) {ym} 실적 없음")
                sources[key] = {"ref": code, "group_code": op_group, "source": None, "actual": None}
            else:
                operand_vals[key] = float(row["actual"])
                sources[key] = {
                    "ref": code,
                    "group_code": op_group,
                    "source": src,
                    "actual": float(row["actual"]),
                }
        else:
            operand_vals[key] = float(ref_s)
            sources[key] = {"ref": ref_s, "source": "const", "actual": float(ref_s)}

    if not group and groups_seen:
        group = groups_seen[0]

    if missing:
        return {
            "ok": False,
            "eval_ym": ym,
            "group_code": group,
            "result": None,
            "missing": missing,
            "operands": sources,
            "message": "; ".join(missing_detail),
        }

    result = evaluate_formula_expr(expr, operand_vals)
    if result is None:
        return {
            "ok": False,
            "eval_ym": ym,
            "group_code": group,
            "result": None,
            "missing": [],
            "operands": sources,
            "message": "expr evaluation failed",
        }
    return {
        "ok": True,
        "eval_ym": ym,
        "group_code": group,
        "result": result,
        "missing": [],
        "operands": sources,
        "message": "",
    }
