# POSEIDON V6.30

## Smart Safety Ball UI
- Safety Ball 앱의 정보 구조를 참고한 O2 / CO / H2S 3가스 대형 게이지 화면을 추가했습니다.
- 선택 장치, 수신 상태, 배터리, 최근 수신, 경보, GPS, 검교정 상태를 한 화면에서 확인합니다.
- 다중 현장 장치, 가스 측정 이력, 관리자 검교정 관리 기능은 유지합니다.
- Safety Ball 관련 패널 제목과 본문이 테두리에 붙지 않도록 내부 여백을 확대했습니다.

## 연결 구조
- iPhone 네이티브 Safety Ball 앱 자체를 Cloudflare 웹페이지 안에서 실행하는 방식은 지원하지 않습니다.
- 실제 가스값은 기존 `/api/safety-ball/ingest` 수신 구조를 통해 POSEIDON 화면에 표시합니다.
