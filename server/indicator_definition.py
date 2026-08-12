# -*- coding: utf-8 -*-
"""지표정의: Lv3 공통 정의 + 지표마스터 상세·Ownership 덮어쓰기.

Lv3: 지표정의·산출로직·Ownership(주관그룹/부서)·산출주기·산출시점·데이터원천
마스터: 상세지표정의 + Ownership 그룹/부서 덮어쓰기(비우면 Lv3 상속)
단위(unit)는 Lv3 전용.
피평가그룹은 indicator_code.group_code / 평가배치 group_code (Ownership과 별개).
"""
from __future__ import annotations

from typing import Any, Mapping

# Lv3에 두는 공통 정의 필드
LV3_DEFINITION_FIELDS = (
    "definition_text",
    "calc_logic_text",
    "owner_group_code",
    "dept",
    "calc_cycle",
    "calc_timing",
    "data_source_kind",
    "data_source",
)

# 마스터에서 Lv3를 덮어쓸 수 있는 Ownership 필드
OWNERSHIP_OVERRIDE_FIELDS = ("owner_group_code", "dept")

# 하위 호환·평가배치 머지에 쓰는 전체 키
DEFINITION_FIELDS = LV3_DEFINITION_FIELDS + ("detailed_definition_text",)

DATA_SOURCE_KINDS = ("Data Warehouse", "기타")

DEFINITION_COLUMN_DDL_COMMON = {
    "definition_text": "TEXT NOT NULL DEFAULT ''",
    "calc_logic_text": "TEXT NOT NULL DEFAULT ''",
    "data_source": "TEXT NOT NULL DEFAULT ''",
    "data_source_kind": "TEXT NOT NULL DEFAULT ''",
    "calc_cycle": "TEXT NOT NULL DEFAULT ''",
    "calc_timing": "TEXT NOT NULL DEFAULT ''",
    "collect_type": "TEXT NOT NULL DEFAULT ''",
    "dept": "TEXT NOT NULL DEFAULT ''",
    "owner_group_code": "TEXT NOT NULL DEFAULT ''",
    "remark": "TEXT NOT NULL DEFAULT ''",
}

DEFINITION_COLUMN_DDL_CODE = {
    "definition_text": "TEXT NOT NULL DEFAULT ''",
    "calc_logic_text": "TEXT NOT NULL DEFAULT ''",
    "data_source": "TEXT NOT NULL DEFAULT ''",
    "collect_type": "TEXT NOT NULL DEFAULT ''",
    "dept": "TEXT NOT NULL DEFAULT ''",
    "owner_group_code": "TEXT NOT NULL DEFAULT ''",
    "remark": "TEXT NOT NULL DEFAULT ''",
    "detailed_definition_text": "TEXT NOT NULL DEFAULT ''",
}

# db.py 마이그레이션용 통합
DEFINITION_COLUMN_DDL = {
    **DEFINITION_COLUMN_DDL_COMMON,
    "detailed_definition_text": "TEXT NOT NULL DEFAULT ''",
}


def _s(value: Any) -> str:
    return str(value or "").strip()


def normalize_data_source_kind(value: Any) -> str:
    raw = _s(value)
    low = raw.lower().replace("_", " ").replace("-", " ")
    if raw in DATA_SOURCE_KINDS:
        return raw
    if low in ("dw", "data warehouse", "warehouse", "데이터웨어하우스"):
        return "Data Warehouse"
    if low in ("other", "기타", "etc"):
        return "기타"
    return raw if raw in DATA_SOURCE_KINDS else (raw and "기타" or "")


def pick_lv3_definition_fields(source: Mapping[str, Any] | None) -> dict[str, str]:
    src = source or {}
    aliases = {
        "definition_text": ("definition_text", "definitionText", "정의", "지표정의"),
        "calc_logic_text": ("calc_logic_text", "calcLogicText", "산출로직", "산출식설명"),
        "owner_group_code": (
            "owner_group_code", "ownerGroupCode", "ownership_group", "ownershipGroup",
            "주관그룹", "Ownership그룹", "Ownership 그룹",
        ),
        "dept": ("dept", "부서", "담당부서", "주관부서", "Ownership부서", "Ownership 부서"),
        "calc_cycle": ("calc_cycle", "calcCycle", "산출주기"),
        "calc_timing": ("calc_timing", "calcTiming", "산출시점"),
        "data_source_kind": ("data_source_kind", "dataSourceKind", "데이터원천종류", "원천종류"),
        "data_source": (
            "data_source", "dataSource", "데이터원천", "원천",
            "data_source_detail", "dataSourceDetail", "원천상세", "테이블",
        ),
    }
    out: dict[str, str] = {}
    for field, keys in aliases.items():
        val = ""
        for k in keys:
            if k in src and _s(src.get(k)):
                val = _s(src.get(k))
                break
        if field == "data_source_kind":
            val = normalize_data_source_kind(val)
        if field == "owner_group_code":
            val = val.upper()
        out[field] = val
    return out


