# -*- coding: utf-8 -*-
"""그룹 종합달성률 L1 / L2 / L3 롤업 엔진.

계층
----
- L1 (base_score): contribution_mode=WEIGHT 지표만 가중평균 달성률
- L2 (group_final_score): L1 + Σ(ADJUST 실적점) * ADJUST_POINT_TO_PP
- L3 (ultimate_score): score_rollup_* 규칙이 있는 대상 그룹만 블렌딩.
  규칙 없는 그룹은 L3=L2. UI는 rollup_set_id(규칙 매핑)가 있을 때만 L3 행 표시.

전행(SHB)
---------
ADJUST 편성·가감 금지. 전행 대시보드 상단 종합은 L1만 사용.

행내 이식 시
------------
- ADJUST_POINT_TO_PP(기본 0.01) 규정 변경 시 여기와 UI 문구 동시 수정
- resolve 방식은 eval_plan_set과 동일(year + effective_from_month)
"""
from __future__ import annotations

import sqlite3
from typing import Any

from fact_pipeline import eval_ym as to_eval_ym, list_plan_items, resolve_plan_set

# 1점 가감 = ±0.01%p (행내 규정 변경 시 상수만 바꾸지 말고 문서·UI도 함께)
ADJUST_POINT_TO_PP = 0.01
BANK_GROUP_CODE = "SHB"
CONTRIB_WEIGHT = "WEIGHT"
CONTRIB_ADJUST = "ADJUST"


def _round(value: float | None, digits: int = 4) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def normalize_contribution_mode(raw) -> str:
    s = str(raw or CONTRIB_WEIGHT).strip().upper()
    if s in ("ADJUST", "ADJ", "INTERNAL", "INTERNAL_CONTROL", "내부통제", "가감"):
        return CONTRIB_ADJUST
    return CONTRIB_WEIGHT


def resolve_rollup_set(conn: sqlite3.Connection, year: int, month: int):
    return conn.execute(
        """
        SELECT id, year, effective_from_month, change_reason, created_at, updated_at
        FROM score_rollup_set
        WHERE year=? AND effective_from_month<=?
        ORDER BY effective_from_month DESC
        LIMIT 1
        """,
        (year, month),
    ).fetchone()


def load_rollup_rules(conn: sqlite3.Connection, rollup_set_id: int) -> list[dict]:
    rules = []
    for rule in conn.execute(
        """
        SELECT id, target_group_code
        FROM score_rollup_rule
        WHERE rollup_set_id=?
        ORDER BY target_group_code
        """,
        (rollup_set_id,),
    ):
        terms = []
        for term in conn.execute(
            """
            SELECT id, term_type, weight, sort_order
            FROM score_rollup_term
            WHERE rule_id=?
            ORDER BY sort_order, id
            """,
            (rule["id"],),
        ):
            groups = [
                r["group_code"]
                for r in conn.execute(
                    "SELECT group_code FROM score_rollup_term_group WHERE term_id=? ORDER BY group_code",
                    (term["id"],),
                )
            ]
            terms.append({
                "id": term["id"],
                "term_type": str(term["term_type"] or "").strip().upper(),
                "weight": float(term["weight"] or 0),
                "sort_order": int(term["sort_order"] or 0),
                "groups": groups,
            })
        rules.append({
            "id": rule["id"],
            "target_group_code": str(rule["target_group_code"] or "").strip().upper(),
            "terms": terms,
        })
    return rules


def _contribution_map(conn: sqlite3.Connection, plan_set_id: int) -> dict[tuple[str, str], str]:
    out = {}
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(eval_plan_item)")}
    has_mode = "contribution_mode" in cols
    sql = "SELECT group_code, indicator_code"
    if has_mode:
        sql += ", contribution_mode"
    sql += " FROM eval_plan_item WHERE plan_set_id=? AND COALESCE(use_yn,'Y')='Y'"
    for row in conn.execute(sql, (plan_set_id,)):
        mode = normalize_contribution_mode(row["contribution_mode"] if has_mode else CONTRIB_WEIGHT)
        key = (str(row["group_code"]).upper(), str(row["indicator_code"]).upper())
        out[key] = mode
    return out


