# -*- coding: utf-8 -*-
"""
행내 실적 API 어댑터.

전환 방법:
  CORPORATE_FACT_MODE=mock|http
  CORPORATE_FACT_BASE_URL=https://...   (http 모드)
  CORPORATE_FACT_PATH=/api/kpi/facts?ym={ym}  (선택, 기본값)

행내 연동 시 이 파일의 HttpCorporateFactClient.fetch_collect_rows /
_map_response 만 수정하면 됩니다.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

SERVER_DIR = Path(__file__).resolve().parent
FIXTURES_DIR = SERVER_DIR / "fixtures"


def get_corporate_client() -> "CorporateFactClient":
    mode = (os.environ.get("CORPORATE_FACT_MODE") or "mock").strip().lower()
    if mode == "http":
        return HttpCorporateFactClient()
    return MockCorporateFactClient()


class CorporateFactClient:
    def fetch_collect_rows(self, eval_ym: str) -> list[dict[str, Any]]:
        raise NotImplementedError


class MockCorporateFactClient(CorporateFactClient):
    """fixtures/corporate_facts_{ym}.json 또는 corporate_facts_sample.json."""

    def fetch_collect_rows(self, eval_ym: str) -> list[dict[str, Any]]:
        ym = str(eval_ym).strip()
        candidates = [
            FIXTURES_DIR / f"corporate_facts_{ym}.json",
            FIXTURES_DIR / "corporate_facts_sample.json",
        ]
        for path in candidates:
            if not path.exists():
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            rows = data.get("items") if isinstance(data, dict) else data
            out = []
            for row in rows or []:
                code = str(row.get("indicator_code") or row.get("indicatorCode") or "").strip().upper()
                if not code:
                    continue
                try:
                    actual = float(row.get("actual"))
                except Exception:
                    continue
                out.append({"indicator_code": code, "actual": actual})
            if path.name.endswith(f"_{ym}.json") or out:
                return out
        return []


class HttpCorporateFactClient(CorporateFactClient):
    """행내 HTTP API 스켈레톤. 응답 매핑은 _map_response에서 수정."""

    def __init__(self) -> None:
        self.base_url = (os.environ.get("CORPORATE_FACT_BASE_URL") or "").rstrip("/")
        self.path_template = os.environ.get("CORPORATE_FACT_PATH") or "/api/kpi/facts?ym={ym}"

    def fetch_collect_rows(self, eval_ym: str) -> list[dict[str, Any]]:
        if not self.base_url:
            raise RuntimeError("CORPORATE_FACT_BASE_URL is required when CORPORATE_FACT_MODE=http")
        ym = str(eval_ym).strip()
        url = self.base_url + self.path_template.format(ym=ym)
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.URLError as e:
            raise RuntimeError(f"corporate fact API failed: {e}") from e
        return self._map_response(payload, ym)

    def _map_response(self, payload: Any, eval_ym: str) -> list[dict[str, Any]]:
        """행내 응답 JSON → [{indicator_code, actual}] 로 변환. 여기만 수정하세요."""
        rows = payload.get("items") if isinstance(payload, dict) else payload
        out = []
        for row in rows or []:
            code = str(row.get("indicator_code") or row.get("code") or "").strip().upper()
            if not code:
                continue
            try:
                actual = float(row.get("actual") if row.get("actual") is not None else row.get("value"))
            except Exception:
                continue
            out.append({"indicator_code": code, "actual": actual})
        return out
