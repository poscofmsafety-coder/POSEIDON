# POSEIDON V6.6 - 스마트 안전보건법령 검색

- 관리자/사용자 모드 공통 `스마트 안전보건법령` 메뉴 추가
- 관리자 통합 대시보드에 법령 빠른검색 카드 추가
- 사용자 현장 지킴이 화면에 법령 빠른검색 카드 추가
- Cloudflare Worker에서 한국산업안전보건공단 SmartSearch API 프록시
- 산업안전보건법/시행령/시행규칙/산업안전보건기준에 관한 규칙/중대재해처벌법 계열을 우선 정렬
- KOSHA GUIDE 및 안전보건 자료를 같은 화면에서 표시
- 법령 결과는 국가법령정보센터 공식 원문으로 연결
- PC/태블릿/스마트폰 반응형 검색 UI
- `KOSHA_API_KEY`는 GitHub에 하드코딩하지 않고 Cloudflare Secret으로 사용

## 운영 설정
Cloudflare Worker의 Variables and Secrets에서 `KOSHA_API_KEY`를 Secret으로 등록합니다.
