# Railway 배포 가이드 (KPI API + 영속 SQLite)

프론트는 **Vercel**, API+DB는 **Railway**에 올립니다.
ngrok/이 PC 없이도 데이터가 유지됩니다.

## 1) Railway 프로젝트 만들기

1. [railway.app](https://railway.app) 가입/로그인
2. **New Project** → **Deploy from GitHub repo** → `KPIautomaticAgent` 선택
3. 서비스 설정:
   - **Root Directory**: `server`
   - Builder: Dockerfile (`server/Dockerfile` 자동 감지)
4. **Variables** 추가:
   - `HOST` = `0.0.0.0`
   - `PYTHONUNBUFFERED` = `1`
   - `KPI_DATA_DIR` = `/data`
   - (`PORT`는 Railway가 자동 주입)

## 2) Volume (SQLite 영속화) — 필수

1. 서비스 → **Settings** → **Volumes** → **Add Volume**
2. Mount Path: `/data`
3. 재배포

Volume이 없으면 재배포·재시작 때 DB가 날아갈 수 있습니다.

## 3) 공개 URL

1. 서비스 → **Settings** → **Networking** → **Generate Domain**
2. 예: `https://kpi-api-xxxx.up.railway.app`
3. 브라우저에서 `https://<도메인>/api/health` 확인

## 4) Vercel 프론트 연결

Vercel → Environment Variables:

- `VITE_API_BASE` = `https://<railway-도메인>`  (끝 `/` 없이)

저장 후 **Redeploy**.

로컬 프론트는 `system/.env`의 `VITE_API_BASE`를 Railway URL로 바꾸거나, 개발 시에는 `http://127.0.0.1:8787` 유지.

## 5) CLI로 배포 (선택)

```powershell
# Railway CLI
npm i -g @railway/cli
railway login
cd server
railway init    # 또는 railway link
railway up
railway volume add --mount /data   # 대시보드에서 해도 됨
railway domain
```

## 참고

| 항목 | 설명 |
|------|------|
| DB 파일 | `/data/kpi.sqlite` (Volume) |
| 데모 gz | 이미지 안 `server/data/kpi.demo.sqlite.gz` (없을 때만 초기화) |
| 요금 | Railway Hobby 등 유료 플랜 + Volume 필요할 수 있음 |
| 이전 Render | Free 디스크 휘발 → Railway Volume으로 대체 |
| ngrok | Railway 쓰면 더 이상 필요 없음 |

## 트러블슈팅

- `/api/health` 502: 배포 로그에서 `KPI API http://0.0.0.0:...` 기동 확인
- 데이터 날아감: Volume mount `/data` + `KPI_DATA_DIR=/data` 확인
- Vercel이 예전 API 침: `VITE_API_BASE` 바꾸고 **반드시 Redeploy**
