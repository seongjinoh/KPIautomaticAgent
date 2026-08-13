# KPI 성과관리 시스템

은행 KPI 대시보드·그룹 상세·코드북·리포트(선택 LLM)를 제공하는 React(Vite) 웹 앱입니다.

## 문서

| 문서 | 용도 |
|------|------|
| [`PRD.md`](./PRD.md) | 제품 요구사항 (현행 v1.1) |
| [`시스템전체설명서_행내이식가이드.md`](./시스템전체설명서_행내이식가이드.md) | 제3자용 시스템 설명 + 행내 대응개발 체크리스트 |
| [`개발결과보고서_기술환경_및_행내이식가이드.md`](./개발결과보고서_기술환경_및_행내이식가이드.md) | 구 POC 시점 문서 (참고만) |

## 로컬 실행

### 1) 코드체계 API (SQLite)

```powershell
cd server
python import_code_master.py --xlsx "..\은행_KPI_3단분류_코드마스터_최종.xlsx"
python kpi_api.py
```

- DB: `server/data/kpi.sqlite` (gitignore)
- 포트: `http://127.0.0.1:8787`
- 헬스: `GET /api/health`
- 지표코드 규칙: `Lv1-Lv2-Lv3-실적구분-그룹코드` (예: `CUS-0600-0001-NET-SG1`)

빈 DB로 API를 띄우면 기본 엑셀을 자동 임포트합니다. 재적재:

```powershell
# 기본 엑셀 경로로
Invoke-RestMethod http://127.0.0.1:8787/api/codes/import -Method POST -ContentType "application/json" -Body "{}"

# 또는 코드북 UI의 「엑셀 업로드」
```

### 2) 프론트

```powershell
cd system
copy .env.example .env   # VITE_API_BASE=http://127.0.0.1:8787
npm install
npm run dev
```

브라우저: http://localhost:5173/

코드북 관리 메뉴는 API의 그룹 / Lv1·Lv2 / 공통지표 / 확장코드를 사용합니다.  
평가배치(KPI 지표·목표설정)는 `eval_plan_set` + `eval_plan_item` 셋 이력입니다.  
실적은 **취합 → 산출 → (Custom) → 달성률산정** 파이프라인으로 SQLite에 저장되며, 화면은 `GET /api/achievements`를 소비합니다.

### 실적 새로고침

