# -*- coding: utf-8 -*-
"""owner_group 조직 레벨 (전행/그룹/본부) — 피평가 단위 vs 코드용 본부 구분."""
from __future__ import annotations

import sqlite3

ORG_BANK = "BANK"
ORG_GROUP = "GROUP"
ORG_HQ = "HQ"
EVAL_ORG_LEVELS = frozenset({ORG_BANK, ORG_GROUP})


def normalize_org_level(raw) -> str:
    s = str(raw or ORG_GROUP).strip().upper()
    if s in ("전행", "BANK"):
        return ORG_BANK
    if s in ("그룹", "GROUP"):
        return ORG_GROUP
    if s in ("본부", "HQ", "DIV", "DIVISION"):
        return ORG_HQ
    if s in (ORG_BANK, ORG_GROUP, ORG_HQ):
        return s
    return ORG_GROUP


def normalize_parent_code(raw) -> str | None:
    s = str(raw or "").strip().upper()
    return s or None


def validate_org_group_fields(
    conn: sqlite3.Connection,
    *,
    code: str,
    org_level: str,
    parent_code: str | None,
    is_update: bool = False,
) -> tuple[str, str | None]:
    level = normalize_org_level(org_level)
    parent = normalize_parent_code(parent_code)
    code_u = str(code or "").strip().upper()

    if level == ORG_BANK:
        return level, None

    if level == ORG_GROUP:
        if parent:
            row = conn.execute(
                "SELECT org_level FROM owner_group WHERE code=?",
                (parent,),
            ).fetchone()
            if not row:
                raise ValueError(f"parent group not found: {parent}")
            if normalize_org_level(row["org_level"]) != ORG_BANK:
                raise ValueError("GROUP parent must be BANK level (e.g. SHB)")
        return level, parent

    if level == ORG_HQ:
        if not parent:
            raise ValueError("HQ(본부) requires parent group code")
        if parent == code_u:
            raise ValueError("HQ cannot be its own parent")
        row = conn.execute(
            "SELECT org_level FROM owner_group WHERE code=?",
            (parent,),
        ).fetchone()
        if not row:
            raise ValueError(f"parent group not found: {parent}")
        if normalize_org_level(row["org_level"]) != ORG_GROUP:
            raise ValueError("HQ parent must be GROUP level")
        return level, parent

    raise ValueError(f"invalid org_level: {org_level}")
