# -*- coding: utf-8 -*-
import pandas as pd
import os
import sys

base = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(base, "통합 문서1.xlsx")
out_path = os.path.join(base, "excel_content.txt")

if not os.path.exists(path):
    print("FILE_NOT_FOUND")
    print("Files in dir:", os.listdir(base))
else:
    xl = pd.ExcelFile(path)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("=== 엑셀 시트 목록 ===\n")
        f.write(str(xl.sheet_names) + "\n\n")
        for sheet in xl.sheet_names:
            df = pd.read_excel(xl, sheet_name=sheet, header=None)
            f.write(f"\n\n========== 시트: {sheet} (상위 50행) ==========\n\n")
            f.write(df.head(50).to_string())
            if "거버넌스" in sheet or "Governance" in sheet:
                f.write(f"\n\n--- {sheet} 전체 헤더 및 샘플 ---\n")
                f.write(df.head(100).to_string())
    print("OK", out_path)
