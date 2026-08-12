# KPI 성과평가 자동화 에이전트 PRD

## 문서 정보

| 항목 | 내용 |
|------|------|
| 프로젝트명 | KPI 성과평가 자동화 에이전트 |
| 문서 버전 | 1.1 |
| 작성일 | 2026.02.23 |
| 최종 갱신 | 2026.07.30 |
| 참조 | `은행_KPI_3단분류_코드마스터_최종.xlsx`, `server/schema_kpi.sql`, `README.md`, `시스템전체설명서_행내이식가이드.md` |

---

## 1. Executive Summary

- **목적**: 그룹별 KPI 통합 조회·평가배치 표준화·달성률 산정·AI 인사이트
- **현재 단계**: 로컬 **본개발(기능 완성도 높은 내부 개발본)**. 코드체계·평가배치·실적 파이프라인의 정본은 **SQLite API**
- **핵심 Deliverable**
  - React(Vite) 프론트 (`system/`)
  - Python SQLite API (`server/kpi_api.py` :8787)
  - 코드마스터 엑셀 임포트 / 평가배치 셋 이력·엑셀 대량업로드
  - 실적 취합→산출→달성률 파이프라인 (Mock 어댑터)
  - 대시보드·그룹상세(트리 실적표)·평가배치·코드북·권한·Agent·이상탐지
- **행내 미이전(대응개발 필수)**: SSO/서버인증, 행내 DB, 실적 HTTP 실연동, 감사로그, 망분리 LLM, 승인 워크플로  
  → 상세는 `시스템전체설명서_행내이식가이드.md`

---

## 2. 시스템 아키텍처 (현재)

```
┌─────────────────────────────────┐   HTTP/CORS    ┌──────────────────────────────┐
│ React App (Vite :5173)          │ ◄────────────► │ Python API (:8787)            │
│ - Dashboard / GroupDetail       │                │ - kpi_api.py                  │
│ - Codebook / EvalConfig         │                │ - fact_pipeline.py            │
│ - Login / Users / Agent         │                │ - corporate_fact_client.py    │
│ - Anomaly / Report(선택 LLM)    │                │ - import_*.py                 │
└─────────────────────────────────┘                └──────────────┬───────────────┘
                                                                  ▼
                                                     SQLite: server/data/kpi.sqlite
                                                     - 코드체계 / 평가배치 / Fact / 달성률
```

| 레이어 | 정본 저장소 | 비고 |
|--------|-------------|------|
| 코드체계 | SQLite | 엑셀 시드/재적재 |
| 평가배치 | SQLite `eval_plan_set` + `eval_plan_item` | 적용시작월·상속 |
| 실적 Fact | `fact_collect` → `fact_calc` → `achievement_result` | Mock/HTTP 어댑터. 조인 키 `indicator_code` |
| 인증·권한 | **브라우저 localStorage** (`authService.js`) | 행내 이식 시 DB/SSO로 교체 (`auth_schema.sql` 초안) |
| UI 상태(커스텀 탭) | localStorage `agenda.customTabs.{year}` | |
| LLM API 키 | localStorage | 서버 저장 금지. 행내에서는 사내 LLM 또는 OFF |

---

## 3. 데이터 거버넌스

### 3.1 코드체계 vs 평가배치

| 구분 | 역할 | 저장 |
|------|------|------|
| **코드체계** | 지표 정규 식별자·소속 그룹·실적구분·단위 | `indicator_code` 등 |
| **평가배치** | 그해 평가용 분류·표시명·비중·목표·산정·Core 지정 | `eval_plan_set` / `eval_plan_item` |

- 코드체계 `display_name` ≠ 평가배치 `label`(보고서 표시명) 가능
- 평가용 Lv1/Lv2/Lv3는 코드체계 Lv1/Lv2/Lv3와 **독립**
- 조직개편·비중 변경은 **코드 재발급이 아니라 평가배치 셋 이력**으로 관리
- **사이드바 그룹 목록** = 선택 **연도**의 평가배치에 등장한 그룹 ∩ 사용자 권한 (코드마스터 전체 목록이 아님)

