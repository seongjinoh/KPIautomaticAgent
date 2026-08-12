-- KPI 성과관리 시스템 인증/권한관리 DB 스키마 초안
-- POC 프론트(localStorage) 권한 모델을 행내 DB로 이관할 때 사용하는 기준안이다.
-- 실제 운영 DBMS(Oracle/PostgreSQL 등)에 맞춰 타입과 시퀀스는 조정한다.

CREATE TABLE TB_USER (
  user_id           VARCHAR(64) PRIMARY KEY,
  employee_no       VARCHAR(8)  NOT NULL UNIQUE,
  user_name         VARCHAR(100) NOT NULL,
  password_hash     VARCHAR(255),
  group_name        VARCHAR(100),
  department_name   VARCHAR(100),
  is_active         CHAR(1) DEFAULT 'Y' NOT NULL,
  last_login_at     TIMESTAMP,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE TB_ROLE (
  role_code         VARCHAR(32) PRIMARY KEY,
  role_name         VARCHAR(100) NOT NULL,
  description       VARCHAR(500)
);

INSERT INTO TB_ROLE (role_code, role_name, description) VALUES
('admin', '관리자', '관리메뉴와 전체 데이터 조회/쓰기 권한');
INSERT INTO TB_ROLE (role_code, role_name, description) VALUES
('executive', '임원', '관리메뉴 제외, 은행KPI 포함 전체 조회 권한');
INSERT INTO TB_ROLE (role_code, role_name, description) VALUES
('group_admin', '그룹별 관리자', '은행KPI 제외, 배정 그룹 조회 권한');
INSERT INTO TB_ROLE (role_code, role_name, description) VALUES
('dept_admin', '부서별 관리자', '배정 부서 KPI 읽기/쓰기 권한');

CREATE TABLE TB_USER_ROLE (
  user_role_id      VARCHAR(64) PRIMARY KEY,
  user_id           VARCHAR(64) NOT NULL,
  role_code         VARCHAR(32) NOT NULL,
  group_name        VARCHAR(100),
  department_name   VARCHAR(100),
  is_active         CHAR(1) DEFAULT 'Y' NOT NULL,
  created_by        VARCHAR(64),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT fk_user_role_user FOREIGN KEY (user_id) REFERENCES TB_USER(user_id),
  CONSTRAINT fk_user_role_role FOREIGN KEY (role_code) REFERENCES TB_ROLE(role_code)
);

CREATE TABLE TB_AUTH_AUDIT_LOG (
  log_id            VARCHAR(64) PRIMARY KEY,
  event_type        VARCHAR(50) NOT NULL,
  employee_no       VARCHAR(8),
  user_id           VARCHAR(64),
  session_id        VARCHAR(100),
  source_ip         VARCHAR(64),
  user_agent        VARCHAR(500),
  result            VARCHAR(20) NOT NULL,
  reason            VARCHAR(500),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IX_TB_USER_EMPLOYEE_NO ON TB_USER(employee_no);
CREATE INDEX IX_TB_USER_ROLE_USER ON TB_USER_ROLE(user_id);
CREATE INDEX IX_TB_USER_ROLE_SCOPE ON TB_USER_ROLE(role_code, group_name, department_name);
CREATE INDEX IX_TB_AUTH_AUDIT_USER_TIME ON TB_AUTH_AUDIT_LOG(user_id, created_at);
