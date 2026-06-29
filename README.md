# ASRC 정기회의 의견 공유 사이트

GitHub Pages + Supabase로 운영하는 정적 웹사이트입니다.

## 파일 구성

- `index.html` : 사이트 화면
- `style.css` : 디자인
- `script.js` : 의견 등록·수정·삭제·공감·실시간 갱신
- `config.js` : Supabase 프로젝트 연결 정보
- `supabase_setup.sql` : DB와 보안 함수 일괄 생성 SQL
- `.nojekyll` : GitHub Pages에서 파일을 그대로 배포하기 위한 파일

## 1. Supabase 설정

1. Supabase 프로젝트를 엽니다.
2. 왼쪽 메뉴에서 **SQL Editor → New query**로 이동합니다.
3. `supabase_setup.sql` 전체를 붙여넣고 **Run**을 누릅니다.
4. **Settings → API Keys**에서 다음 값을 확인합니다.
   - Project URL
   - Publishable key (`sb_publishable_...`)
   - 오래된 프로젝트라 Publishable key가 없다면 Legacy `anon` key 사용 가능
5. `config.js`를 열어 두 값을 교체합니다.

```js
window.ASRC_CONFIG = {
  SUPABASE_URL: "https://실제프로젝트ID.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_실제키"
};
```

> 브라우저용 `Publishable key` 또는 Legacy `anon` key만 사용하세요. Secret key와 `service_role` key는 절대로 넣지 마세요.

## 2. GitHub Pages 배포

1. GitHub에서 새 저장소를 만듭니다. 예: `asrc-meeting`
2. 이 폴더 안의 파일을 **폴더째가 아니라 파일들만** 저장소 최상단에 업로드합니다.
3. 저장소의 **Settings → Pages**로 이동합니다.
4. **Build and deployment → Source**를 `Deploy from a branch`로 선택합니다.
5. Branch를 `main`, Folder를 `/(root)`로 선택하고 **Save**합니다.
6. 배포가 끝나면 Pages 화면에 사이트 주소가 표시됩니다.

일반적인 주소 형식:

`https://깃허브아이디.github.io/asrc-meeting/`

## 운영 메모

- 의견은 모든 기기에서 동일하게 보입니다.
- 수정·삭제용 4자리 비밀번호는 Supabase DB에 해시로 저장됩니다.
- 공감 여부를 구분하기 위해 브라우저별 임의 ID를 로컬 저장소에 저장합니다.
- 로그인 없는 공개 링크이므로 링크를 아는 사람은 의견을 작성할 수 있습니다.
- 회의 일시·장소·안건은 `script.js` 상단의 `meetings` 내용을 수정하면 됩니다.