### 3.2 지표코드 규칙

```
indicator_code = Lv1 - Lv2 - Lv3 - 실적구분 - 그룹코드
예: CUS-0600-0001-NET-SG1
```

| 세그먼트 | 설명 | 예시 |
|----------|------|------|
| Lv1 | 대분류 | CUS, CAP, … |
| Lv2 | 중분류 | 0600 |
| Lv3 | 지표(공통) | 0001 |
| 실적구분 (perf) | NET / TOT / RAT / … | NET |
| 그룹코드 | 귀속 그룹 | SG1, CIG, CSG |

- `common_code = Lv1-Lv2-Lv3`
- 확장코드 = 공통 × 실적구분 × 그룹 → `indicator_code`
- 서버 `compose_indicator_code()` 검증, 중복 시 `409`

### 3.3 관리Tool

| 구분 | 용도 |
|------|------|
| **KPI** | 평가·경영 보고 (운영 KPI 사이드바·메인 실적표) |
| **전략과제** | 실행 모니터링 (그룹상세 참고 테이블) |
| **모니터링** | 참고 트렌드 (그룹상세 참고 테이블) |

### 3.4 평가 카테고리 (보고용)

평가배치 `eval_category_lv1` 예: 본원적 수익력, 건전성, 고객, 연결과 확장  
표시 계층: **평가용 Lv1 → Lv2 → Lv3 → Label(지표)**

### 3.5 Core 지표

- 비중 상위 자동 선정이 **아님**
- 평가배치 `is_core` = `Y`/`N` **수동 지정**
- UI: Core 뱃지, Core만 필터, CSV 포함

### 3.6 단위·표시

| 구분 | 규칙 |
|------|------|
| **저장** | 기본단위만 (`원`, `%`, `명`, `건` …). `억원` 등 축약단위 저장 금지 |
| **표시** | `numberFormat.js` — 만/억/조 자동 축약, 소수 2자리, hover에 원본 |

### 3.7 달성률 산정

| 모드 | 설명 |
|------|------|
| **Linear** | `기준 + (연간−기준)/연간일수×월말경과일수` (윤년 366) 월목표 대비 |
| **Flat** | 매월 연간목표 대비 |
| **Custom** | 1~12월 목표 + Filter1~30 + 산출식 |

- 목표 방향: `increase` / `decrease`
- **상태(신호)**: ≥95 정상, ≥85 관찰, ≥70 주의, &lt;70 부진
- 실적 증감: 목표대비·전월비는 **절대값 델타** (부호: 증가 `+`, 감소 `△`)
- 달성률 전월비: **%p**
- 서버: `achievement_engine.py` / 프론트 보조: `achievementEngine.js`

### 3.8 Data Ownership

| 계층 | 현재 |
|------|------|
| L1 그룹 | `owner_group` (연도 스냅샷 없음 → 연도별 노출은 평가배치로 대체) |
| L2 부서 | 평가배치 `dept` / 권한 모델에 부서 스코프 |
| L3~L4 | 설계만, 운영 미연결 |

---

## 4. SQLite 스키마 (정본)

파일: `server/schema_kpi.sql` / DB: `server/data/kpi.sqlite`

### 4.1 코드체계

```
owner_group / code_lv1 / code_lv2
indicator_common / indicator_code
```

### 4.2 평가배치

```
eval_plan_set (year, effective_from_month, change_reason) UNIQUE(year, month)
eval_plan_item (... is_core, weight, annual_target, baseline_actual,
                 achievement_mode, goal_direction, filters_json, …)
```

### 4.3 실적 파이프라인

```
sync_batch → fact_collect → fact_calc → (custom_achievement) → achievement_result
fact_formula (DERIVED 가공식)
```

### 4.4 조회·저장 규칙 (평가배치)

1. **조회** `year`+`month` → `effective_from_month <= month` 최신 셋 + items (`is_inherited` 포함)
2. **저장** 「적용시작월」 기준 **전체 배치셋** 생성/교체
3. **상속** 전용 셋 없으면 직전 적용 셋 자동 사용
4. 월별 전수 복제 UX **없음**

