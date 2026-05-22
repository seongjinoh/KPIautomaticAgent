# -*- coding: utf-8 -*-
import pandas as pd
import json, os

base = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(base, "KPI_성과관리_시스템.xlsx")

xl = pd.ExcelFile(path)

# ── Sheet 1: KPI목표설정 ──
df1 = pd.read_excel(xl, sheet_name="1.KPI목표설정")
kpi_defs = []
for _, r in df1.iterrows():
    monthly_targets = {}
    for m in range(1, 13):
        col = f"{m}월"
        monthly_targets[m] = r[col] if pd.notna(r[col]) else 0
    kpi_defs.append({
        "no": int(r["NO"]),
        "group": r["그룹"],
        "code": r["지표코드"],
        "category": r["Category"],
        "segment": r["지표Seg"],
        "name": r["지표명"],
        "unit": r["단위"],
        "calcBasis": r["실적산출기준"],
        "mgmtTool": r["관리Tool"],
        "weight": float(r["평가비중(%)"]),
        "annualTarget": float(r["연간목표"]) if pd.notna(r["연간목표"]) else 0,
        "monthlyTargets": monthly_targets,
        "dept": r["Data Ownership (부서)"],
        "collectType": r["수집방식"],
    })

# ── Sheet 2: 실적데이터 ──
df2 = pd.read_excel(xl, sheet_name="2.실적데이터")
results = []
for _, r in df2.iterrows():
    results.append({
        "id": int(r["ID"]),
        "year": int(r["YYYY"]),
        "month": int(r["MM"]),
        "period": str(r["YYYYMM"]),
        "group": r["그룹"],
        "code": r["지표코드"],
        "name": r["지표명"],
        "unit": r["단위"],
        "mgmtTool": r["관리Tool"],
        "weight": float(r["평가비중(%)"]),
        "target": float(r["목표"]) if pd.notna(r["목표"]) else 0,
        "actual": float(r["실적"]) if pd.notna(r["실적"]) else 0,
        "achievement": float(r["달성률(%)"]) if pd.notna(r["달성률(%)"]) else 0,
        "collectType": r["수집방식"],
        "approvalStatus": r["승인상태"] if pd.notna(r["승인상태"]) else "미승인",
    })

groups = sorted(set(k["group"] for k in kpi_defs))

out = os.path.join(base, "system", "src", "data", "kpiData.js")
os.makedirs(os.path.dirname(out), exist_ok=True)

with open(out, "w", encoding="utf-8") as f:
    f.write("export const KPI_DEFINITIONS = ")
    f.write(json.dumps(kpi_defs, ensure_ascii=False, indent=2))
    f.write(";\n\nexport const KPI_RESULTS = ")
    f.write(json.dumps(results, ensure_ascii=False, indent=2))
    f.write(";\n\nexport const GROUPS = ")
    f.write(json.dumps(groups, ensure_ascii=False, indent=2))
    f.write(";\n")

print(f"OK: {out}")
print(f"KPI Definitions: {len(kpi_defs)}")
print(f"Result Records: {len(results)}")
print(f"Groups: {groups}")
