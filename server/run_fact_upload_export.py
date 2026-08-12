# -*- coding: utf-8 -*-
"""자정 배치: 입력 완료(pending) 실적 → 은행 어댑터 전송.

Freeze(최종 확정)와 무관하게 pending을 전송한다.
Freeze는 수정 마감용이다.

사용 예 (Windows 작업 스케줄러 / cron):
  python run_fact_upload_export.py
"""
from __future__ import annotations

import json
import sys

from db import get_connection, init_schema
from import_fact_upload import export_pending_uploads_to_bank


def main() -> int:
    init_schema()
    with get_connection() as conn:
        result = export_pending_uploads_to_bank(conn, triggered_by="scheduler")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
