"""KPI 코드체계 + 평가배치 셋이력 API (SQLite)."""
from __future__ import annotations

import gzip
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from achievement_engine import build_monthly_targets_map, _parse_custom_monthly
from db import DATA_DIR, DB_PATH, compose_indicator_code, counts, get_connection, init_schema
from import_eval_plan import TEMPLATE_PATH, export_eval_items, parse_eval_workbook, write_template
from import_code_master import DEFAULT_XLSX, export_workbook, import_workbook
from org_group import EVAL_ORG_LEVELS, normalize_org_level, validate_org_group_fields
from bank_export import run_bank_export
from fact_pipeline import eval_ym as to_eval_ym, refresh_facts
from dept_fact_entry import (
    list_all_fact_entries,
    list_dept_fact_entries,
    list_distinct_depts,
    list_group_fact_entries,
    parse_dept_entry_workbook,
    save_dept_fact_entries,
    write_dept_entry_workbook,
)
from fact_period import (
    confirm_group,
    freeze_period,
    get_period_status,
    revoke_group_confirm,
    unfreeze_period,
)
from import_fact_upload import (
    TEMPLATE_PATH as FACT_UPLOAD_TEMPLATE_PATH,
    cancel_fact_upload,
    confirm_fact_upload,
    export_pending_uploads_to_bank,
    list_upload_batches,
    list_upload_change_logs,
    list_upload_items,
    preview_fact_upload,
    write_template as write_fact_upload_template,
)
from rollup_engine import (
    BANK_GROUP_CODE,
    list_group_scores,
    list_score_rollups,
    normalize_contribution_mode,
    recompute_group_scores,
    replace_score_rollup,
    resolve_score_rollup_detail,
    CONTRIB_ADJUST,
)
from formula_service import (
    operands_to_json,
    parse_operands,
    preview_formula,
    validate_formula,
)
from indicator_definition import (
    DEFINITION_FIELDS,
    LV3_DEFINITION_FIELDS,
    coalesce_eval_text,
    merge_definition,
    pick_lv3_definition_fields,
    pick_master_definition_fields,
)

# 클라우드(Render 등)는 PORT/HOST 환경변수 사용. 로컬 기본은 127.0.0.1:8787
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8787"))
DEMO_DB_GZ = DATA_DIR / "kpi.demo.sqlite.gz"


def ensure_demo_database() -> None:
    """배포용: DB가 없거나 2026 평가배치가 비면 번들 데모 sqlite(gz)로 복구."""
    if not DEMO_DB_GZ.exists():
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    need_restore = (not DB_PATH.exists()) or DB_PATH.stat().st_size <= 0
    if not need_restore:
        try:
            with get_connection() as conn:
                row = conn.execute(
                    """
                    SELECT 1
                      FROM eval_plan_set s
                     WHERE s.year = 2026
                       AND EXISTS (
                         SELECT 1 FROM eval_plan_item e WHERE e.plan_set_id = s.id
                       )
                     LIMIT 1
                    """
                ).fetchone()
                if not row:
                    need_restore = True
                    print("Demo DB missing 2026 eval plan — restoring from", DEMO_DB_GZ.name)
        except Exception as e:
            need_restore = True
            print("Demo DB check failed — restoring:", e)

    if not need_restore:
        return

    # 기존 깨진 DB 교체
    for suffix in ("", "-wal", "-shm"):
        p = Path(str(DB_PATH) + suffix) if suffix else DB_PATH
        if p.exists():
            try:
                p.unlink()
            except OSError:
                pass
    with gzip.open(DEMO_DB_GZ, "rb") as src, open(DB_PATH, "wb") as dst:
        shutil.copyfileobj(src, dst)
    print("Restored demo DB from", DEMO_DB_GZ.name)


def rows_to_list(cur):
    return [dict(r) for r in cur.fetchall()]


def enrich_code_row(row: dict) -> dict:
    """지표마스터 row에 Lv3·마스터 원본과 머지 정의 첨부."""
    lv3 = {
        "unit": row.get("lv3_unit") or "",
        "definition_text": row.get("common_definition_text") or "",
        "calc_logic_text": row.get("common_calc_logic_text") or "",
        "owner_group_code": row.get("common_owner_group_code") or "",
        "dept": row.get("common_dept") or "",
        "calc_cycle": row.get("common_calc_cycle") or "",
        "calc_timing": row.get("common_calc_timing") or "",
        "data_source_kind": row.get("common_data_source_kind") or "",
        "data_source": row.get("common_data_source") or "",
    }
    master = {
        "unit": row.get("master_unit") or "",
        "detailed_definition_text": row.get("master_detailed_definition_text") or "",
        "owner_group_code": row.get("master_owner_group_code") or "",
        "dept": row.get("master_dept") or "",
    }
    merged = merge_definition(lv3, master)
    out = dict(row)
    out["lv3_definition"] = {k: lv3.get(k, "") for k in (*LV3_DEFINITION_FIELDS, "unit")}
    out["master_definition"] = {
        "detailed_definition_text": master.get("detailed_definition_text") or "",
        "owner_group_code": master.get("owner_group_code") or "",
        "dept": master.get("dept") or "",
    }
    out["merged"] = {
        **{k: merged.get(k, "") for k in (*DEFINITION_FIELDS, "unit")},
        "definition_text_combined": merged.get("definition_text_combined") or "",
    }
    out["merged_sources"] = merged["sources"]
    out["definition_filled"] = merged["definition_filled"]
    out["definition_complete"] = merged["definition_complete"]
    out["unit"] = merged.get("unit") or ""
    out["detailed_definition_text"] = master.get("detailed_definition_text") or ""
    out["owner_group_code"] = merged.get("owner_group_code") or ""
    out["dept"] = merged.get("dept") or ""
    out["ownership_group_code"] = out["owner_group_code"]
    out["ownership_dept"] = out["dept"]
    return out


def enrich_code_rows(rows: list[dict]) -> list[dict]:
    return [enrich_code_row(r) for r in rows]


def extract_multipart_file(content_type: str, body: bytes, field_name: str = "file") -> bytes | None:
    m = re.search(r"boundary=([^;]+)", content_type or "", re.I)
    if not m or not body:
        return None
    boundary = m.group(1).strip().strip('"').encode("ascii", "ignore")
    for part in body.split(b"--" + boundary):
        if b"Content-Disposition" not in part:
            continue
        header, _, payload = part.partition(b"\r\n\r\n")
        if not payload:
            header, _, payload = part.partition(b"\n\n")
        if field_name.encode() not in header or b"filename=" not in header:
            continue
        if payload.endswith(b"\r\n"):
            payload = payload[:-2]
        elif payload.endswith(b"\n"):
            payload = payload[:-1]
        return payload
    return None


def coerce_month(value) -> int:
    month = int(value)
    if month < 1 or month > 12:
        raise ValueError("month must be between 1 and 12")
    return month


def coerce_year(value) -> int:
    year = int(value)
    if year < 2000 or year > 2100:
        raise ValueError("year out of range")
    return year


def code_lookup_query() -> str:
    return """
        SELECT
          ic.indicator_code,
          ic.common_code,
          ic.group_code,
          og.name AS group_name,
          ic.perf_code,
          ic.display_name,
          COALESCE(NULLIF(TRIM(cm.unit), ''), ic.unit, '') AS unit,
          cm.unit AS lv3_unit,
          ic.unit AS master_unit,
          cm.lv1_code,
          l1.name AS lv1_name,
          cm.lv2_code,
          l2.name AS lv2_name,
          cm.lv3_code,
          cm.name AS lv3_name,
          cm.definition_text AS common_definition_text,
          cm.calc_logic_text AS common_calc_logic_text,
          cm.owner_group_code AS common_owner_group_code,
          cm.dept AS common_dept,
          cm.calc_cycle AS common_calc_cycle,
          cm.calc_timing AS common_calc_timing,
          cm.data_source_kind AS common_data_source_kind,
          cm.data_source AS common_data_source,
          ic.detailed_definition_text AS master_detailed_definition_text,
          ic.owner_group_code AS master_owner_group_code,
          ic.dept AS master_dept,
          ic.use_yn
        FROM indicator_code ic
        JOIN indicator_common cm ON cm.common_code = ic.common_code
        JOIN code_lv1 l1 ON l1.code = cm.lv1_code
        JOIN code_lv2 l2 ON l2.code = cm.lv2_code
        JOIN owner_group og ON og.code = ic.group_code
    """


