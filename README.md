# FOTORO 예약 스케줄 관리

GitHub에 push하면 자동으로 Cloudflare Worker(`fotoroschedule`)에 배포되고,
예약 데이터는 Cloudflare KV에 저장되어 여러 기기에서 공유됩니다.

## 최초 1회 설정

### 1. Cloudflare KV 네임스페이스 만들기
1. Cloudflare 대시보드 → **Workers & Pages** → 왼쪽 메뉴에서 **KV** 클릭
2. **Create a namespace** → 이름 예: `fotoro-bookings-kv` → 생성
3. 생성된 네임스페이스의 **ID**를 복사

### 2. wrangler.toml에 KV ID 입력
`wrangler.toml` 파일에서 아래 줄을:
```
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
```
방금 복사한 실제 ID로 바꿔주세요.

### 3. Cloudflare API 토큰 발급
1. Cloudflare 대시보드 우측 상단 프로필 → **My Profile** → **API Tokens**
2. **Create Token** → **Edit Cloudflare Workers** 템플릿 선택 → 계정/영역 권한 확인 후 생성
3. 생성된 토큰 복사 (한 번만 보여지니 꼭 복사해두기)

### 4. GitHub 저장소에 토큰 등록
1. GitHub 저장소 → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret**
   - Name: `CLOUDFLARE_API_TOKEN`
   - Value: 방금 복사한 토큰
3. 저장

### 5. 코드 push
```bash
git add .
git commit -m "초기 설정"
git push origin main
```
push하면 GitHub Actions가 자동으로 실행되어 Cloudflare Worker `fotoroschedule`에
같은 이름으로 배포됩니다 (기존 URL `fotoroschedule.doiry92.workers.dev` 그대로 유지).

## 이후 사용법
- `public/index.html` 파일을 수정하고 GitHub에 push만 하면
  Cloudflare에도 자동으로 반영됩니다.
- 예약 데이터는 이제 브라우저 localStorage가 아니라 **Cloudflare KV(서버)**에
  저장되므로, 어느 기기로 접속해도 같은 데이터를 봅니다.
- 관리자(Google 로그인, doiry92@gmail.com)만 데이터를 수정할 수 있고,
  나머지는 조회만 가능합니다 (서버에서도 다시 한번 검증합니다).
