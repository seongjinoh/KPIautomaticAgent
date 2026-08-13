-- KPI 코드체계 주스키마 (SQLite)
-- indicator_code = Lv1-Lv2-Lv3-실적구분-그룹코드

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS owner_group (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  use_yn      TEXT NOT NULL DEFAULT 'Y',
  org_level   TEXT NOT NULL DEFAULT 'GROUP',
  parent_code TEXT REFERENCES owner_group(code)
);

CREATE TABLE IF NOT EXISTS code_lv1 (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  use_yn     TEXT NOT NULL DEFAULT 'Y'
);

CREATE TABLE IF NOT EXISTS code_lv2 (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  use_yn     TEXT NOT NULL DEFAULT 'Y'
);

CREATE TABLE IF NOT EXISTS indicator_common (
  common_code  TEXT PRIMARY KEY,
  lv1_code     TEXT NOT NULL,
  lv2_code     TEXT NOT NULL,
  lv3_code     TEXT NOT NULL,
  name         TEXT NOT NULL,
  unit         TEXT NOT NULL DEFAULT '',
  allowed_perf TEXT NOT NULL DEFAULT '',
  common_yn    TEXT NOT NULL DEFAULT '단독',
  use_yn       TEXT NOT NULL DEFAULT 'Y',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  definition_text  TEXT NOT NULL DEFAULT '',
  calc_logic_text  TEXT NOT NULL DEFAULT '',
  owner_group_code TEXT NOT NULL DEFAULT '',
  dept             TEXT NOT NULL DEFAULT '',
  calc_cycle       TEXT NOT NULL DEFAULT '',
  calc_timing      TEXT NOT NULL DEFAULT '',
  data_source_kind TEXT NOT NULL DEFAULT '',
  data_source      TEXT NOT NULL DEFAULT '',
  collect_type     TEXT NOT NULL DEFAULT '',
  remark           TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (lv1_code) REFERENCES code_lv1(code),
  FOREIGN KEY (lv2_code) REFERENCES code_lv2(code)
);

CREATE TABLE IF NOT EXISTS indicator_code (
  indicator_code TEXT PRIMARY KEY,
  common_code    TEXT NOT NULL,
  group_code     TEXT NOT NULL,
  perf_code      TEXT NOT NULL,
  display_name   TEXT,
  unit           TEXT,
  agg_type       TEXT,
  use_yn         TEXT NOT NULL DEFAULT 'Y',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  detailed_definition_text TEXT NOT NULL DEFAULT '',
  definition_text  TEXT NOT NULL DEFAULT '',
  calc_logic_text  TEXT NOT NULL DEFAULT '',
  data_source      TEXT NOT NULL DEFAULT '',
  collect_type     TEXT NOT NULL DEFAULT '',
  owner_group_code TEXT NOT NULL DEFAULT '',
  dept             TEXT NOT NULL DEFAULT '',
  remark           TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (common_code) REFERENCES indicator_common(common_code),
  FOREIGN KEY (group_code) REFERENCES owner_group(code)
);

CREATE TABLE IF NOT EXISTS eval_plan_set (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  year                 INTEGER NOT NULL,
  effective_from_month INTEGER NOT NULL,
  change_reason        TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (year, effective_from_month)
);

