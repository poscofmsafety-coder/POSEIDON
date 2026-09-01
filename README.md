# POSEIDON v6.5

> YOLO11n 사람 감지 · 모바일 호환 추론 · 이벤트 자동정리 · Colab/Kaggle 학습 파이프라인

# POSEIDON

POSCO Future M 브라우저 기반 AI 스마트 안전지킴이 / 통합관제 프로젝트.


## V6.5 PPT형 위험구역 편집
- 관리자/사용자 모드 모두 `다각형`과 `사각형 넣기`를 지원합니다.
- 사각형 내부를 드래그해 이동하고 8개 손잡이로 크기를 조절합니다.
- 빨간 X 또는 Delete/Backspace 키로 삭제한 뒤 저장할 수 있습니다.
- 마우스, 손가락 터치, 태블릿 펜 입력을 같은 Pointer Events 편집기로 처리합니다.

## V6.1 관제 가독성·무전·음성경보 보완

- 화면 표시 박스는 머리/얼굴 ROI 중심으로 단순화하고, 전체 사람 박스는 내부 계산에만 사용합니다.
- 로그인 카드는 화면 정중앙에 배치합니다.
- 무전은 호출 전 마이크 점검, 호출/연결 타임아웃, ICE 상태 점검, 자동재생 차단 복구 버튼을 포함합니다. 사내망/이동통신망에서 P2P가 막히면 TURN 서버를 추가할 수 있습니다.
- 관리자 감지 규칙마다 자동 음성 경보를 개별 ON/OFF 할 수 있습니다.
- 대시보드 핵심 문구 `포세이돈이 위험을 포착합니다.`는 데스크톱에서 한 줄로 유지합니다.

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


## V6.2 작업중지권 알림 설정

작업중지권은 외부 서비스 설정 없이도 관리자 대시보드와 이벤트 센터에 즉시 접수됩니다.

선택적으로 이메일/문자/Webhook을 연결할 수 있습니다.

### 이메일
Cloudflare Secret:
- `RESEND_API_KEY`

환경값:
- `ADMIN_EMAIL`
- `EMAIL_FROM`

### 문자
Cloudflare Secret:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`

환경값:
- `TWILIO_FROM_NUMBER`
- `ADMIN_PHONE`

### Webhook
- `NOTIFY_WEBHOOK_URL`

운영에서는 API Key/Token을 GitHub에 커밋하지 말고 Cloudflare Secret으로 등록하세요.


## V6.3 반응형 UI · 현장 위험구역 편집

- 작업중지권 긴급 알림과 전후 영상 뷰어를 PC/태블릿/휴대폰 화면 중앙에 표시합니다.
- iPhone/iPad/Android/갤럭시탭/PC에서 터치 영역, Safe Area, 카드 배치가 화면 폭에 맞게 재배치됩니다.
- 사용자 모드에서 현재 카메라를 보며 위험구역을 직접 설정할 수 있습니다.
- 다각형: 3곳 이상 터치/클릭, 꼭짓점 드래그 조정.
- 사각형: 자동 삽입 후 내부 드래그로 이동, 모서리 드래그로 크기 조절.
- 모바일 세로 카메라도 전체 영상을 잘라내지 않고 좌표를 원본 영상 기준으로 저장합니다.
- 사용자 위험구역 저장 API는 보호구/음성 등 다른 장치 설정을 변경하지 않고 위험구역 필드만 갱신합니다.


## V6.4 작업중지 영상 안정화 · KPI 드릴다운

작업중지 전/후 영상을 분리 저장하고 HTTP Range 재생을 지원합니다. 대시보드 KPI는 상세 데이터로 직접 이동하며 작업중지권 발동 건수를 별도 표시합니다.


## V6.6 스마트 안전보건법령 검색

관리자와 현장 사용자가 POSEIDON 안에서 안전보건 법령과 KOSHA GUIDE를 검색할 수 있습니다.

운영 환경에서는 공공데이터 인증키를 GitHub 코드에 넣지 말고 Cloudflare Secret `KOSHA_API_KEY`로 등록하세요.
검색 결과는 현장 참고용이며 법적 판단이 필요한 경우 최신 공식 원문과 담당부서 확인을 병행합니다.