def plan_item_query() -> str:
    return """
        SELECT
          e.id,
          e.plan_set_id,
          s.year,
          s.effective_from_month,
          s.change_reason,
          e.group_code,
          og.name AS group_name,
          e.indicator_code,
          e.mgmt_tool,
          e.eval_category_lv1,
          e.eval_category_lv2,
          e.eval_category_lv3,
          e.label,
          COALESCE(NULLIF(TRIM(e.unit), ''), NULLIF(TRIM(cm.unit), ''), ic.unit, '') AS unit,
          e.weight,
          e.is_core,
          e.annual_target,
          e.monthly_target,
          e.baseline_actual,
          e.collect_type,
          e.dept,
          e.data_source,
          e.definition_text,
          e.calc_logic_text,
          e.h1_target,
          e.h2_target,
          e.score_rule,
          e.penalty_rule,
          e.cap_max,
          e.cap_min,
          e.remark,
          e.adj_band,
          e.filters_json,
          e.formula_id,
          e.achievement_mode,
          e.goal_direction,
          e.custom_achievement_expr,
          e.custom_monthly_targets_json,
          e.sort_order,
          e.use_yn,
          e.contribution_mode,
          ic.common_code,
          ic.perf_code,
          ic.display_name,
          cm.lv1_code,
          l1.name AS lv1_name,
          cm.lv2_code,
          l2.name AS lv2_name,
          cm.lv3_code,
          cm.name AS lv3_name
        FROM eval_plan_item e
        JOIN eval_plan_set s ON s.id = e.plan_set_id
        JOIN indicator_code ic ON ic.indicator_code = e.indicator_code
        JOIN indicator_common cm ON cm.common_code = ic.common_code
        JOIN code_lv1 l1 ON l1.code = cm.lv1_code
        JOIN code_lv2 l2 ON l2.code = cm.lv2_code
        JOIN owner_group og ON og.code = e.group_code
    """


def resolve_plan_set(conn: sqlite3.Connection, year: int, month: int):
    return conn.execute(
        """
        SELECT id, year, effective_from_month, change_reason, created_at, updated_at
        FROM eval_plan_set
        WHERE year=? AND effective_from_month<=?
        ORDER BY effective_from_month DESC
        LIMIT 1
        """,
        (year, month),
    ).fetchone()


def read_eval_config(conn: sqlite3.Connection, year: int, month: int, group_code: str | None = None):
    plan_set = resolve_plan_set(conn, year, month)
    if not plan_set:
        return {
            "plan_set_id": None,
            "year": year,
            "month": month,
            "resolved_from_month": None,
            "is_inherited": False,
            "change_reason": "",
            "items": [],
        }

    sql = plan_item_query() + " WHERE e.plan_set_id=?"
    params = [plan_set["id"]]
    if group_code:
        sql += " AND e.group_code=?"
        params.append(group_code)
    sql += " ORDER BY e.group_code, e.sort_order, e.indicator_code"
    items = rows_to_list(conn.execute(sql, params))
    return {
        "plan_set_id": plan_set["id"],
        "year": year,
        "month": month,
        "resolved_from_month": plan_set["effective_from_month"],
        "is_inherited": plan_set["effective_from_month"] != month,
        "change_reason": plan_set["change_reason"] or "",
        "items": items,
    }


def serialize_custom_targets(item):
    raw = item.get("custom_monthly_targets_json")
    if raw is not None:
        return raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
    raw = item.get("customMonthlyTargetsJson")
    if raw is not None:
        return raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
    raw = item.get("customMonthlyTargets")
    if raw is not None:
        return json.dumps(raw, ensure_ascii=False)
    return None


def resolve_monthly_targets_for_save(item: dict, year: int, effective_month: int) -> tuple[float | None, str]:
    """연간목표로 1~12월 월간목표를 채우고, 적용월의 monthly_target을 확정한다."""
    annual = float(item.get("annual_target") or item.get("annualTarget") or item.get("연간목표") or 0)
    baseline = float(item.get("baseline_actual") or item.get("baselineActual") or item.get("기준실적") or 0)
    mode = str(item.get("achievement_mode") or item.get("achievementMode") or item.get("산식구분") or "linear").strip().lower()
    existing_raw = serialize_custom_targets(item)
    existing = _parse_custom_monthly(existing_raw)
    # 1~12가 모두 있으면 유지, 아니면 연간목표 기준으로 재산정
    if len(existing) >= 12:
        monthly_map = {str(m): float(existing.get(str(m), 0)) for m in range(1, 13)}
    else:
        monthly_map = build_monthly_targets_map(
            {
                "annual_target": annual,
                "baseline_actual": baseline,
                "achievement_mode": mode,
                "year": year,
            },
            year,
        )
        # 부분 입력이 있으면 덮어쓰기
        for k, v in existing.items():
            monthly_map[str(k)] = float(v)

    monthly_target = _opt_float(item, "monthly_target", "monthlyTarget", "월간목표")
    if monthly_target is None:
        monthly_target = monthly_map.get(str(int(effective_month)))
    return monthly_target, json.dumps(monthly_map, ensure_ascii=False)


def serialize_filters(item):
    raw = item.get("filters_json")
    if raw is not None:
        return raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
    raw = item.get("filtersJson") or item.get("filters")
    if raw is not None:
        return raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
    # Filter1..Filter30 flat keys
    filters = {}
    for i in range(1, 31):
        v = item.get(f"Filter{i}") or item.get(f"filter{i}") or item.get(str(i))
        if v is not None and str(v).strip() != "":
            filters[str(i)] = str(v).strip()
    return json.dumps(filters, ensure_ascii=False) if filters else None


def _parse_core_yn(item, default: str = "N") -> str:
    """평가배치 Core 지정. Y/N (비중 상위가 아닌 수동 지정)."""
    for k in ("is_core", "isCore", "Core", "core", "CORE"):
        if k not in item:
            continue
        v = item.get(k)
        if v is None or v == "":
            continue
        if isinstance(v, bool):
            return "Y" if v else "N"
        s = str(v).strip().upper()
        if s in ("Y", "YES", "1", "TRUE", "T", "CORE", "O", "예"):
            return "Y"
        if s in ("N", "NO", "0", "FALSE", "F", "X", "아니오", "아님"):
            return "N"
    return default


def _opt_int(item, *keys):
    for k in keys:
        if item.get(k) is not None and item.get(k) != "":
            try:
                return int(item.get(k))
            except Exception:
                return None
    return None


def _opt_float(item, *keys):
    """옵션 값(상/하한 등)을 float으로 변환해 반환. 없으면 None."""
    for k in keys:
        v = item.get(k)
        if v is not None and v != "":
            try:
                return float(v)
            except Exception:
                return None
    return None


def _coerce_sort_order(item, idx: int) -> int:
    """표시순서. 프론트 편집값은 sortOrder가 최신일 수 있어 camelCase를 우선한다.
    0은 유효값이므로 `or` 체인을 쓰지 않는다."""
    for k in ("sortOrder", "sort_order", "순서"):
        if k not in item:
            continue
        v = item.get(k)
        if v is None or v == "":
            continue
        try:
            return int(float(v))
        except (TypeError, ValueError):
            continue
    return int(idx)