def recompute_group_scores(conn: sqlite3.Connection, year: int, month: int) -> dict[str, Any]:
    """achievement_result 기준 그룹 L1/L2/L3 재계산."""
    ym = to_eval_ym(year, month)
    plan = resolve_plan_set(conn, year, month)
    mode_by_key: dict[tuple[str, str], str] = {}
    if plan:
        mode_by_key = _contribution_map(conn, plan["id"])

    rows = conn.execute(
        """
        SELECT group_code, indicator_code, weight, converted_achievement, actual
        FROM achievement_result
        WHERE eval_ym=?
        """,
        (ym,),
    ).fetchall()

    # group -> accumulators
    weighted_sum: dict[str, float] = {}
    weight_sum: dict[str, float] = {}
    adjust_points: dict[str, float] = {}
    groups: set[str] = set()

    for row in rows:
        g = str(row["group_code"] or "").strip().upper()
        code = str(row["indicator_code"] or "").strip().upper()
        if not g:
            continue
        groups.add(g)
        mode = mode_by_key.get((g, code), CONTRIB_WEIGHT)
        if mode == CONTRIB_ADJUST:
            if g == BANK_GROUP_CODE:
                continue
            pts = float(row["actual"]) if row["actual"] is not None else 0.0
            adjust_points[g] = adjust_points.get(g, 0.0) + pts
            continue
        ach = row["converted_achievement"]
        w = float(row["weight"] or 0)
        if ach is None or w <= 0:
            continue
        weighted_sum[g] = weighted_sum.get(g, 0.0) + float(ach) * w
        weight_sum[g] = weight_sum.get(g, 0.0) + w

    # also include groups that appear only in plan
    if plan:
        for item in list_plan_items(conn, plan["id"]):
            g = str(item.get("group_code") or "").strip().upper()
            if g:
                groups.add(g)

    l2_by_group: dict[str, float | None] = {}
    results: list[dict] = []
    for g in sorted(groups):
        ws = weight_sum.get(g, 0.0)
        base = (weighted_sum[g] / ws) if ws > 0 else None
        pts = 0.0 if g == BANK_GROUP_CODE else adjust_points.get(g, 0.0)
        pp = pts * ADJUST_POINT_TO_PP
        final = None if base is None else base + pp
        if base is None and pts != 0:
            # only adjust items: treat L1 as 0? Prefer leave base null and final = pp only if we had base.
            # Spec: L2 = L1 + Δ. If no WEIGHT KPIs, base stays null; final stays null unless we allow adjust-only.
            final = None
        l2_by_group[g] = final
        results.append({
            "group_code": g,
            "base_score": _round(base, 4),
            "adjust_points": _round(pts, 4) or 0,
            "adjust_pp": _round(pp, 4) or 0,
            "group_final_score": _round(final, 4),
            "ultimate_score": _round(final, 4),  # filled after L3
            "rollup_set_id": None,
        })

    rollup = resolve_rollup_set(conn, year, month)
    rollup_id = int(rollup["id"]) if rollup else None
    rules_by_target: dict[str, dict] = {}
    if rollup_id:
        for rule in load_rollup_rules(conn, rollup_id):
            rules_by_target[rule["target_group_code"]] = rule

    def avg_l2(codes: list[str]) -> float | None:
        vals = []
        for c in codes:
            v = l2_by_group.get(str(c).upper())
            if v is not None:
                vals.append(float(v))
        if not vals:
            return None
        return sum(vals) / len(vals)

    for row in results:
        g = row["group_code"]
        l2 = l2_by_group.get(g)
        rule = rules_by_target.get(g)
        if not rule or l2 is None:
            row["ultimate_score"] = _round(l2, 4)
            row["rollup_set_id"] = rollup_id if rule else None
            continue
        total = 0.0
        wsum = 0.0
        ok = True
        for term in rule["terms"]:
            tw = float(term["weight"] or 0)
            ttype = term["term_type"]
            if ttype == "SELF":
                part = l2
            elif ttype == "AVG_GROUPS":
                part = avg_l2(term.get("groups") or [])
            else:
                ok = False
                break
            if part is None:
                ok = False
                break
            total += float(part) * tw
            wsum += tw
        if ok and wsum > 0:
            row["ultimate_score"] = _round(total, 4)
            row["rollup_set_id"] = rollup_id
        else:
            row["ultimate_score"] = _round(l2, 4)
            row["rollup_set_id"] = rollup_id

    conn.execute("DELETE FROM group_score_result WHERE eval_ym=?", (ym,))
    for row in results:
        conn.execute(
            """
            INSERT INTO group_score_result(
              eval_ym, group_code, base_score, adjust_points, adjust_pp,
              group_final_score, ultimate_score, rollup_set_id
            ) VALUES (?,?,?,?,?,?,?,?)
            """,
            (
                ym,
                row["group_code"],
                row["base_score"],
                row["adjust_points"],
                row["adjust_pp"],
                row["group_final_score"],
                row["ultimate_score"],
                row["rollup_set_id"],
            ),
        )

    return {
        "ok": True,
        "eval_ym": ym,
        "groups": len(results),
        "rollup_set_id": rollup_id,
        "items": results,
    }


