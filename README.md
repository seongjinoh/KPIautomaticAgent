# KPI 성과관리 시스템

은행 KPI 대시보드·그룹 상세·코드북·리포트(선택 LLM)를 제공하는 React(Vite) 웹 앱입니다.

## 로컬 실행

```powershell
cd system
npm install
npm run dev
```

브라우저: http://localhost:5173/

선택: Python 헬스체크 API (`server/kpi_api.py`, 포트 8787). 프론트는 기본적으로 `system/src/data/kpiData.js` 정적 데이터를 사용합니다.

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

## Vercel 배포 (외부 공개 URL)

1. [vercel.com](https://vercel.com) 로그인 → **Add New Project**
2. GitHub 저장소 **Import**
3. 설정 (루트 `vercel.json`이 있으면 대부분 자동 적용):
   - **Root Directory**: 저장소 루트 그대로 (비워 두거나 `.`)
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build --prefix system`
   - **Output Directory**: `system/dist`
4. **Deploy** → 완료 후 `https://<project>.vercel.app` URL로 접속

### 참고

- Vercel에는 **프론트엔드만** 배포됩니다. `server/kpi_api.py`는 로컬/별도 서버용입니다.
- LLM 리포트 기능은 사용자 브라우저의 localStorage API 키를 사용합니다. 서버에 키를 넣지 마세요.
- 재배포: `main` 브랜치에 push하면 Vercel이 자동으로 다시 빌드합니다.