def delete_eval_plan_set(plan_set_id: int) -> dict:
    with get_connection() as conn:
        conn.execute("BEGIN")
        try:
            row = conn.execute(
                "SELECT id, year, effective_from_month FROM eval_plan_set WHERE id=?",
                (plan_set_id,),
            ).fetchone()
            if not row:
                raise ValueError("plan_set_id not found")
            conn.execute("DELETE FROM eval_plan_item WHERE plan_set_id=?", (plan_set_id,))
            conn.execute("DELETE FROM eval_plan_set WHERE id=?", (plan_set_id,))
            conn.commit()
            return {
                "plan_set_id": int(row["id"]),
                "year": int(row["year"]),
                "effective_from_month": int(row["effective_from_month"]),
            }
        except Exception:
            conn.rollback()
            raise


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.address_string(), fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path, content_type: str, download_name: str | None = None):
        body = Path(path).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self._cors()
        if download_name:
            self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def parse_path(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query)
        return path, {k: v[0] if len(v) == 1 else v for k, v in qs.items()}

    def _handle_import(self):
        ctype = self.headers.get("Content-Type") or ""
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        xlsx_path = DEFAULT_XLSX
        tmp_path = None

        if "multipart/form-data" in ctype:
            file_bytes = extract_multipart_file(ctype, raw, "file")
            if file_bytes:
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
                tmp.write(file_bytes)
                tmp.close()
                tmp_path = Path(tmp.name)
                xlsx_path = tmp_path
        elif "application/json" in ctype and raw:
            body = json.loads(raw.decode("utf-8"))
            if body.get("xlsx"):
                xlsx_path = Path(body["xlsx"])
        elif ctype and ("spreadsheet" in ctype or "octet-stream" in ctype or ctype.endswith("xlsx")):
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
            tmp.write(raw)
            tmp.close()
            tmp_path = Path(tmp.name)
            xlsx_path = tmp_path

        try:
            init_schema()
            result = import_workbook(xlsx_path)
            self.send_json(result)
        except Exception as e:
            self.send_json({"ok": False, "error": "import_failed", "message": str(e)}, 400)
        finally:
            if tmp_path and tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

    def _import_fact_upload(self) -> dict:
        ctype = self.headers.get("Content-Type") or ""
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        tmp_path = None
        filename = "upload.xlsx"
        uploaded_by = "ui"

        try:
            if "multipart/form-data" in ctype:
                file_bytes = extract_multipart_file(ctype, raw, "file")
                if not file_bytes:
                    raise ValueError("multipart file 필드가 필요합니다")
                # filename hint from Content-Disposition if present
                for part in raw.split(b"\r\n--"):
                    if b'name="file"' in part and b"filename=" in part:
                        try:
                            disp = part.split(b"\r\n", 1)[0].decode("utf-8", errors="ignore")
                            m = re.search(r'filename="([^"]+)"', disp)
                            if m:
                                filename = Path(m.group(1)).name
                        except Exception:
                            pass
                        break
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
                tmp.write(file_bytes)
                tmp.close()
                tmp_path = Path(tmp.name)
            elif ctype and ("spreadsheet" in ctype or "octet-stream" in ctype or ctype.endswith("xlsx")):
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
                tmp.write(raw)
                tmp.close()
                tmp_path = Path(tmp.name)
            else:
                raise ValueError("multipart/form-data 엑셀 업로드가 필요합니다")

            init_schema()
            with get_connection() as conn:
                return preview_fact_upload(
                    conn,
                    tmp_path,
                    filename=filename,
                    uploaded_by=uploaded_by,
                )
        finally:
            if tmp_path and tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

    def _import_dept_fact_entry(
        self, year: int, month: int, dept: str, group_code: str = "", actor_role: str = "", scope_all: bool = False,
    ) -> dict:
        ctype = self.headers.get("Content-Type") or ""
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        tmp_path = None
        acted_by = "ui"
        try:
            if "multipart/form-data" not in ctype:
                raise ValueError("multipart/form-data 엑셀 업로드가 필요합니다")
            file_bytes = extract_multipart_file(ctype, raw, "file")
            if not file_bytes:
                raise ValueError("multipart file 필드가 필요합니다")
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
            tmp.write(file_bytes)
            tmp.close()
            tmp_path = Path(tmp.name)
            ym = to_eval_ym(year, month)
            updates = parse_dept_entry_workbook(tmp_path, expect_ym=ym)
            with get_connection() as conn:
                return save_dept_fact_entries(
                    conn, year, month,
                    dept=dept, group_code=group_code, scope_all=scope_all, updates=updates,
                    acted_by=acted_by, actor_role=actor_role, refresh=True,
                )
        finally:
            if tmp_path and tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

    def _create_indicator_code(self, body):
        common = str(body.get("common_code") or "").strip().upper()
        group = str(body.get("group_code") or "").strip().upper()
        perf = str(body.get("perf_code") or "").strip().upper()
        display = str(body.get("display_name") or "").strip()
        defs = pick_master_definition_fields(body)
        if not common or not group or not perf:
            self.send_json({"error": "validation", "message": "common_code, group_code, perf_code required"}, 400)
            return
        with get_connection() as conn:
            crow = conn.execute(
                """SELECT lv1_code, lv2_code, lv3_code, name, unit
                   FROM indicator_common WHERE common_code=?""",
                (common,),
            ).fetchone()
            if not crow:
                self.send_json({"error": "not_found", "message": "common_code not found"}, 404)
                return
            code = compose_indicator_code(crow["lv1_code"], crow["lv2_code"], crow["lv3_code"], perf, group)
            if not display:
                display = crow["name"]
            unit = str(crow["unit"] or "").strip()
            own_group = defs.get("owner_group_code", "")
            own_dept = defs.get("dept", "")
            try:
                conn.execute(
                    """INSERT INTO indicator_code
                       (indicator_code, common_code, group_code, perf_code, display_name, unit, agg_type, use_yn,
                        detailed_definition_text, owner_group_code, dept)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        code, common, group, perf, display, unit, "", body.get("use_yn") or "Y",
                        defs["detailed_definition_text"], own_group, own_dept,
                    ),
                )
                conn.commit()
            except sqlite3.IntegrityError:
                self.send_json({"error": "duplicate_indicator_code", "code": code}, 409)
                return
        self.send_json({"ok": True, "indicator_code": code}, 201)

    def _replace_eval_configs(self, year: int, effective_month: int, items: list[dict], change_reason: str = ""):
        with get_connection() as conn:
            conn.execute("BEGIN")
            try:
                existing = conn.execute(
                    "SELECT id FROM eval_plan_set WHERE year=? AND effective_from_month=?",
                    (year, effective_month),
                ).fetchone()
                if existing:
                    plan_set_id = existing["id"]
                    conn.execute("UPDATE eval_plan_set SET change_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (change_reason, plan_set_id))
                    conn.execute("DELETE FROM eval_plan_item WHERE plan_set_id=?", (plan_set_id,))
                else:
                    cur = conn.execute(
                        "INSERT INTO eval_plan_set(year, effective_from_month, change_reason) VALUES (?,?,?)",
                        (year, effective_month, change_reason),
                    )
                    plan_set_id = cur.lastrowid
                for idx, item in enumerate(items):
                    indicator_code = str(item.get("indicator_code") or item.get("indicatorCode") or "").strip().upper()
                    group_code = str(item.get("group_code") or item.get("groupCode") or "").strip().upper()
                    mgmt_tool = "KPI"
                    if not indicator_code or not group_code:
                        raise ValueError("indicator_code and group_code are required")
                    crow = conn.execute(
                        """
                        SELECT ic.group_code, ic.perf_code, ic.display_name,
                               COALESCE(NULLIF(TRIM(cm.unit), ''), ic.unit, '') AS unit,
                               cm.definition_text AS common_definition_text,
                               cm.calc_logic_text AS common_calc_logic_text,
                               cm.dept AS common_dept,
                               cm.calc_cycle AS common_calc_cycle,
                               cm.calc_timing AS common_calc_timing,
                               cm.data_source_kind AS common_data_source_kind,
                               cm.data_source AS common_data_source,
                               ic.detailed_definition_text AS master_detailed_definition_text
                        FROM indicator_code ic
                        JOIN indicator_common cm ON cm.common_code = ic.common_code
                        WHERE ic.indicator_code=?
                        """,
                        (indicator_code,),
                    ).fetchone()
                    if not crow:
                        raise ValueError(f"indicator_code not found: {indicator_code}")
                    merged_def = merge_definition(
                        {
                            "unit": crow["unit"],
                            "definition_text": crow["common_definition_text"],
                            "calc_logic_text": crow["common_calc_logic_text"],
                            "dept": crow["common_dept"],
                            "calc_cycle": crow["common_calc_cycle"],
                            "calc_timing": crow["common_calc_timing"],
                            "data_source_kind": crow["common_data_source_kind"],
                            "data_source": crow["common_data_source"],
                        },
                        {
                            "detailed_definition_text": crow["master_detailed_definition_text"],
                        },
                    )
                    # 평가배치 group_code ≠ 지표마스터 소유그룹 허용
                    # (예: CSG 소유 지표코드를 S22 평가체계에 편성)
                    contribution_mode = normalize_contribution_mode(
                        item.get("contribution_mode")
                        or item.get("contributionMode")
                        or item.get("기여방식")
                    )
                    if contribution_mode == CONTRIB_ADJUST and group_code == BANK_GROUP_CODE:
                        raise ValueError("전행(SHB)에는 내부통제 가감(ADJUST) 지표를 편성할 수 없습니다")
                    weight = float(item.get("weight") or item.get("가중치") or 0)
                    if contribution_mode == CONTRIB_ADJUST:
                        weight = 0.0
                    monthly_target, custom_monthly_json = resolve_monthly_targets_for_save(item, year, effective_month)
                    conn.execute(
                        """
                        INSERT INTO eval_plan_item(
                          plan_set_id, group_code, indicator_code, mgmt_tool,
                          eval_category_lv1, eval_category_lv2, eval_category_lv3,
                          label, unit, weight, is_core, annual_target, monthly_target, baseline_actual,
                          collect_type, dept, data_source, definition_text, calc_logic_text,
                          h1_target, h2_target, score_rule, penalty_rule, cap_max, cap_min, remark, adj_band,
                          filters_json, formula_id, achievement_mode, goal_direction,
                          custom_achievement_expr, custom_monthly_targets_json,
                          sort_order, use_yn, contribution_mode
                        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        """,
                        (
                            plan_set_id,
                            group_code,
                            indicator_code,
                            mgmt_tool,
                            str(item.get("eval_category_lv1") or item.get("evalCategoryLv1") or item.get("평가Lv1") or item.get("분야") or "").strip(),
                            str(item.get("eval_category_lv2") or item.get("evalCategoryLv2") or item.get("평가Lv2") or item.get("세부분야") or "").strip(),
                            str(item.get("eval_category_lv3") or item.get("evalCategoryLv3") or item.get("평가Lv3") or "").strip(),
                            str(item.get("label") or item.get("표시명") or item.get("지표명") or crow["display_name"] or "").strip(),
                            str(item.get("unit") or item.get("단위") or crow["unit"] or merged_def.get("unit") or "").strip(),
                            weight,
                            _parse_core_yn(item),
                            float(item.get("annual_target") or item.get("annualTarget") or item.get("연간목표") or 0),
                            monthly_target,
                            float(item.get("baseline_actual") or item.get("baselineActual") or item.get("기준실적") or 0),
                            coalesce_eval_text(
                                item.get("collect_type") or item.get("collectType"),
                                "",
                            ),
                            coalesce_eval_text(
                                item.get("dept") or item.get("부서명"),
                                merged_def.get("dept") or "",
                            ),
                            coalesce_eval_text(
                                item.get("data_source") or item.get("dataSource") or item.get("데이터원천"),
                                (
                                    f"{merged_def.get('data_source_kind') or ''}"
                                    + (f" / {merged_def.get('data_source')}" if merged_def.get("data_source") else "")
                                ).strip(" /"),
                            ),
                            coalesce_eval_text(
                                item.get("definition_text") or item.get("definitionText"),
                                merged_def.get("definition_text_combined") or merged_def.get("definition_text") or "",
                            ),
                            coalesce_eval_text(
                                item.get("calc_logic_text") or item.get("calcLogicText"),
                                merged_def.get("calc_logic_text") or "",
                            ),
                            _opt_float(item, "h1_target", "h1Target", "상반기목표"),
                            _opt_float(item, "h2_target", "h2Target", "하반기목표"),
                            str(item.get("score_rule") or item.get("scoreRule") or item.get("기본승수") or item.get("배점기준") or "").strip(),
                            str(item.get("penalty_rule") or item.get("penaltyRule") or item.get("조정승수") or item.get("감점기준") or "").strip(),
                            _opt_float(item, "cap_max", "capMax", "상한"),
                            _opt_float(item, "cap_min", "capMin", "하한"),
                            coalesce_eval_text(
                                item.get("remark") or item.get("비고"),
                                "",
                            ),
                            str(item.get("adj_band") or item.get("adjBand") or item.get("조정구간") or "").strip(),
                            serialize_filters(item),
                            _opt_int(item, "formula_id", "formulaId"),
                            str(item.get("achievement_mode") or item.get("achievementMode") or item.get("산식구분") or "linear").strip().lower(),
                            str(item.get("goal_direction") or item.get("goalDirection") or item.get("목표방향") or "increase").strip(),
                            str(item.get("custom_achievement_expr") or item.get("customAchievementExpr") or "").strip(),
                            custom_monthly_json,
                            _coerce_sort_order(item, idx),
                            str(item.get("use_yn") or item.get("useYn") or "Y").strip() or "Y",
                            contribution_mode,
                        ),
                    )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
        with get_connection() as conn:
            return read_eval_config(conn, year, effective_month)

    def _import_eval_workbook(self, year: int, month: int, body: dict | None = None):
        ctype = self.headers.get("Content-Type") or ""
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        tmp_path = None
        try:
            if "multipart/form-data" in ctype:
                file_bytes = extract_multipart_file(ctype, raw, "file")
                if not file_bytes:
                    raise ValueError("file is required")
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
                tmp.write(file_bytes)
                tmp.close()
                tmp_path = Path(tmp.name)
            elif "application/json" in ctype and raw:
                payload = json.loads(raw.decode("utf-8"))
                xlsx = payload.get("xlsx")
                if not xlsx:
                    raise ValueError("xlsx path required")
                tmp_path = Path(xlsx)
            else:
                raise ValueError("multipart/form-data file upload required")

            items = parse_eval_workbook(tmp_path)
            reason = str((body or {}).get("changeReason") or "엑셀 업로드").strip()
            return self._replace_eval_configs(year, month, items, reason)
        finally:
            if tmp_path and tmp_path.exists() and tmp_path != TEMPLATE_PATH and "tmp" in tmp_path.name.lower():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

    def _seed_eval_defaults(self, body):
        year = coerce_year(body.get("year"))
        month = coerce_month(body.get("month"))
        items = body.get("items")
        if not isinstance(items, list):
            raise ValueError("items(list) is required for seed-defaults")
        return self._replace_eval_configs(year, month, items, str(body.get("changeReason") or "기본값 생성"))

    def _read_eval_history(self, year: int):
        with get_connection() as conn:
            rows = rows_to_list(
                conn.execute(
                    """
                    SELECT
                      s.id AS plan_set_id,
                      s.year,
                      s.effective_from_month,
                      s.change_reason,
                      s.created_at,
                      s.updated_at,
                      COUNT(e.id) AS item_count
                    FROM eval_plan_set s
                    LEFT JOIN eval_plan_item e ON e.plan_set_id = s.id
                    WHERE s.year=?
                    GROUP BY s.id, s.year, s.effective_from_month, s.change_reason, s.created_at, s.updated_at
                    ORDER BY s.effective_from_month
                    """,
                    (year,),
                )
            )
        return rows

    # ── GET ──
    def do_GET(self):
        path, qs = self.parse_path()
        try:
            if path == "/api/health":
                with get_connection() as conn:
                    self.send_json({"ok": True, "service": "kpi-api", "port": PORT, "counts": counts(conn)})
                return
            if path == "/api":
                self.send_json({
                    "endpoints": [
                        "/api/health",
                        "/api/codes/lv1",
                        "/api/codes/lv2?lv1=",
                        "/api/codes/lv2/next",
                        "/api/owner-groups",
                        "/api/indicators/common",
                        "/api/indicators/common/next-lv3",
                        "/api/indicators/codes",
                        "/api/indicators/preview-code",
                        "/api/codes/import",
                        "/api/codes/export",
                        "/api/eval-configs?year=&month=",
                        "/api/eval-configs/years",
                        "/api/eval-configs/history?year=",
                        "/api/eval-configs/template",
                        "/api/eval-configs/export?year=&month=",
                        "/api/eval-configs/seed-defaults",
                        "/api/eval-configs/import?year=&month=",
                        "/api/auth/sms/send",
                        "/api/auth/sms/verify",
                        "/api/facts/refresh?year=&month=",
                        "/api/facts/collect?ym=",
                        "/api/facts/calc?ym=",
                        "/api/facts/upload-template",
                        "/api/facts/upload (preview)",
                        "/api/facts/uploads/{id}/confirm",
                        "/api/facts/uploads/{id}/cancel",
                        "/api/facts/uploads",
                        "/api/facts/uploads/{id}/items",
                        "/api/facts/uploads/{id}/logs",
                        "/api/facts/uploads/export-pending",
                        "/api/facts/dept-entry?year=&month=&dept=",
                        "/api/facts/dept-entry/depts?year=&month=",
                        "/api/facts/dept-entry/export?year=&month=&dept=",
                        "/api/facts/dept-entry/import?year=&month=&dept=",
                        "/api/achievements?year=&month=",
                        "/api/fact-formulas",
                        "/api/fact-formulas/preview?year=&month=",
                        "/api/bank-export?year=&month=",
                        "/api/bank-export/history?year=",
                        "/api/bank-export/{id}/items",
                    ],
                })
                return
            if path == "/api/codes/lv1":
                with get_connection() as conn:
                    cur = conn.execute("SELECT code, name, sort_order, use_yn FROM code_lv1 ORDER BY sort_order, code")
                    self.send_json({"items": rows_to_list(cur)})
                return
            if path == "/api/codes/lv2/next":
                from migrate_lv2_independent import next_lv2_code
                with get_connection() as conn:
                    self.send_json({"lv2_code": next_lv2_code(conn)})
                return
            if path == "/api/codes/lv2":
                with get_connection() as conn:
                    cur = conn.execute(
                        "SELECT code, name, sort_order, use_yn FROM code_lv2 ORDER BY sort_order, code"
                    )
                    self.send_json({"items": rows_to_list(cur)})
                return
            if path == "/api/owner-groups":
                eval_only = str(qs.get("eval_only") or qs.get("evalOnly") or "").lower() in ("1", "true", "y")
                with get_connection() as conn:
                    sql = (
                        "SELECT code, name, sort_order, use_yn, org_level, parent_code "
                        "FROM owner_group WHERE 1=1"
                    )
                    if eval_only:
                        placeholders = ",".join("?" for _ in EVAL_ORG_LEVELS)
                        sql += f" AND org_level IN ({placeholders})"
                        params = tuple(sorted(EVAL_ORG_LEVELS))
                    else:
                        params = ()
                    sql += " ORDER BY sort_order, code"
                    cur = conn.execute(sql, params)
                    self.send_json({"items": rows_to_list(cur)})
                return
            if path == "/api/indicators/common/next-lv3":
                from migrate_lv3_unique import next_lv3_code
                with get_connection() as conn:
                    self.send_json({"lv3_code": next_lv3_code(conn)})
                return
            if path == "/api/indicators/common":
                with get_connection() as conn:
                    cur = conn.execute(
                        """SELECT common_code, lv1_code, lv2_code, lv3_code, name,
                                  unit, common_yn, use_yn,
                                  definition_text, calc_logic_text, owner_group_code, dept,
                                  calc_cycle, calc_timing, data_source_kind, data_source
                           FROM indicator_common ORDER BY common_code"""
                    )
                    self.send_json({"items": rows_to_list(cur)})
                return
            if path == "/api/indicators/codes":
                group = (qs.get("group") or "").strip().upper()
                common = (qs.get("common") or "").strip().upper()
                sql = code_lookup_query() + " WHERE 1=1"
                params = []
                if group:
                    sql += " AND ic.group_code=?"
                    params.append(group)
                if common:
                    sql += " AND ic.common_code=?"
                    params.append(common)
                sql += " ORDER BY ic.indicator_code"
                with get_connection() as conn:
                    self.send_json({"items": enrich_code_rows(rows_to_list(conn.execute(sql, params)))})
                return
            if path == "/api/eval-configs":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                group = (qs.get("group") or "").strip().upper() or None
                with get_connection() as conn:
                    self.send_json(read_eval_config(conn, year, month, group))
                return
            if path == "/api/eval-configs/years":
                with get_connection() as conn:
                    rows = conn.execute(
                        """
                        SELECT DISTINCT s.year AS year
                        FROM eval_plan_set s
                        WHERE EXISTS (
                          SELECT 1 FROM eval_plan_item e WHERE e.plan_set_id = s.id
                        )
                        ORDER BY s.year DESC
                        """
                    ).fetchall()
                    years = [int(r["year"]) for r in rows]
                    self.send_json({"years": years})
                return
            if path == "/api/eval-configs/history":
                year = coerce_year(qs.get("year"))
                self.send_json({"items": self._read_eval_history(year)})
                return
            if path == "/api/eval-configs/template":
                target = write_template(TEMPLATE_PATH)
                self.send_file(target, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "eval_plan_upload_template.xlsx")
                return
            if path == "/api/eval-configs/export":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                group = (qs.get("group") or "").strip().upper() or None
                with get_connection() as conn:
                    payload = read_eval_config(conn, year, month, group)
                export_name = f"eval_plan_{year}_{month:02d}.xlsx"
                target = Path(__file__).resolve().parent / "data" / export_name
                export_eval_items(payload.get("items") or [], target)
                self.send_file(
                    target,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    export_name,
                )
                return
            if path == "/api/codes/export":
                target = export_workbook()
                self.send_file(
                    target,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "kpi_code_master_export.xlsx",
                )
                return
            if path == "/api/facts/upload-template":
                target = write_fact_upload_template(FACT_UPLOAD_TEMPLATE_PATH)
                self.send_file(
                    target,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "fact_upload_template.xlsx",
                )
                return
            if path == "/api/facts/dept-entry/depts":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                with get_connection() as conn:
                    self.send_json({"year": year, "month": month, "items": list_distinct_depts(conn, year, month)})
                return
            if path == "/api/facts/period-status":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                with get_connection() as conn:
                    self.send_json(get_period_status(conn, year, month))
                return
            if path == "/api/facts/dept-entry":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                dept = str(qs.get("dept") or "").strip()
                group = str(qs.get("group") or qs.get("group_code") or "").strip().upper()
                scope = str(qs.get("scope") or "").strip().lower()
                scope_all = scope in ("all", "1", "true", "yes") or (
                    qs.get("all") in ("1", "true", "yes")
                )
                with get_connection() as conn:
                    if scope_all:
                        self.send_json(list_all_fact_entries(conn, year, month))
                    elif group:
                        self.send_json(list_group_fact_entries(conn, year, month, group_code=group))
                    else:
                        self.send_json(list_dept_fact_entries(conn, year, month, dept=dept))
                return
            if path == "/api/facts/dept-entry/export":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                dept = str(qs.get("dept") or "").strip()
                group = str(qs.get("group") or qs.get("group_code") or "").strip().upper()
                scope = str(qs.get("scope") or "").strip().lower()
                scope_all = scope in ("all", "1", "true", "yes")
                with get_connection() as conn:
                    target = write_dept_entry_workbook(
                        conn, year, month, dept=dept, group_code=group, scope_all=scope_all,
                    )
                safe = re.sub(r"[^\w\-]+", "_", ("all" if scope_all else (group or dept)))[:40] or "scope"
                self.send_file(
                    target,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    f"dept_fact_{safe}_{year}{month:02d}.xlsx",
                )
                return
            if path == "/api/facts/uploads":
                limit = int(qs.get("limit") or 50)
                with get_connection() as conn:
                    batches = list_upload_batches(conn, limit=limit)
                    for b in batches:
                        if isinstance(b.get("counts_json"), str):
                            try:
                                b["counts"] = json.loads(b["counts_json"] or "{}")
                            except Exception:
                                b["counts"] = {}
                    self.send_json({"items": batches})
                return
            if path.startswith("/api/facts/uploads/") and path.endswith("/items"):
                parts = [p for p in path.split("/") if p]
                # api facts uploads {id} items
                if len(parts) == 5 and parts[3].isdigit():
                    batch_id = int(parts[3])
                    with get_connection() as conn:
                        batch = conn.execute(
                            "SELECT * FROM fact_upload_batch WHERE id=?", (batch_id,)
                        ).fetchone()
                        if not batch:
                            self.send_json({"error": "not_found"}, 404)
                            return
                        b = dict(batch)
                        try:
                            b["counts"] = json.loads(b.get("counts_json") or "{}")
                        except Exception:
                            b["counts"] = {}
                        items = list_upload_items(conn, batch_id)
                        self.send_json({"batch": b, "items": items})
                    return
            if path.startswith("/api/facts/uploads/") and path.endswith("/logs"):
                parts = [p for p in path.split("/") if p]
                if len(parts) == 5 and parts[3].isdigit():
                    batch_id = int(parts[3])
                    with get_connection() as conn:
                        logs = list_upload_change_logs(conn, batch_id, limit=500)
                        self.send_json({"batch_id": batch_id, "items": logs})
                    return
            if path == "/api/achievements":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                group = (qs.get("group") or "").strip().upper() or None
                ym = to_eval_ym(year, month)
                sql = """
                    SELECT a.*, og.name AS group_name
                    FROM achievement_result a
                    LEFT JOIN owner_group og ON og.code = a.group_code
                    WHERE a.eval_ym=?
                """
                params = [ym]
                if group:
                    sql += " AND a.group_code=?"
                    params.append(group)
                sql += " ORDER BY a.group_code, a.indicator_code"
                with get_connection() as conn:
                    items = rows_to_list(conn.execute(sql, params))
                    self.send_json({"year": year, "month": month, "eval_ym": ym, "items": items})
                return
            if path == "/api/group-scores":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                with get_connection() as conn:
                    items = list_group_scores(conn, year, month)
                    if not items:
                        # 캐시 없으면 즉시 산출
                        recompute_group_scores(conn, year, month)
                        conn.commit()
                        items = list_group_scores(conn, year, month)
                    resolved = resolve_score_rollup_detail(conn, year, month)
                self.send_json({
                    "year": year,
                    "month": month,
                    "eval_ym": to_eval_ym(year, month),
                    "rollup": resolved,
                    "items": items,
                })
                return
            if path == "/api/score-rollups":
                year = coerce_year(qs.get("year"))
                month_raw = qs.get("month")
                with get_connection() as conn:
                    if month_raw not in (None, ""):
                        month = coerce_month(month_raw)
                        detail = resolve_score_rollup_detail(conn, year, month)
                        self.send_json({"year": year, "month": month, "item": detail, "items": list_score_rollups(conn, year)})
                    else:
                        self.send_json({"year": year, "items": list_score_rollups(conn, year)})
                return
            if path == "/api/facts/collect":
                ym = (qs.get("ym") or "").strip()
                if not ym:
                    ym = to_eval_ym(coerce_year(qs.get("year")), coerce_month(qs.get("month")))
                with get_connection() as conn:
                    items = rows_to_list(conn.execute(
                        "SELECT * FROM fact_collect WHERE eval_ym=? ORDER BY indicator_code", (ym,)
                    ))
                    self.send_json({"eval_ym": ym, "items": items})
                return
            if path == "/api/facts/calc":
                ym = (qs.get("ym") or "").strip()
                if not ym:
                    ym = to_eval_ym(coerce_year(qs.get("year")), coerce_month(qs.get("month")))
                group = (qs.get("group") or "").strip().upper() or None
                sql = """
                    SELECT c.*, f.name AS formula_name
                    FROM fact_calc c
                    LEFT JOIN fact_formula f ON f.id = c.formula_id
                    WHERE c.eval_ym=?
                """
                params = [ym]
                if group:
                    sql += " AND c.group_code=?"
                    params.append(group)
                sql += " ORDER BY c.group_code, c.indicator_code"
                with get_connection() as conn:
                    self.send_json({"eval_ym": ym, "items": rows_to_list(conn.execute(sql, params))})
                return
            if path == "/api/fact-formulas":
                with get_connection() as conn:
                    self.send_json({"items": rows_to_list(conn.execute(
                        "SELECT * FROM fact_formula ORDER BY id"
                    ))})
                return
            if path == "/api/bank-export/history":
                year = coerce_year(qs.get("year"))
                prefix = f"{year}%"
                with get_connection() as conn:
                    items = rows_to_list(conn.execute(
                        """
                        SELECT * FROM bank_export_batch
                        WHERE eval_ym LIKE ?
                        ORDER BY id DESC
                        """,
                        (prefix,),
                    ))
                    self.send_json({"year": year, "items": items})
                return
            if path.startswith("/api/bank-export/") and path.endswith("/items"):
                parts = [p for p in path.split("/") if p]
                # api bank-export {id} items
                if len(parts) == 4 and parts[2].isdigit():
                    batch_id = int(parts[2])
                    with get_connection() as conn:
                        batch = conn.execute(
                            "SELECT * FROM bank_export_batch WHERE id=?", (batch_id,)
                        ).fetchone()
                        if not batch:
                            self.send_json({"error": "not_found"}, 404)
                            return
                        items = rows_to_list(conn.execute(
                            """
                            SELECT * FROM bank_export_item
                            WHERE batch_id=?
                            ORDER BY group_code, indicator_code
                            """,
                            (batch_id,),
                        ))
                        self.send_json({"batch": dict(batch), "items": items})
                    return
            self.send_json({"error": "not_found", "path": path}, 404)
        except ValueError as e:
            self.send_json({"error": "validation", "message": str(e)}, 400)
        except Exception as e:
            self.send_json({"error": "server_error", "message": str(e)}, 500)

    # ── POST ──
    def do_POST(self):
        path, qs = self.parse_path()
        try:
            if path == "/api/indicators/preview-code":
                body = self.read_json()
                code = compose_indicator_code(
                    body.get("lv1_code"), body.get("lv2_code"), body.get("lv3_code"),
                    body.get("perf_code"), body.get("group_code"),
                )
                self.send_json({"indicator_code": code})
                return
            if path == "/api/codes/import":
                self._handle_import()
                return
            if path == "/api/eval-configs/seed-defaults":
                seeded = self._seed_eval_defaults(self.read_json())
                self.send_json({"ok": True, **seeded})
                return
            if path == "/api/eval-configs/import":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                imported = self._import_eval_workbook(year, month)
                self.send_json({"ok": True, **imported})
                return
            if path == "/api/facts/refresh":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                with get_connection() as conn:
                    result = refresh_facts(conn, year, month)
                self.send_json(result)
                return
            if path == "/api/auth/sms/send":
                # 운영: 행내 SMS 게이트웨이 연동. POC는 demo_code 반환.
                body = self.read_json() or {}
                emp = str(body.get("employee_no") or body.get("employeeNo") or "").strip()
                if not re.fullmatch(r"\d{8}", emp):
                    self.send_json({"error": "validation", "message": "employee_no(8 digits) required"}, 400)
                    return
                import random
                code = f"{random.randint(100000, 999999)}"
                request_id = f"sms-{int(time.time() * 1000)}"
                self.send_json({
                    "ok": True,
                    "request_id": request_id,
                    "expires_in_sec": 180,
                    "masked_phone": f"010-****-{emp[-4:]}",
                    "demo_code": code,
                    "note": "POC stub — 실발송 미연동. 운영 시 demo_code 제거 및 SMS GW 호출",
                })
                return
            if path == "/api/auth/sms/verify":
                body = self.read_json() or {}
                emp = str(body.get("employee_no") or body.get("employeeNo") or "").strip()
                code = str(body.get("code") or "").strip()
                request_id = str(body.get("request_id") or body.get("requestId") or "").strip()
                if not re.fullmatch(r"\d{8}", emp) or not re.fullmatch(r"\d{6}", code):
                    self.send_json({"ok": False, "error": "validation", "message": "employee_no + 6-digit code required"}, 400)
                    return
                # POC: 서버 측 OTP 저장소 없음 — 클라이언트 검증이 정본. 운영 시 Redis/DB 대조.
                self.send_json({
                    "ok": True,
                    "employee_no": emp,
                    "request_id": request_id,
                    "note": "POC accept-any when client already verified; wire to SMS OTP store in production",
                })
                return
            if path == "/api/facts/upload":
                result = self._import_fact_upload()
                self.send_json(result, 200 if result.get("ok") else 400)
                return
            if path == "/api/facts/dept-entry":
                body = self.read_json() or {}
                year = coerce_year(qs.get("year") or body.get("year"))
                month = coerce_month(qs.get("month") or body.get("month"))
                dept = str(qs.get("dept") or body.get("dept") or "").strip()
                group = str(qs.get("group") or body.get("group") or body.get("group_code") or "").strip().upper()
                scope = str(qs.get("scope") or body.get("scope") or "").strip().lower()
                scope_all = scope in ("all", "1", "true", "yes") or bool(body.get("scope_all") or body.get("scopeAll"))
                updates = body.get("updates") or body.get("items") or []
                acted_by = str(body.get("acted_by") or body.get("actedBy") or "ui")
                actor_role = str(body.get("actor_role") or body.get("actorRole") or "").strip().lower()
                if not isinstance(updates, list):
                    self.send_json({"error": "validation", "message": "updates(list) required"}, 400)
                    return
                with get_connection() as conn:
                    result = save_dept_fact_entries(
                        conn, year, month,
                        dept=dept, group_code=group, scope_all=scope_all, updates=updates,
                        acted_by=acted_by, actor_role=actor_role, refresh=True,
                    )
                self.send_json(result)
                return
            if path == "/api/facts/group-confirm":
                body = self.read_json() or {}
                year = coerce_year(qs.get("year") or body.get("year"))
                month = coerce_month(qs.get("month") or body.get("month"))
                group = str(body.get("group_code") or body.get("group") or qs.get("group") or "").strip().upper()
                acted_by = str(body.get("acted_by") or body.get("actedBy") or "ui")
                note = str(body.get("note") or "")
                with get_connection() as conn:
                    self.send_json(confirm_group(conn, year, month, group_code=group, acted_by=acted_by, note=note))
                return
            if path == "/api/facts/group-confirm/revoke":
                body = self.read_json() or {}
                year = coerce_year(qs.get("year") or body.get("year"))
                month = coerce_month(qs.get("month") or body.get("month"))
                group = str(body.get("group_code") or body.get("group") or "").strip().upper()
                acted_by = str(body.get("acted_by") or body.get("actedBy") or "ui")
                note = str(body.get("note") or "")
                with get_connection() as conn:
                    self.send_json(revoke_group_confirm(conn, year, month, group_code=group, acted_by=acted_by, note=note))
                return
            if path == "/api/facts/period/freeze":
                body = self.read_json() or {}
                year = coerce_year(qs.get("year") or body.get("year"))
                month = coerce_month(qs.get("month") or body.get("month"))
                acted_by = str(body.get("acted_by") or body.get("actedBy") or "ui")
                note = str(body.get("note") or "")
                require_all = bool(body.get("require_all_confirmed") or body.get("requireAllConfirmed"))
                with get_connection() as conn:
                    self.send_json(freeze_period(
                        conn, year, month, acted_by=acted_by, note=note, require_all_confirmed=require_all,
                    ))
                return
            if path == "/api/facts/period/unfreeze":
                body = self.read_json() or {}
                year = coerce_year(qs.get("year") or body.get("year"))
                month = coerce_month(qs.get("month") or body.get("month"))
                acted_by = str(body.get("acted_by") or body.get("actedBy") or "ui")
                note = str(body.get("note") or "")
                with get_connection() as conn:
                    self.send_json(unfreeze_period(conn, year, month, acted_by=acted_by, note=note))
                return
            if path == "/api/facts/dept-entry/import":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                dept = str(qs.get("dept") or "").strip()
                group = str(qs.get("group") or qs.get("group_code") or "").strip().upper()
                actor_role = str(qs.get("actor_role") or "").strip().lower()
                scope = str(qs.get("scope") or "").strip().lower()
                scope_all = scope in ("all", "1", "true", "yes")
                result = self._import_dept_fact_entry(
                    year, month, dept, group_code=group, actor_role=actor_role, scope_all=scope_all,
                )
                self.send_json(result, 200 if result.get("ok") else 400)
                return
            if path.startswith("/api/facts/uploads/") and path.endswith("/confirm"):
                parts = [p for p in path.split("/") if p]
                if len(parts) == 5 and parts[3].isdigit():
                    batch_id = int(parts[3])
                    body = {}
                    try:
                        body = self.read_json() or {}
                    except Exception:
                        body = {}
                    acted_by = str(body.get("acted_by") or body.get("actedBy") or "ui")
                    with get_connection() as conn:
                        result = confirm_fact_upload(conn, batch_id, acted_by=acted_by, refresh=True)
                    self.send_json(result)
                    return
            if path.startswith("/api/facts/uploads/") and path.endswith("/cancel"):
                parts = [p for p in path.split("/") if p]
                if len(parts) == 5 and parts[3].isdigit():
                    batch_id = int(parts[3])
                    body = {}
                    try:
                        body = self.read_json() or {}
                    except Exception:
                        body = {}
                    acted_by = str(body.get("acted_by") or body.get("actedBy") or "ui")
                    with get_connection() as conn:
                        result = cancel_fact_upload(conn, batch_id, acted_by=acted_by)
                    self.send_json(result)
                    return
            if path == "/api/facts/uploads/export-pending":
                body = {}
                try:
                    body = self.read_json() or {}
                except Exception:
                    body = {}
                triggered = str(
                    (body or {}).get("triggered_by")
                    or (body or {}).get("triggeredBy")
                    or qs.get("triggered_by")
                    or "api"
                )
                with get_connection() as conn:
                    result = export_pending_uploads_to_bank(conn, triggered_by=triggered)
                self.send_json(result)
                return
            if path == "/api/group-scores/recompute":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                with get_connection() as conn:
                    result = recompute_group_scores(conn, year, month)
                    conn.commit()
                self.send_json(result)
                return
            if path == "/api/score-rollups":
                body = self.read_json()
                year = coerce_year(qs.get("year") or body.get("year"))
                month = coerce_month(qs.get("month") or body.get("effectiveMonth") or body.get("effective_from_month") or body.get("month"))
                rules = body.get("rules") if isinstance(body, dict) else None
                if not isinstance(rules, list):
                    self.send_json({"error": "validation", "message": "rules(list) required"}, 400)
                    return
                reason = str(body.get("changeReason") or body.get("change_reason") or "")
                with get_connection() as conn:
                    saved = replace_score_rollup(conn, year, month, rules, reason)
                    # 시행월 포함 이후 월 재계산은 호출측에서; 우선 시행월만
                    recompute_group_scores(conn, year, month)
                    conn.commit()
                    items = list_score_rollups(conn, year)
                self.send_json({"ok": True, **saved, "items": items})
                return
            if path == "/api/fact-formulas/preview":
                body = self.read_json()
                year = coerce_year(qs.get("year") or body.get("year"))
                month = coerce_month(qs.get("month") or body.get("month"))
                expr = str(body.get("expr") or "").strip()
                operands = parse_operands(
                    body.get("operands_json") or body.get("operandsJson") or body.get("operands") or {}
                )
                group = str(body.get("group_code") or body.get("groupCode") or qs.get("group") or "").strip() or None
                with get_connection() as conn:
                    result = preview_formula(
                        conn, year=year, month=month, expr=expr, operands=operands, group_code=group,
                    )
                self.send_json(result)
                return
            if path == "/api/bank-export":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                body = {}
                try:
                    body = self.read_json() or {}
                except Exception:
                    body = {}
                triggered = str((body or {}).get("triggered_by") or (body or {}).get("triggeredBy") or "api")
                with get_connection() as conn:
                    result = run_bank_export(conn, year, month, triggered_by=triggered)
                self.send_json(result)
                return
            if path == "/api/fact-formulas":
                body = self.read_json()
                name = str(body.get("name") or "").strip()
                output = str(body.get("output_indicator_code") or body.get("outputIndicatorCode") or "").strip().upper()
                expr = str(body.get("expr") or "").strip()
                operands = parse_operands(
                    body.get("operands_json") or body.get("operandsJson") or body.get("operands") or {}
                )
                use_yn = str(body.get("use_yn") or body.get("useYn") or "Y").strip().upper() or "Y"
                if use_yn not in ("Y", "N"):
                    use_yn = "Y"
                with get_connection() as conn:
                    validate_formula(conn, name=name, output=output, expr=expr, operands=operands)
                    cur = conn.execute(
                        """
                        INSERT INTO fact_formula(name, output_indicator_code, expr, operands_json, use_yn)
                        VALUES (?,?,?,?,?)
                        """,
                        (name, output, expr, operands_to_json(operands), use_yn),
                    )
                    conn.commit()
                    self.send_json({"ok": True, "id": cur.lastrowid}, 201)
                return
            if path == "/api/codes/lv1":
                body = self.read_json()
                code = str(body.get("code") or "").strip().upper()
                name = str(body.get("name") or "").strip()
                if not code or not name:
                    self.send_json({"error": "validation", "message": "code, name required"}, 400)
                    return
                with get_connection() as conn:
                    try:
                        conn.execute("INSERT INTO code_lv1(code, name, sort_order, use_yn) VALUES (?,?,?,?)", (code, name, int(body.get("sort_order") or 0), body.get("use_yn") or "Y"))
                        conn.commit()
                    except sqlite3.IntegrityError:
                        self.send_json({"error": "duplicate", "code": code}, 409)
                        return
                self.send_json({"ok": True, "code": code}, 201)
                return
            if path == "/api/codes/lv2":
                body = self.read_json()
                code = str(body.get("code") or "").strip()
                name = str(body.get("name") or "").strip()
                if not name:
                    self.send_json({"error": "validation", "message": "name required"}, 400)
                    return
                from migrate_lv2_independent import next_lv2_code
                with get_connection() as conn:
                    if not code:
                        code = next_lv2_code(conn)
                    elif not (len(code) == 4 and code.isdigit()):
                        self.send_json({"error": "validation", "message": "lv2 code must be 4 digits"}, 400)
                        return
                    elif conn.execute("SELECT 1 FROM code_lv2 WHERE code=?", (code,)).fetchone():
                        code = next_lv2_code(conn)
                    sort_order = body.get("sort_order")
                    sort_order = int(sort_order) if sort_order not in (None, "") else int(code)
                    try:
                        conn.execute(
                            "INSERT INTO code_lv2(code, name, sort_order, use_yn) VALUES (?,?,?,?)",
                            (code, name, sort_order, body.get("use_yn") or "Y"),
                        )
                        conn.commit()
                    except sqlite3.IntegrityError as e:
                        self.send_json({"error": "duplicate_or_fk", "message": str(e)}, 409)
                        return
                self.send_json({"ok": True, "code": code}, 201)
                return
            if path == "/api/owner-groups":
                body = self.read_json()
                code = str(body.get("code") or "").strip().upper()
                name = str(body.get("name") or "").strip()
                if not code or not name:
                    self.send_json({"error": "validation", "message": "code, name required"}, 400)
                    return
                use_yn = str(body.get("use_yn") or body.get("useYn") or "Y").strip().upper() or "Y"
                if use_yn not in ("Y", "N"):
                    use_yn = "Y"
                with get_connection() as conn:
                    try:
                        org_level, parent_code = validate_org_group_fields(
                            conn,
                            code=code,
                            org_level=body.get("org_level") or body.get("orgLevel") or "GROUP",
                            parent_code=body.get("parent_code") or body.get("parentCode"),
                        )
                        conn.execute(
                            """INSERT INTO owner_group(code, name, sort_order, use_yn, org_level, parent_code)
                               VALUES (?,?,?,?,?,?)""",
                            (
                                code, name, int(body.get("sort_order") or 0), use_yn,
                                org_level, parent_code,
                            ),
                        )
                        conn.commit()
                    except ValueError as e:
                        self.send_json({"error": "validation", "message": str(e)}, 400)
                        return
                    except sqlite3.IntegrityError:
                        self.send_json({"error": "duplicate", "code": code}, 409)
                        return
                self.send_json({"ok": True, "code": code}, 201)
                return
            if path == "/api/indicators/common":
                body = self.read_json()
                lv1 = str(body.get("lv1_code") or "").strip().upper()
                lv2 = str(body.get("lv2_code") or "").strip()
                lv3 = str(body.get("lv3_code") or "").strip()
                name = str(body.get("name") or "").strip()
                unit = str(body.get("unit") or "").strip()
                common_yn = str(body.get("common_yn") or "단독").strip()
                defs = pick_lv3_definition_fields(body)
                if not all([lv1, lv2, name]):
                    self.send_json({"error": "validation", "message": "lv1/lv2/name required"}, 400)
                    return
                from migrate_lv3_unique import next_lv3_code
                with get_connection() as conn:
                    if not lv3:
                        lv3 = next_lv3_code(conn)
                    elif not (len(lv3) == 4 and lv3.isdigit()):
                        self.send_json({"error": "validation", "message": "lv3_code must be 4 digits"}, 400)
                        return
                    elif conn.execute(
                        "SELECT 1 FROM indicator_common WHERE lv3_code=?", (lv3,)
                    ).fetchone():
                        lv3 = next_lv3_code(conn)
                    common = f"{lv1}-{lv2}-{lv3}"
                    try:
                        conn.execute(
                            """INSERT INTO indicator_common
                               (common_code, lv1_code, lv2_code, lv3_code, name, unit, allowed_perf, common_yn, use_yn,
                                definition_text, calc_logic_text, owner_group_code, dept, calc_cycle, calc_timing,
                                data_source_kind, data_source)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (
                                common, lv1, lv2, lv3, name, unit, "", common_yn, body.get("use_yn") or "Y",
                                defs["definition_text"], defs["calc_logic_text"],
                                defs["owner_group_code"], defs["dept"],
                                defs["calc_cycle"], defs["calc_timing"],
                                defs["data_source_kind"], defs["data_source"],
                            ),
                        )
                        conn.commit()
                    except sqlite3.IntegrityError as e:
                        self.send_json({"error": "duplicate_or_fk", "code": common, "message": str(e)}, 409)
                        return
                self.send_json({"ok": True, "common_code": common, "lv3_code": lv3}, 201)
                return
            if path == "/api/indicators/codes":
                self._create_indicator_code(self.read_json())
                return
            self.send_json({"error": "not_found", "path": path}, 404)
        except ValueError as e:
            self.send_json({"error": "validation", "message": str(e)}, 400)
        except Exception as e:
            self.send_json({"error": "server_error", "message": str(e)}, 500)

    # ── PUT ──
    def do_PUT(self):
        path, qs = self.parse_path()
        parts = path.strip("/").split("/")
        try:
            body = self.read_json()
            if path == "/api/eval-configs":
                year = coerce_year(qs.get("year"))
                month = coerce_month(qs.get("month"))
                items = body.get("items") if isinstance(body, dict) else None
                if not isinstance(items, list):
                    self.send_json({"error": "validation", "message": "items(list) required"}, 400)
                    return
                saved = self._replace_eval_configs(year, month, items, str(body.get("changeReason") or ""))
                self.send_json({"ok": True, **saved})
                return
            if path.startswith("/api/fact-formulas/") and len(parts) == 3:
                fid = int(parts[2])
                name = str(body.get("name") or "").strip()
                output = str(body.get("output_indicator_code") or body.get("outputIndicatorCode") or "").strip().upper()
                expr = str(body.get("expr") or "").strip()
                operands = parse_operands(
                    body.get("operands_json") or body.get("operandsJson") or body.get("operands") or {}
                )
                use_yn = str(body.get("use_yn") or body.get("useYn") or "Y").strip().upper() or "Y"
                if use_yn not in ("Y", "N"):
                    use_yn = "Y"
                with get_connection() as conn:
                    validate_formula(
                        conn, name=name, output=output, expr=expr, operands=operands, exclude_id=fid,
                    )
                    cur = conn.execute(
                        """
                        UPDATE fact_formula
                        SET name=?, output_indicator_code=?, expr=?, operands_json=?, use_yn=?, updated_at=CURRENT_TIMESTAMP
                        WHERE id=?
                        """,
                        (name, output, expr, operands_to_json(operands), use_yn, fid),
                    )
                    conn.commit()
                    if cur.rowcount == 0:
                        self.send_json({"error": "not_found"}, 404)
                        return
                self.send_json({"ok": True, "id": fid})
                return
            if path.startswith("/api/codes/lv1/") and len(parts) == 4:
                code = parts[3].upper()
                with get_connection() as conn:
                    cur = conn.execute("UPDATE code_lv1 SET name=?, sort_order=?, use_yn=? WHERE code=?", (str(body.get("name") or "").strip(), int(body.get("sort_order") or 0), body.get("use_yn") or "Y", code))
                    conn.commit()
                    if cur.rowcount == 0:
                        self.send_json({"error": "not_found"}, 404)
                        return
                self.send_json({"ok": True, "code": code})
                return
            if path.startswith("/api/codes/lv2/") and len(parts) == 4:
                code = parts[3]
                with get_connection() as conn:
                    cur = conn.execute(
                        "UPDATE code_lv2 SET name=?, sort_order=?, use_yn=? WHERE code=?",
                        (
                            str(body.get("name") or "").strip(),
                            int(body.get("sort_order") or 0),
                            body.get("use_yn") or "Y",
                            code,
                        ),
                    )
                    conn.commit()
                    if cur.rowcount == 0:
                        self.send_json({"error": "not_found"}, 404)
                        return
                self.send_json({"ok": True, "code": code})
                return
            if path.startswith("/api/owner-groups/") and len(parts) == 3:
                code = parts[2].upper()
                with get_connection() as conn:
                    existing = conn.execute(
                        "SELECT name, sort_order, org_level, parent_code FROM owner_group WHERE code=?",
                        (code,),
                    ).fetchone()
                    if not existing:
                        self.send_json({"error": "not_found"}, 404)
                        return
                    use_yn = str(body.get("use_yn") or body.get("useYn") or "Y").strip().upper() or "Y"
                    if use_yn not in ("Y", "N"):
                        use_yn = "Y"
                    name = str(body.get("name") or "").strip() or existing["name"]
                    sort_order = body.get("sort_order")
                    if sort_order is None:
                        sort_order = body.get("sortOrder")
                    sort_order = int(sort_order if sort_order is not None else existing["sort_order"] or 0)
                    org_in = body.get("org_level") or body.get("orgLevel")
                    parent_in = body.get("parent_code") if "parent_code" in body else body.get("parentCode")
                    org_level_raw = org_in if org_in is not None else existing["org_level"]
                    parent_raw = parent_in if parent_in is not None else existing["parent_code"]
                    try:
                        org_level, parent_code = validate_org_group_fields(
                            conn,
                            code=code,
                            org_level=org_level_raw,
                            parent_code=parent_raw,
                            is_update=True,
                        )
                    except ValueError as e:
                        self.send_json({"error": "validation", "message": str(e)}, 400)
                        return
                    cur = conn.execute(
                        """UPDATE owner_group
                           SET name=?, sort_order=?, use_yn=?, org_level=?, parent_code=?
                           WHERE code=?""",
                        (
                            name,
                            sort_order,
                            use_yn,
                            org_level,
                            parent_code,
                            code,
                        ),
                    )
                    conn.commit()
                    if cur.rowcount == 0:
                        self.send_json({"error": "not_found"}, 404)
                        return
                self.send_json({"ok": True, "code": code})
                return
            if path.startswith("/api/indicators/common/") and len(parts) == 4:
                common = parts[3].upper()
                with get_connection() as conn:
                    unit = str(body.get("unit") or "").strip()
                    defs = pick_lv3_definition_fields(body)
                    cur = conn.execute(
                        """UPDATE indicator_common
                           SET name=?, unit=?, common_yn=?, use_yn=?,
                               definition_text=?, calc_logic_text=?, owner_group_code=?, dept=?,
                               calc_cycle=?, calc_timing=?,
                               data_source_kind=?, data_source=?
                           WHERE common_code=?""",
                        (
                            str(body.get("name") or "").strip(),
                            unit,
                            body.get("common_yn") or "단독",
                            body.get("use_yn") or "Y",
                            defs["definition_text"], defs["calc_logic_text"],
                            defs["owner_group_code"], defs["dept"],
                            defs["calc_cycle"], defs["calc_timing"],
                            defs["data_source_kind"], defs["data_source"],
                            common,
                        ),
                    )
                    if cur.rowcount == 0:
                        conn.commit()
                        self.send_json({"error": "not_found"}, 404)
                        return
                    conn.execute(
                        "UPDATE indicator_code SET unit=? WHERE common_code=?",
                        (unit, common),
                    )
                    conn.commit()
                self.send_json({"ok": True, "common_code": common})
                return
            if path.startswith("/api/indicators/codes/") and len(parts) == 4:
                code = parts[3].upper()
                defs = pick_master_definition_fields({
                    **body,
                    "owner_group_code": body.get("owner_group_code", body.get("ownerGroupCode", "")),
                    "dept": body.get("dept", ""),
                })
                with get_connection() as conn:
                    cur = conn.execute(
                        """UPDATE indicator_code
                           SET display_name=?, use_yn=?, detailed_definition_text=?,
                               owner_group_code=?, dept=?
                           WHERE indicator_code=?""",
                        (
                            str(body.get("display_name") or "").strip(),
                            body.get("use_yn") or "Y",
                            defs["detailed_definition_text"],
                            defs.get("owner_group_code", ""),
                            defs.get("dept", ""),
                            code,
                        ),
                    )
                    conn.commit()
                    if cur.rowcount == 0:
                        self.send_json({"error": "not_found"}, 404)
                        return
                self.send_json({"ok": True, "indicator_code": code})
                return
            self.send_json({"error": "not_found", "path": path}, 404)
        except ValueError as e:
            self.send_json({"error": "validation", "message": str(e)}, 400)
        except sqlite3.IntegrityError as e:
            self.send_json({"error": "duplicate_or_fk", "message": str(e)}, 409)
        except Exception as e:
            self.send_json({"error": "server_error", "message": str(e)}, 500)

    # ── DELETE ──
    def do_DELETE(self):
        path, qs = self.parse_path()
        parts = path.strip("/").split("/")
        try:
            if path == "/api/eval-configs":
                plan_set_id = int(qs.get("planSetId") or qs.get("plan_set_id") or 0)
                if plan_set_id <= 0:
                    self.send_json({"error": "validation", "message": "planSetId is required"}, 400)
                    return
                deleted = delete_eval_plan_set(plan_set_id)
                self.send_json({"ok": True, **deleted})
                return
            with get_connection() as conn:
                if path.startswith("/api/codes/lv1/") and len(parts) == 4:
                    cur = conn.execute("DELETE FROM code_lv1 WHERE code=?", (parts[3].upper(),))
                elif path.startswith("/api/fact-formulas/") and len(parts) == 3:
                    fid = int(parts[2])
                    conn.execute("UPDATE fact_calc SET formula_id=NULL WHERE formula_id=?", (fid,))
                    conn.execute("UPDATE eval_plan_item SET formula_id=NULL WHERE formula_id=?", (fid,))
                    cur = conn.execute("DELETE FROM fact_formula WHERE id=?", (fid,))
                elif path.startswith("/api/codes/lv2/") and len(parts) == 4:
                    cur = conn.execute("DELETE FROM code_lv2 WHERE code=?", (parts[3],))
                elif path.startswith("/api/owner-groups/") and len(parts) == 3:
                    cur = conn.execute("DELETE FROM owner_group WHERE code=?", (parts[2].upper(),))
                elif path.startswith("/api/indicators/common/") and len(parts) == 4:
                    cur = conn.execute("DELETE FROM indicator_common WHERE common_code=?", (parts[3].upper(),))
                elif path.startswith("/api/indicators/codes/") and len(parts) == 4:
                    cur = conn.execute("DELETE FROM indicator_code WHERE indicator_code=?", (parts[3].upper(),))
                else:
                    self.send_json({"error": "not_found", "path": path}, 404)
                    return
                conn.commit()
                if cur.rowcount == 0:
                    self.send_json({"error": "not_found"}, 404)
                    return
            self.send_json({"ok": True})
        except sqlite3.IntegrityError as e:
            self.send_json({"error": "fk_violation", "message": str(e)}, 409)
        except ValueError as e:
            msg = str(e)
            status = 404 if "not found" in msg else 400
            self.send_json({"error": "not_found" if status == 404 else "validation", "message": msg}, status)
        except Exception as e:
            self.send_json({"error": "server_error", "message": str(e)}, 500)


def main():
    ensure_demo_database()
    init_schema()
    with get_connection() as conn:
        c = counts(conn)
        if c.get("indicator_code", 0) == 0 and DEFAULT_XLSX.exists():
            print("DB empty — importing", DEFAULT_XLSX.name)
            import_workbook(DEFAULT_XLSX, conn)

    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print("KPI API  http://%s:%s/  (code master + eval plan set history)" % (HOST, PORT))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료")
        sys.exit(0)


if __name__ == "__main__":
    main()