---

## 5. API 요구사항

베이스: `http://127.0.0.1:8787` (`VITE_API_BASE`)

### 5.1 코드체계

| Method | Path | 역할 |
|--------|------|------|
| GET | `/api/health` | 상태·건수 |
| CRUD | `/api/codes/lv1`, `/api/codes/lv2`, `/api/owner-groups` | 마스터 |
| CRUD | `/api/indicators/common`, `/api/indicators/codes` | 지표 |
| POST | `/api/indicators/preview-code` | 코드 미리보기 |
| POST | `/api/codes/import` | 엑셀 재적재 |

### 5.2 평가배치

| Method | Path | 역할 |
|--------|------|------|
| GET | `/api/eval-configs?year=&month=` | 유효 셋 해석 |
| PUT | `/api/eval-configs?year=&month=` | 적용시작월 셋 저장 |
| GET | `/api/eval-configs/history?year=` | 연도 셋 이력 |
| GET | `/api/eval-configs/template` | 템플릿 |
| POST | `/api/eval-configs/import?year=&month=` | 엑셀 업로드 |
| POST | `/api/eval-configs/seed-defaults` | 초기 셋 |
| GET | `/api/eval-configs/years` | 연도 목록 |

### 5.3 실적

| Method | Path | 역할 |
|--------|------|------|
| POST | `/api/facts/refresh?year=&month=` | 취합→산출→달성률 |
| GET | `/api/achievements?year=&month=` | 대시보드/상세 정본 |
| GET | `/api/facts/collect`, `/api/facts/calc` | 중간 단계 조회 |
| CRUD | `/api/fact-formulas` | DERIVED 식 |

실적 연동 환경변수: `CORPORATE_FACT_MODE=mock|http`, `CORPORATE_FACT_BASE_URL`, `CORPORATE_FACT_PATH`

---

## 6. 프론트 기능 요구사항

### 6.1 화면

| 화면 | 권한 | 설명 |
|------|------|------|
| 로그인 | 전체 | localStorage 세션 |
| 전체 현황(대시보드) | 권한 내 | 전행/그룹 요약 카드·차트 |
| 그룹 상세 | 권한 내 | **실적 트리 테이블 중심** (대시보드형 그룹 차트 제거) |
| AI Agent | 로그인 | 자연어 KPI 질의 |
| 이상치 센싱 | 로그인 | 규칙 기반 이상 탐지 |
| 리포트 | 로그인 | 선택적 LLM 리포트 |
| 코드북 | Admin | 마스터 CRUD·엑셀 |
| 연도별 평가배치 | Admin | 셋 이력·업로드 |
| 사용자 권한관리 | Admin | 계정·역할·허용 그룹 |

### 6.2 그룹 상세 실적표 (핵심 UX)

| 요구 | 내용 |
|------|------|
| 계층 | Lv1 / Lv2 / Lv3 / Label — **음영 단계 구분** (slate-800 → 200 → 100 → white) |
| 컬럼 | 비중, 연간목표, N월목표, N월실적, 실적증감(목표대비·전월비), 전년동월비, 환산달성률(+전월비 %p), 상태 |
| 필터 | 부진만 / Core만 / 검색 / 트리·L2·L3·지표만 뷰 |
| 정렬·표시 | 헤더 중앙, 숫자는 우측 정렬, 단위 병기, CSV 다운로드 |
| 기준월 | 헤더 연·월. 기본월 = **직전 달력월** |
| 사이드바 | 선택 **연도** 평가배치 그룹만. 월 변경으로 메인 화면 튕김 금지 |

### 6.3 평가배치 UX

1. 연·월 선택 → 해석 셋 표시 (상속 안내)
2. 수정 → 적용월·변경사유 → 전체 셋 저장
3. Core(`is_core`) 지정, Linear/Flat/Custom·승수·캡
4. 템플릿 다운로드 / 엑셀 업로드 / 기본값 생성

### 6.4 권한 역할

