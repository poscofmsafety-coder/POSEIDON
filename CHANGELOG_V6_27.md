# POSEIDON V6.27

## Smart Safety Ball keyless BLE
- SAFETY_BALL_INGEST_KEY 및 x-safety-ball-key 제거
- `/api/safety-ball/ingest`는 기존 POSEIDON 로그인 세션으로 보호
- Bluetooth 사용 가능 확인 UI 추가
- Web Bluetooth 광고 원시 데이터 진단 모드 추가
- requestLEScan 미지원 브라우저는 requestDevice 진단으로 fallback
- BLE 진단 로그 복사 기능 추가
- Permissions-Policy에 bluetooth self 추가
- 기존 가스 현황/이력/테스트/30일 보관 유지
