# POSEIDON

POSCO Future M 브라우저 기반 AI 스마트 안전지킴이 / 통합관제 프로젝트.

## Cloudflare
- Product: Workers
- Build command: 없음
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

## 프로젝트 구조
```text
POSEIDON/
├─ public/
│  ├─ index.html
│  ├─ app.js
│  ├─ ppe-worker.js
│  ├─ styles.css
│  ├─ favicon.svg
│  ├─ _headers
│  └─ build.json
├─ src/
│  └─ worker.js
├─ docs/
├─ wrangler.jsonc
├─ package.json
├─ .dev.vars.example
└─ .gitignore
```

## 보호구 규칙
근로자 보호구 화면은 안전모, 보안경, 마스크를 기본 활성화하고 안전대/후크는 선택 기능으로 구성합니다.

- HAT: OK / NF / CHECK
- GOG: OK / NF / CHECK
- MASK: OK / NF / CHECK

배포 버전 확인: `/build.json`
