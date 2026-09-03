# POSEIDON V6.26 — Smart Safety Ball

- `스마트 MSDS` 아래에 관리자/사용자 공통 `스마트 세이프티 볼` 탭 추가
- O2, CO, H2S, 배터리, GPS 최신값 및 최근 이력 표시
- 외부 게이트웨이/제조사 연동용 `POST /api/safety-ball/ingest` 추가
- `SAFETY_BALL_INGEST_KEY` Cloudflare Secret으로 수신 API 보호
- 관리자용 테스트 데이터 수신 버튼 추가
- D1에 Safety Ball 이력 저장 및 30일 자동 정리
- 제조사 BLE UUID/광고 패킷 또는 공식 서버 API 규격 확보 시 실제 Smart Safety Ball과 게이트웨이 연결 가능
