# -*- coding: utf-8 -*-
"""에이전트 DB → 은행 적재 스테이징 (outbound). 실은행 어댑터는 no-op."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fact_pipeline import eval_ym

logger = logging.getLogger("bank_export")


def push_to_bank(batch: dict[str, Any], items: list[dict[str, Any]]) -> None:
    """행내 은행 DB 적재 훅. 현재는 no-op 로그 어댑터."""
    logger.info(
        "bank_export push_to_bank no-op batch_id=%s eval_ym=%s items=%s",
        batch.get("id"),
        batch.get("eval_ym"),
        len(items),
    )


def run_bank_export(
    conn,
    year: int,
    month: int,
    *,
    triggered_by: str = "api",
) -> dict[str, Any]:
    ym = eval_ym(year, month)
    started = datetime.now(timezone.utc).isoformat()
    cur = conn.execute(
        """
        INSERT INTO bank_export_batch(eval_ym, status, triggered_by, counts_json, error_text, started_at)
        VALUES (?,?,?,?,?,?)
        """,
        (ym, "running", str(triggered_by or "api"), "{}", "", started),
    )
    batch_id = cur.lastrowid
    counts = {"items": 0, "calc": 0, "achievement": 0}

    try:
        calc_rows = conn.execute(
            """
            SELECT c.eval_ym, c.group_code, c.indicator_code, c.actual, c.calc_kind, c.formula_id,
                   f.name AS formula_name
            FROM fact_calc c
            LEFT JOIN fact_formula f ON f.id = c.formula_id
            WHERE c.eval_ym=?
            ORDER BY c.group_code, c.indicator_code
            """,
            (ym,),
        ).fetchall()
        ach_map = {}
        for row in conn.execute(
            """
            SELECT group_code, indicator_code, monthly_target, converted_achievement, simple_achievement,
                   annual_target, unit, label, weight
            FROM achievement_result WHERE eval_ym=?
            """,
            (ym,),
        ).fetchall():
            ach_map[(row["group_code"], row["indicator_code"])] = dict(row)

        items_out: list[dict[str, Any]] = []
        for row in calc_rows:
            d = dict(row)
            key = (d["group_code"], d["indicator_code"])
            ach = ach_map.get(key) or {}
            monthly_target = ach.get("monthly_target")
            converted = ach.get("converted_achievement")
            if converted is None:
                converted = ach.get("simple_achievement")
            payload = {
                "annual_target": ach.get("annual_target"),
                "unit": ach.get("unit"),
                "label": ach.get("label"),
                "weight": ach.get("weight"),
                "formula_name": d.get("formula_name"),
            }
            conn.execute(
                """
                INSERT INTO bank_export_item(
                  batch_id, eval_ym, group_code, indicator_code, actual, calc_kind,
                  monthly_target, converted_achievement, payload_json
                ) VALUES (?,?,?,?,?,?,?,?,?)
                """,
                (
                    batch_id,
                    ym,
                    d["group_code"],
                    d["indicator_code"],
                    d.get("actual"),
                    d.get("calc_kind") or "DIRECT",
                    monthly_target,
                    converted,
                    json.dumps(payload, ensure_ascii=False),
                ),
            )
            counts["items"] += 1
            counts["calc"] += 1
            if ach:
                counts["achievement"] += 1
            items_out.append({
                "group_code": d["group_code"],
                "indicator_code": d["indicator_code"],
                "actual": d.get("actual"),
                "calc_kind": d.get("calc_kind"),
            })

        batch = {"id": batch_id, "eval_ym": ym, "triggered_by": triggered_by}
        push_to_bank(batch, items_out)

        finished = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """
            UPDATE bank_export_batch
            SET status=?, counts_json=?, finished_at=?
            WHERE id=?
            """,
            ("ok", json.dumps(counts, ensure_ascii=False), finished, batch_id),
        )
        conn.commit()
        return {
            "ok": True,
            "batch_id": batch_id,
            "eval_ym": ym,
            "year": year,
            "month": month,
            "status": "ok",
            "counts": counts,
        }
    except Exception as e:
        conn.execute(
            """
            UPDATE bank_export_batch
            SET status=?, error_text=?, finished_at=?, counts_json=?
            WHERE id=?
            """,
            (
                "error",
                str(e),
                datetime.now(timezone.utc).isoformat(),
                json.dumps(counts, ensure_ascii=False),
                batch_id,
            ),
        )
        conn.commit()
        raise
