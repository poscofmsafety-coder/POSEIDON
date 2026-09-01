# POSEIDON v6.0

> YOLO11n 사람 감지 · 모바일 호환 추론 · 이벤트 자동정리 · Colab/Kaggle 학습 파이프라인

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


## PPE 학습 피드백
현장 지킴이에서 사람이 실제 안전모/보안경/마스크 상태를 확인해 학습 후보 데이터를 저장할 수 있습니다. 상세 절차는 `docs/PPE_TRAINING_GUIDE.md`를 참고하세요.


## V5.3 자동 PPE 학습모드
- 안전모/보안경/마스크 실제 상태를 선택한 뒤 30/60/120초 자동수집
- 기본 2초 간격
- 화면에 작업자 1명만 있을 때 시작 가능
- 거의 동일한 장면은 12x12 시각 지문으로 자동 제외
- 학습용 crop은 최대 512px, JPEG quality 0.62로 저장
- `/api/training/stats`에서 학습 이미지 사용량 표시
- 무료 D1 500MB/DB를 고려해 학습이미지 300MB를 소프트 상한으로 사용