헤더 **실적 새로고침** 또는:

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/api/facts/refresh?year=2026&month=1" -Method POST
```

행내 API 연동(개발자가 나중에 수정):

```powershell
$env:CORPORATE_FACT_MODE="http"          # 기본 mock
$env:CORPORATE_FACT_BASE_URL="https://..."
$env:CORPORATE_FACT_PATH="/api/kpi/facts?ym={ym}"
```

Mock은 `server/fixtures/corporate_facts_{ym}.json` 또는 `corporate_facts_sample.json`을 읽습니다.  
어댑터 구현: `server/corporate_fact_client.py`

### 월목표 산정

- **Linear**: `기준실적 + (연간목표 - 기준실적) / 연간일수 × 경과일수` (월말 기준, 윤년 366)
- **Flat**: 연간목표
- **Custom**: 목표설정의 1~12월 + Filter1~30 + 산출식

달성률(Linear/Flat): `100 + (실적 - 월목표) / 월목표 × 100`

## API 요약

| Method | Path | 역할 |
|--------|------|------|
| GET | `/api/health` | 상태·건수 |
| GET/POST/PUT/DELETE | `/api/codes/lv1`, `/api/codes/lv2` | Lv1·Lv2 |
| GET/POST/PUT/DELETE | `/api/owner-groups` | 그룹 |
| GET/POST/PUT/DELETE | `/api/indicators/common` | 공통지표 |
| GET/POST/PUT/DELETE | `/api/indicators/codes` | 확장코드 |
| GET/PUT | `/api/eval-configs?year=2026&month=7` | 해당 월에 유효한 배치셋 조회 / 적용시작월 기준 새 셋 저장 |
| GET | `/api/eval-configs/history?year=2026` | 연도별 배치셋 이력 조회 |
| GET | `/api/eval-configs/template` | 평가배치 엑셀 템플릿 다운로드 |
| POST | `/api/eval-configs/import?year=2026&month=7` | 평가배치 엑셀 업로드로 셋 저장 |
| POST | `/api/eval-configs/seed-defaults` | 최초 배치셋 생성 |
| POST | `/api/facts/refresh?year=&month=` | 취합→산출→달성률 파이프라인 |
| GET | `/api/achievements?year=&month=` | 달성률산정 조회(대시보드 정본) |
| GET | `/api/facts/collect` `/api/facts/calc` | 취합·산출 조회 (`calc`에 `formula_name` join) |
| GET/POST/PUT/DELETE | `/api/fact-formulas` | 가공식(DERIVED) — 출력지표는 코드마스터 필수 |
| POST | `/api/fact-formulas/preview?year=&month=` | 가공식 dry-run 미리보기 |
| POST | `/api/bank-export?year=&month=` | 에이전트 산출 스냅샷 → 은행 적재 스테이징 (어댑터 no-op). 운영 자정 배치는 동일 POST를 스케줄러가 호출 |
| GET | `/api/bank-export/history?year=` | 은행 적재 배치 이력 |
| GET | `/api/bank-export/{id}/items` | 적재 항목 조회 |
| POST | `/api/indicators/preview-code` | 코드 미리보기 |
| POST | `/api/codes/import` | 엑셀 재적재 (multipart `file` 또는 기본 파일) |

중복 지표코드는 `409 { "error": "duplicate_indicator_code", "code": "..." }`.

## 평가배치 셋 이력 흐름

1. 평가배치 화면에서 연/월을 선택하면 `GET /api/eval-configs?year=&month=`로 **그 달에 유효한 배치셋**을 조회합니다.
2. 해당 월에 전용 셋이 없으면, 같은 연도에서 `effective_from_month <= 조회월` 중 가장 최근 셋을 자동 상속합니다.
3. 사용자가 수정 후 저장할 때 `몇 월 평가부터 적용`할지 지정하면 `PUT /api/eval-configs?year=&month=`로 새 셋을 저장합니다.
4. `GET /api/eval-configs/history?year=`로 `1월 적용`, `7월 적용` 같은 셋 이력을 확인합니다.
5. `기본값 생성`은 기존 `KPI_DEFINITIONS` / `PREV_KPI_DEFINITIONS`를 프론트에서 초기 셋 row로 변환한 뒤 `POST /api/eval-configs/seed-defaults`로 저장합니다.
6. `GET /api/eval-configs/template`로 샘플 양식을 내려받고, `POST /api/eval-configs/import?year=&month=`로 같은 컬럼 구조의 `.xlsx`를 업로드할 수 있습니다.

저장 item 주요 필드:

- 코드체계 참조: `indicator_code`, `group_code` (저장 시 `mgmt_tool` 은 항상 KPI)
- 평가배치 전용: `평가Lv1/2/3`, `표시명(label)`, `weight`, `annual_target`, `baseline_actual`
- 승수·캡: `기본승수(score_rule)`, `조정승수(penalty_rule)`, `상한(cap_max)`, `하한(cap_min)`
- 달성률: `achievement_mode`, `goal_direction`, `custom_monthly_targets_json`(Custom만), `filters_json`(Filter1~30)

엑셀 템플릿은 `기준실적`, `1~12월목표`, `Filter1~30` 을 포함합니다. Custom이 아닌 월목표는 임포트 시 무시합니다.

## GitHub 업로드

1. [Git for Windows](https://git-scm.com/download/win) 설치 후 터미널을 다시 엽니다.
2. [GitHub](https://github.com/new)에서 빈 저장소 생성 (예: `kpi-project`). README 추가는 **하지 않음**.
3. 프로젝트 루트에서:

```powershell
cd "c:\Users\sjshi\Desktop\AX\KPI프로젝트"
git init
git add .
git commit -m "Initial commit: KPI performance system"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/<REPO_NAME>.git
git push -u origin main
```

`<YOUR_USERNAME>`, `<REPO_NAME>`을 본인 계정/저장소 이름으로 바꿉니다.

## Vercel + Railway 배포 (외부 공개 URL)

프론트는 **Vercel**, API(Python + 영속 SQLite)는 **Railway**에 올립니다.  
상세: [`RAILWAY.md`](RAILWAY.md)

### 1) API — Railway

1. [railway.app](https://railway.app) → GitHub 저장소 연결
2. **Root Directory**: `server`
3. Variables: `HOST=0.0.0.0`, `KPI_DATA_DIR=/data`
4. **Volume** mount path `/data` (SQLite 영속화 — 필수)
5. **Generate Domain** 후 `GET /api/health` 확인

### 2) 프론트 — Vercel

1. [vercel.com](https://vercel.com) → 저장소 Import
2. 루트 `vercel.json` 자동 적용 (Build: `npm run build --prefix system`, Output: `system/dist`)
3. **Environment Variables**
   - `VITE_API_BASE` = Railway API URL (끝 `/` 없이, 예: `https://xxx.up.railway.app`)
4. **Deploy** → Redeploy 필수 (`VITE_` 값은 빌드 시 고정)

### 참고

- LLM 키는 Vercel env 또는 브라우저 설정. 서버에 넣지 마세요.
- (구) Render Free는 디스크가 휘발되어 DB가 날아갈 수 있음 → Railway Volume 권장
- 테스트 로그인(로컬과 동일): 관리자 `00000001` / `admin123!`