| 역할 | 범위 |
|------|------|
| admin | 관리메뉴 + 전체 |
| executive | 관리메뉴 제외, 은행KPI 포함 전체 조회 |
| group_admin | 배정 그룹 (은행KPI 제외) |
| dept_admin | 배정 부서 KPI |

---

## 7. 엑셀·업로드

### 7.1 코드마스터

- `은행_KPI_3단분류_코드마스터_최종.xlsx`
- 시트: `01_그룹마스터`, `02_분류체계`, `03_지표마스터`, `04_그룹별코드`

### 7.2 평가배치 템플릿

- `server/eval_plan_upload_template.xlsx`
- 메타(year, effective_from_month)는 API 쿼리, 엑셀은 행 데이터
- 주요 컬럼: `indicator_code`, `group_code`, 평가Lv, `label`, `weight`, `is_core`, 목표·기준실적, `achievement_mode`, Filter1~30 등

---

## 8. 조직·규모

| NO | 그룹 | 비고 |
|----|------|------|
| 0 | 전행(은행KPI) | 집계·별도 권한 |
| 1~ | 영업추진1·2, 기관·제휴, 고객솔루션, WM, CIB, 자본시장, 글로벌, AX혁신 등 | `owner_group` + 연도별 평가배치로 노출 |

실제 코드·건수는 DB/엑셀 정본 기준.

---

## 9. 보안·권한 (현행 vs 목표)

| 항목 | 현행(로컬) | 행내 목표 |
|------|------------|-----------|
| 로그인 | localStorage 데모 계정 | SSO / 행내 IAM |
| API | 무인증 CORS 오픈 | 토큰·세션·망분리 |
| 감사 | 브라우저 audit 키 | DB 감사로그 (`auth_schema.sql`) |
| LLM 키 | 브라우저 | 사내 게이트웨이 또는 기능 OFF |

---

## 10. AI 활용

| 기능 | 상태 |
|------|------|
| Agent 질의 | 룰 기반 답변 + 선택 LLM 보강 |
| 이상탐지 | `anomalyRules.js` |
| 리포트 | 선택 LLM |
| 정성 RAG | 로드맵 |

---

## 11. 로드맵

| 단계 | 상태 |
|------|------|
| 코드체계 SQLite + API | **완료** |
| 평가배치 셋 이력·엑셀 | **완료** |
| Fact 파이프라인 + Mock | **완료** |
| Core 수동지정·단위표시·그룹표 UX·연도별 사이드바 | **완료** |
| 행내 HTTP 실연동 | **스켈레톤** (`corporate_fact_client.py`) |
| 행내 DB·SSO·감사·승인 | **미완** |
| 연도별 조직마스터(valid_from/to) 고도화 | **선택** (현재는 평가배치로 대체) |

---

## 12. 부록 — 주요 파일

| 경로 | 설명 |
|------|------|
| `server/schema_kpi.sql` | KPI SQLite 스키마 |
| `server/auth_schema.sql` | 행내 권한 DB 초안 |
| `server/kpi_api.py` | HTTP API |
| `server/fact_pipeline.py` | 실적 파이프라인 |
| `server/achievement_engine.py` | 달성률 엔진 |
| `server/corporate_fact_client.py` | **행내 실적 연동 수정점** |
| `system/src/App.jsx` | 화면 상태·연도별 그룹·데이터 로딩 |
| `system/src/components/GroupDetailView.jsx` | 그룹 실적 트리표 |
| `system/src/components/EvalConfigView.jsx` | 평가배치 |
| `system/src/lib/authService.js` | 로컬 권한 |
| `system/src/lib/numberFormat.js` | 표시단 포맷 |
| `시스템전체설명서_행내이식가이드.md` | 제3자 설명·행내 대응개발 상세 |

### 용어

| 용어 | 의미 |
|------|------|
| 코드체계 | 지표 식별·계층 마스터 |
| 평가배치 | 연·적용월 기준 평가 구성 |
| 환산달성률 | 모드별 월목표 대비 달성률 |
| Core | 평가배치에서 수동 지정한 핵심 지표 |