def pick_master_definition_fields(source: Mapping[str, Any] | None) -> dict[str, str]:
    """마스터 상세정의 + Ownership 덮어쓰기(빈 값 허용 = Lv3 상속)."""
    src = source or {}
    aliases = (
        "detailed_definition_text",
        "detailedDefinitionText",
        "상세지표정의",
        "상세정의",
    )
    val = ""
    for k in aliases:
        if k in src and _s(src.get(k)):
            val = _s(src.get(k))
            break
    out = {"detailed_definition_text": val}
    # Ownership: 키가 있으면 빈 문자열도 저장(상속 의도)
    if any(k in src for k in (
        "owner_group_code", "ownerGroupCode", "주관그룹", "Ownership그룹", "Ownership 그룹",
    )):
        raw = src.get("owner_group_code", src.get("ownerGroupCode", src.get("주관그룹", "")))
        out["owner_group_code"] = _s(raw).upper()
    if any(k in src for k in ("dept", "주관부서", "Ownership부서", "Ownership 부서")):
        out["dept"] = _s(src.get("dept") or src.get("주관부서") or src.get("Ownership부서"))
    return out


def pick_definition_fields(source: Mapping[str, Any] | None) -> dict[str, str]:
    """하위 호환: Lv3+마스터 필드를 한꺼번에 추출."""
    return {**pick_lv3_definition_fields(source), **pick_master_definition_fields(source)}


def resolve_ownership(
    lv3: Mapping[str, Any] | None,
    master: Mapping[str, Any] | None = None,
) -> dict[str, str]:
    """마스터 비어 있으면 Lv3. 채워져 있으면 마스터 덮어쓰기."""
    base = dict(lv3 or {})
    over = dict(master or {})
    group = _s(over.get("owner_group_code")) or _s(base.get("owner_group_code"))
    dept = _s(over.get("dept")) or _s(base.get("dept"))
    return {
        "owner_group_code": group.upper() if group else "",
        "dept": dept,
        "owner_group_source": "master" if _s(over.get("owner_group_code")) else ("lv3" if _s(base.get("owner_group_code")) else ""),
        "dept_source": "master" if _s(over.get("dept")) else ("lv3" if _s(base.get("dept")) else ""),
    }


def merge_definition(
    lv3: Mapping[str, Any] | None,
    master: Mapping[str, Any] | None = None,
    *,
    include_unit: bool = True,
) -> dict[str, Any]:
    """Lv3 기본 + Ownership은 마스터 덮어쓰기 가능. 상세정의는 마스터."""
    base = dict(lv3 or {})
    over = dict(master or {})
    merged: dict[str, str] = {}
    sources: dict[str, str] = {}

    for field in LV3_DEFINITION_FIELDS:
        if field in OWNERSHIP_OVERRIDE_FIELDS:
            b = _s(base.get(field))
            o = _s(over.get(field))
            if field == "owner_group_code":
                b, o = b.upper(), o.upper()
            if o:
                merged[field], sources[field] = o, "master"
            else:
                merged[field], sources[field] = b, ("lv3" if b else "")
            continue
        b = _s(base.get(field))
        if field == "data_source_kind":
            b = normalize_data_source_kind(b)
        merged[field] = b
        sources[field] = "lv3" if b else ""

    detail = _s(over.get("detailed_definition_text"))
    merged["detailed_definition_text"] = detail
    sources["detailed_definition_text"] = "master" if detail else ""

    if detail:
        merged["definition_text_combined"] = (
            f"{merged['definition_text']}\n\n[상세] {detail}".strip()
            if merged["definition_text"]
            else detail
        )
    else:
        merged["definition_text_combined"] = merged["definition_text"]

    if include_unit:
        u_lv3 = _s(base.get("unit"))
        u_m = _s(over.get("unit"))
        if u_lv3:
            merged["unit"], sources["unit"] = u_lv3, "lv3"
        elif u_m:
            merged["unit"], sources["unit"] = u_m, "master"
        else:
            merged["unit"], sources["unit"] = "", ""

    filled = sum(1 for f in LV3_DEFINITION_FIELDS if merged.get(f))
    return {
        **merged,
        "sources": sources,
        "definition_filled": filled,
        "definition_complete": filled >= 4,
    }


def coalesce_eval_text(item_val: Any, merged_val: str) -> str:
    v = _s(item_val)
    return v if v else _s(merged_val)