CREATE TABLE IF NOT EXISTS eval_plan_item (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_set_id               INTEGER NOT NULL,
  group_code                TEXT NOT NULL,
  indicator_code            TEXT NOT NULL,
  mgmt_tool                 TEXT NOT NULL DEFAULT 'KPI',
  eval_category_lv1         TEXT NOT NULL DEFAULT '',
  eval_category_lv2         TEXT NOT NULL DEFAULT '',
  eval_category_lv3         TEXT NOT NULL DEFAULT '',
  label                     TEXT NOT NULL DEFAULT '',
  unit                      TEXT NOT NULL DEFAULT '',
  weight                    REAL NOT NULL DEFAULT 0,
  is_core                   TEXT NOT NULL DEFAULT 'N',
  annual_target             REAL NOT NULL DEFAULT 0,
  monthly_target            REAL,
  baseline_actual           REAL NOT NULL DEFAULT 0,
  data_source               TEXT NOT NULL DEFAULT '',
  definition_text           TEXT NOT NULL DEFAULT '',
  calc_logic_text           TEXT NOT NULL DEFAULT '',
  h1_target                 REAL,
  h2_target                 REAL,
  score_rule                TEXT NOT NULL DEFAULT '',
  penalty_rule              TEXT NOT NULL DEFAULT '',
  cap_max                   REAL,
  cap_min                   REAL,
  remark                    TEXT NOT NULL DEFAULT '',
  adj_band                  TEXT NOT NULL DEFAULT '',
  filters_json              TEXT,
  formula_id                INTEGER,
  achievement_mode          TEXT NOT NULL DEFAULT 'linear',
  goal_direction            TEXT NOT NULL DEFAULT 'increase',
  custom_achievement_expr   TEXT NOT NULL DEFAULT '',
  custom_monthly_targets_json TEXT,
  sort_order                INTEGER NOT NULL DEFAULT 0,
  use_yn                    TEXT NOT NULL DEFAULT 'Y',
  contribution_mode         TEXT NOT NULL DEFAULT 'WEIGHT',
  target_start_month        INTEGER NOT NULL DEFAULT 1,
  target_end_month          INTEGER NOT NULL DEFAULT 12,
  created_at                TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_set_id) REFERENCES eval_plan_set(id) ON DELETE CASCADE,
  FOREIGN KEY (indicator_code) REFERENCES indicator_code(indicator_code),
  FOREIGN KEY (group_code) REFERENCES owner_group(code),
  UNIQUE (plan_set_id, group_code, indicator_code, mgmt_tool)
);

CREATE TABLE IF NOT EXISTS fact_formula (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT NOT NULL,
  output_indicator_code  TEXT NOT NULL,
  expr                   TEXT NOT NULL DEFAULT '',
  operands_json          TEXT NOT NULL DEFAULT '{}',
  use_yn                 TEXT NOT NULL DEFAULT 'Y',
  created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (output_indicator_code) REFERENCES indicator_code(indicator_code)
);

CREATE TABLE IF NOT EXISTS sync_batch (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mode         TEXT NOT NULL DEFAULT 'mock',
  eval_ym      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running',
  counts_json  TEXT NOT NULL DEFAULT '{}',
  error_text   TEXT NOT NULL DEFAULT '',
  started_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at  TEXT
);

CREATE TABLE IF NOT EXISTS fact_collect (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  eval_ym         TEXT NOT NULL,
  indicator_code  TEXT NOT NULL,
  actual          REAL,
  batch_id        INTEGER,
  fetched_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (eval_ym, indicator_code),
  FOREIGN KEY (indicator_code) REFERENCES indicator_code(indicator_code),
  FOREIGN KEY (batch_id) REFERENCES sync_batch(id)
);

CREATE TABLE IF NOT EXISTS fact_calc (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  eval_ym         TEXT NOT NULL,
  group_code      TEXT NOT NULL,
  indicator_code  TEXT NOT NULL,
  actual          REAL,
  calc_kind       TEXT NOT NULL DEFAULT 'DIRECT',
  formula_id      INTEGER,
  batch_id        INTEGER,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (eval_ym, group_code, indicator_code),
  FOREIGN KEY (indicator_code) REFERENCES indicator_code(indicator_code),
  FOREIGN KEY (group_code) REFERENCES owner_group(code),
  FOREIGN KEY (formula_id) REFERENCES fact_formula(id),
  FOREIGN KEY (batch_id) REFERENCES sync_batch(id)
);

CREATE TABLE IF NOT EXISTS custom_achievement (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  eval_ym         TEXT NOT NULL,
  group_code      TEXT NOT NULL,
  indicator_code  TEXT NOT NULL,
  actual          REAL,
  monthly_target  REAL,
  achievement     REAL,
  batch_id        INTEGER,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (eval_ym, group_code, indicator_code),
  FOREIGN KEY (indicator_code) REFERENCES indicator_code(indicator_code),
  FOREIGN KEY (group_code) REFERENCES owner_group(code),
  FOREIGN KEY (batch_id) REFERENCES sync_batch(id)
);