def list_group_scores(conn: sqlite3.Connection, year: int, month: int) -> list[dict]:
    ym = to_eval_ym(year, month)
    rows = conn.execute(
        """
        SELECT g.*, og.name AS group_name
        FROM group_score_result g
        LEFT JOIN owner_group og ON og.code = g.group_code
        WHERE g.eval_ym=?
        ORDER BY og.sort_order, g.group_code
        """,
        (ym,),
    ).fetchall()
    return [dict(r) for r in rows]


def replace_score_rollup(
    conn: sqlite3.Connection,
    year: int,
    effective_month: int,
    rules: list[dict],
    change_reason: str = "",
) -> dict:
    """시행월 단위로 롤업 규칙을 통째로 교체."""
    existing = conn.execute(
        "SELECT id FROM score_rollup_set WHERE year=? AND effective_from_month=?",
        (year, effective_month),
    ).fetchone()
    if existing:
        set_id = existing["id"]
        conn.execute(
            "UPDATE score_rollup_set SET change_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (change_reason or "", set_id),
        )
        # cascade delete rules via FK if ON DELETE CASCADE — delete rules explicitly for safety
        rule_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM score_rollup_rule WHERE rollup_set_id=?", (set_id,)
        )]
        for rid in rule_ids:
            term_ids = [t["id"] for t in conn.execute(
                "SELECT id FROM score_rollup_term WHERE rule_id=?", (rid,)
            )]
            for tid in term_ids:
                conn.execute("DELETE FROM score_rollup_term_group WHERE term_id=?", (tid,))
            conn.execute("DELETE FROM score_rollup_term WHERE rule_id=?", (rid,))
        conn.execute("DELETE FROM score_rollup_rule WHERE rollup_set_id=?", (set_id,))
    else:
        cur = conn.execute(
            "INSERT INTO score_rollup_set(year, effective_from_month, change_reason) VALUES (?,?,?)",
            (year, effective_month, change_reason or ""),
        )
        set_id = cur.lastrowid

    for rule in rules or []:
        target = str(rule.get("target_group_code") or rule.get("targetGroupCode") or "").strip().upper()
        if not target or target == BANK_GROUP_CODE:
            continue
        cur = conn.execute(
            "INSERT INTO score_rollup_rule(rollup_set_id, target_group_code) VALUES (?,?)",
            (set_id, target),
        )
        rule_id = cur.lastrowid
        terms = rule.get("terms") or []
        for ti, term in enumerate(terms):
            ttype = str(term.get("term_type") or term.get("termType") or "").strip().upper()
            if ttype not in ("SELF", "AVG_GROUPS"):
                raise ValueError(f"invalid term_type: {ttype}")
            weight = float(term.get("weight") or 0)
            cur_t = conn.execute(
                "INSERT INTO score_rollup_term(rule_id, term_type, weight, sort_order) VALUES (?,?,?,?)",
                (rule_id, ttype, weight, int(term.get("sort_order") or term.get("sortOrder") or ti)),
            )
            term_id = cur_t.lastrowid
            if ttype == "AVG_GROUPS":
                for g in term.get("groups") or []:
                    gc = str(g).strip().upper()
                    if not gc:
                        continue
                    conn.execute(
                        "INSERT OR IGNORE INTO score_rollup_term_group(term_id, group_code) VALUES (?,?)",
                        (term_id, gc),
                    )

    return {"ok": True, "rollup_set_id": set_id, "year": year, "effective_from_month": effective_month}


def list_score_rollups(conn: sqlite3.Connection, year: int) -> list[dict]:
    sets = conn.execute(
        """
        SELECT id, year, effective_from_month, change_reason, created_at, updated_at
        FROM score_rollup_set
        WHERE year=?
        ORDER BY effective_from_month
        """,
        (year,),
    ).fetchall()
    out = []
    for s in sets:
        out.append({
            **dict(s),
            "rules": load_rollup_rules(conn, s["id"]),
        })
    return out


def resolve_score_rollup_detail(conn: sqlite3.Connection, year: int, month: int) -> dict | None:
    s = resolve_rollup_set(conn, year, month)
    if not s:
        return None
    return {**dict(s), "rules": load_rollup_rules(conn, s["id"])}