CREATE TABLE IF NOT EXISTS achievement_result (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  eval_ym                TEXT NOT NULL,
  group_code             TEXT NOT NULL,
  indicator_code         TEXT NOT NULL,
  actual                 REAL,
  annual_target          REAL,
  monthly_target         REAL,
  simple_achievement     REAL,
  converted_achievement  REAL,
  achievement_mode       TEXT NOT NULL DEFAULT 'linear',
  goal_direction         TEXT NOT NULL DEFAULT 'increase',
  weight                 REAL NOT NULL DEFAULT 0,
  label                  TEXT NOT NULL DEFAULT '',
  unit                   TEXT NOT NULL DEFAULT '',
  eval_category_lv1      TEXT NOT NULL DEFAULT '',
  eval_category_lv2      TEXT NOT NULL DEFAULT '',
  eval_category_lv3      TEXT NOT NULL DEFAULT '',
  mgmt_tool              TEXT NOT NULL DEFAULT 'KPI',
  batch_id               INTEGER,
  updated_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (eval_ym, group_code, indicator_code),
  FOREIGN KEY (indicator_code) REFERENCES indicator_code(indicator_code),
  FOREIGN KEY (group_code) REFERENCES owner_group(code),
  FOREIGN KEY (batch_id) REFERENCES sync_batch(id)
);

CREATE INDEX IF NOT EXISTS ix_indicator_common_lv ON indicator_common(lv1_code, lv2_code);
CREATE INDEX IF NOT EXISTS ix_indicator_code_common ON indicator_code(common_code);
CREATE INDEX IF NOT EXISTS ix_indicator_code_group ON indicator_code(group_code);
CREATE INDEX IF NOT EXISTS ix_eval_plan_set_year_month ON eval_plan_set(year, effective_from_month);
CREATE INDEX IF NOT EXISTS ix_eval_plan_item_plan_set ON eval_plan_item(plan_set_id);
CREATE INDEX IF NOT EXISTS ix_eval_plan_item_group ON eval_plan_item(group_code, plan_set_id);
CREATE INDEX IF NOT EXISTS ix_eval_plan_item_indicator ON eval_plan_item(indicator_code, plan_set_id);
CREATE INDEX IF NOT EXISTS ix_fact_collect_ym ON fact_collect(eval_ym);
CREATE INDEX IF NOT EXISTS ix_fact_calc_ym_group ON fact_calc(eval_ym, group_code);
CREATE INDEX IF NOT EXISTS ix_achievement_result_ym_group ON achievement_result(eval_ym, group_code);

-- 에이전트 DB → 은행 적재 스테이징 (outbound)
CREATE TABLE IF NOT EXISTS bank_export_batch (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  eval_ym       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',
  triggered_by  TEXT NOT NULL DEFAULT 'api',
  counts_json   TEXT NOT NULL DEFAULT '{}',
  error_text    TEXT NOT NULL DEFAULT '',
  started_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   TEXT
);

CREATE TABLE IF NOT EXISTS bank_export_item (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id               INTEGER NOT NULL,
  eval_ym                TEXT NOT NULL,
  group_code             TEXT NOT NULL,
  indicator_code         TEXT NOT NULL,
  actual                 REAL,
  calc_kind              TEXT NOT NULL DEFAULT 'DIRECT',
  monthly_target         REAL,
  converted_achievement  REAL,
  payload_json           TEXT,
  FOREIGN KEY (batch_id) REFERENCES bank_export_batch(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_bank_export_batch_ym ON bank_export_batch(eval_ym);
CREATE INDEX IF NOT EXISTS ix_bank_export_item_batch ON bank_export_item(batch_id);

-- 실적 엑셀 업로드 staging (inbound) → 미리보기 확인 후 반영 → 자정 은행 적재
CREATE TABLE IF NOT EXISTS fact_upload_batch (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'running',
  counts_json   TEXT NOT NULL DEFAULT '{}',
  error_text    TEXT NOT NULL DEFAULT '',
  uploaded_by   TEXT NOT NULL DEFAULT 'ui',
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   TEXT
);

CREATE TABLE IF NOT EXISTS fact_upload_item (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id        INTEGER NOT NULL,
  eval_ym         TEXT NOT NULL,
  indicator_code  TEXT NOT NULL,
  group_code      TEXT NOT NULL DEFAULT '',
  actual          REAL,
  prev_actual     REAL,
  change_kind     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'ok',
  error_text      TEXT NOT NULL DEFAULT '',
  export_status   TEXT NOT NULL DEFAULT 'pending',
  exported_at     TEXT,
  row_no          INTEGER,
  FOREIGN KEY (batch_id) REFERENCES fact_upload_batch(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fact_upload_change_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id        INTEGER NOT NULL,
  eval_ym         TEXT NOT NULL,
  indicator_code  TEXT NOT NULL,
  group_code      TEXT NOT NULL DEFAULT '',
  prev_actual     REAL,
  new_actual      REAL,
  change_kind     TEXT NOT NULL DEFAULT '',
  action          TEXT NOT NULL,
  acted_by        TEXT NOT NULL DEFAULT 'ui',
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES fact_upload_batch(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_fact_upload_batch_created ON fact_upload_batch(created_at);
CREATE INDEX IF NOT EXISTS ix_fact_upload_item_batch ON fact_upload_item(batch_id);
CREATE INDEX IF NOT EXISTS ix_fact_upload_item_export ON fact_upload_item(export_status, eval_ym);
CREATE INDEX IF NOT EXISTS ix_fact_upload_change_log_batch ON fact_upload_change_log(batch_id);
CREATE INDEX IF NOT EXISTS ix_fact_upload_change_log_created ON fact_upload_change_log(created_at);

-- 그룹별 실적 「지표 확인」 (확인 후 admin만 수정 가능)
CREATE TABLE IF NOT EXISTS fact_group_confirm (
  eval_ym       TEXT NOT NULL,
  group_code    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  confirmed_by  TEXT NOT NULL DEFAULT '',
  confirmed_at  TEXT,
  revoked_by    TEXT NOT NULL DEFAULT '',
  revoked_at    TEXT,
  note          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (eval_ym, group_code),
  FOREIGN KEY (group_code) REFERENCES owner_group(code)
);
CREATE INDEX IF NOT EXISTS ix_fact_group_confirm_ym ON fact_group_confirm(eval_ym, status);

-- 월 실적 최종 확정 (Freeze) — 확정분만 자정 은행 전송
CREATE TABLE IF NOT EXISTS fact_period_status (
  eval_ym     TEXT NOT NULL PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'open',
  frozen_by   TEXT NOT NULL DEFAULT '',
  frozen_at   TEXT,
  unfrozen_by TEXT NOT NULL DEFAULT '',
  unfrozen_at TEXT,
  note        TEXT NOT NULL DEFAULT ''
);

-- 연·월 종합산정(L3) 정책
CREATE TABLE IF NOT EXISTS score_rollup_set (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  year                 INTEGER NOT NULL,
  effective_from_month INTEGER NOT NULL,
  change_reason        TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (year, effective_from_month)
);

CREATE TABLE IF NOT EXISTS score_rollup_rule (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  rollup_set_id     INTEGER NOT NULL,
  target_group_code TEXT NOT NULL,
  FOREIGN KEY (rollup_set_id) REFERENCES score_rollup_set(id) ON DELETE CASCADE,
  FOREIGN KEY (target_group_code) REFERENCES owner_group(code),
  UNIQUE (rollup_set_id, target_group_code)
);

CREATE TABLE IF NOT EXISTS score_rollup_term (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id     INTEGER NOT NULL,
  term_type   TEXT NOT NULL,
  weight      REAL NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (rule_id) REFERENCES score_rollup_rule(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS score_rollup_term_group (
  term_id     INTEGER NOT NULL,
  group_code  TEXT NOT NULL,
  PRIMARY KEY (term_id, group_code),
  FOREIGN KEY (term_id) REFERENCES score_rollup_term(id) ON DELETE CASCADE,
  FOREIGN KEY (group_code) REFERENCES owner_group(code)
);

-- 그룹 종합달성률 L1/L2/L3 결과
CREATE TABLE IF NOT EXISTS group_score_result (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  eval_ym             TEXT NOT NULL,
  group_code          TEXT NOT NULL,
  base_score          REAL,
  adjust_points       REAL NOT NULL DEFAULT 0,
  adjust_pp           REAL NOT NULL DEFAULT 0,
  group_final_score   REAL,
  ultimate_score      REAL,
  rollup_set_id       INTEGER,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (eval_ym, group_code),
  FOREIGN KEY (group_code) REFERENCES owner_group(code),
  FOREIGN KEY (rollup_set_id) REFERENCES score_rollup_set(id)
);

CREATE INDEX IF NOT EXISTS ix_group_score_result_ym ON group_score_result(eval_ym);
CREATE INDEX IF NOT EXISTS ix_score_rollup_set_year_month ON score_rollup_set(year, effective_from_month);
CREATE INDEX IF NOT EXISTS ix_score_rollup_rule_set ON score_rollup_rule(rollup_set_id);
