# 프로젝트 진행 현황 및 향후 방향

작성일: 2026-02-13

## 1) 현재 진행상황

### 아키텍처/기반

- 모노레포(workspaces) 구조가 정리되어 있음: `apps/web`, `apps/api`, `packages/shared`.
- 공통 스크립트(`dev`, `build`, `test`, `typecheck`, `docker:up/down`)가 루트에 정의되어 기본 개발 루프가 안정적임.
- Prisma 스키마 기준으로 카드 식별, 외부 상품 매핑, 가격 스냅샷 모델이 이미 구성됨.

### Web (`apps/web`)

- 핵심 사용자 플로우 구현됨: 이미지 업로드/카메라 촬영 -> 인식 요청 -> 후보 선택 -> 시세 조회.
- 이미지 품질 경고, 자동/수동 크롭, 저신뢰도 후보 선택 UX 등 실제 사용 시나리오를 반영한 기능이 포함됨.
- 수동 검색(`setCode`, `number`, `variant`)으로 OCR 실패 시 우회 경로가 제공됨.

### API (`apps/api`)

- `/recognize`에 OCR 기반 인식 파이프라인이 구현됨(이미지 디코딩, 전처리, 크롭, 후보 생성/후처리).
- `/cards/search`, `/cards/:cardId/prices`, `/health` 엔드포인트가 동작하도록 구성됨.
- 가격 수집은 US/JP/KR 공급자 연동 로직 + 환경변수 미설정 시 스텁 폴백이 적용됨.
- 카드 카탈로그 업서트 및 외부 매핑 저장 로직이 구현되어 데이터 축적이 가능한 상태임.

### Shared (`packages/shared`)

- Market/Language/CardVariant/PriceResponse 등 핵심 계약 타입이 정리되어 Web-API 간 계약이 일관됨.

### 현재 검증 결과

- `pnpm -r typecheck`: 통과
- `pnpm -r test`: 통과 (shared 1 passed / web 7 passed / api 19 passed, 4 skipped)
- `pnpm -r build`: 통과
- OCR opt-in 검증:
  - `RUN_OCR_PIPELINE_SMOKE=true pnpm -C apps/api test -- tests/recognize-pipeline.smoke.test.ts`: 통과
  - `RUN_OCR_BENCHMARK=true pnpm -C apps/api test -- tests/recognize-benchmark.test.ts`: 통과
  - 확장 벤치마크(24 samples) 기준 평균 지연: wall 1308ms / pipeline 1301ms

## 2) 개선되어야 할 점

### 우선순위 높음 (단기)

1. 테스트 깊이 부족
   - 현재 테스트는 기본 smoke 수준으로, 인식/가격/매핑 핵심 로직의 회귀를 막기 어려움.
   - API 통합 테스트(컨트롤러 + 서비스 + Prisma mock/테스트 DB)가 필요함.
   - OCR 벤치마크 기준 confidence가 낮은 샘플(0.18~0.30) 구간이 있어, 정확도 개선 전담 작업이 필요함.

2. Web 화면 단일 파일 과대화
   - `apps/web/app/page.tsx`가 1000+ 라인으로 상태/뷰/이미지 처리/네트워크 로직이 과도하게 결합됨.
   - 기능 단위 컴포넌트/훅 분리 없이는 변경 비용과 버그 리스크가 빠르게 증가함.

3. 운영 환경 대비 부족
   - 가격 캐시/로그가 메모리 중심이라 다중 인스턴스 운영 시 일관성이 깨질 수 있음.
   - Redis를 실제 캐시 계층으로 붙이고 TTL/키 정책을 명확히 해야 함.

4. 문서와 구현 간 불일치
   - `README.txt`에는 인식/가격이 스텁 위주로 설명되어 있지만, 실제 코드는 상당 부분 구현되어 있음.
   - 신규 인원이 문서만 보면 현재 상태를 과소평가할 가능성이 큼.

### 우선순위 중간 (중기)

1. API/Shared lint 체계 부재
   - `apps/api`, `packages/shared`는 lint가 사실상 비활성 상태.
   - 코드 스타일/안전성 규칙이 누락되어 장기적으로 품질 편차가 커질 수 있음.

2. 관측성(Observability) 부족
   - 실패율, OCR confidence 분포, 공급자별 응답시간/실패율 등 운영 지표가 체계적으로 수집되지 않음.
   - 현재 로그는 디버깅에 유용하지만 서비스 운영 대시보드 수준으로는 부족함.

3. 에러/보안 가드레일 보강 필요
   - 대용량 이미지 요청, 외부 API 실패 폭주, 악성 반복 요청에 대한 제한(레이트리밋/서킷브레이커/타임아웃 정책) 강화 필요.

## 3) 권장 진행 방향

### Phase A (1~2주): 안정화 중심

- API 통합 테스트 세트 구축: `/recognize`, `/cards/search`, `/cards/:id/prices` 우선.
- Web `page.tsx` 분해:
  - 업로드/카메라/크롭 영역
  - 후보 리스트 + 선택 영역
  - 수동 검색 + 가격 표시 영역
  - API 호출 훅(`useRecognize`, `usePrice`, `useCardSearch`) 분리
- README/운영 가이드 최신화(현재 구현 상태 기준으로 재작성).

### Phase B (2~4주): 운영성/신뢰성 강화

- Redis 실캐시 도입(가격 조회 캐시를 인메모리에서 외부 캐시로 전환).
- 공급자별 실패 처리 정책 정리(재시도 횟수, fallback 기준, 타임아웃).
- 인식/가격 지표 수집 추가(성공률, p95 latency, confidence histogram).

### Phase C (4주+): 정확도/제품성 고도화

- OCR 후보 스코어링 개선(언어별 보정, set/number 힌트 가중치 재설계).
- 카드 카탈로그 품질 관리(중복/오매핑 탐지, 관리자 보정 루프).
- 사용자 피드백 루프(오인식 신고 -> 재학습/룰 보정 입력) 구축.

## 4) 바로 실행 가능한 백로그 (추천)

1. API 통합 테스트 10개 내외 추가 (핵심 경로 + 실패 케이스)
2. `apps/web/app/page.tsx`를 4~6개 컴포넌트로 분리
3. Redis 캐시 적용 + 캐시 미스/히트 로그 추가
4. `apps/api`, `packages/shared` ESLint 설정 및 CI 체크 추가
5. `README.txt`와 `docs/price-modeling-progress.md` 최신 구현 반영 업데이트

---

## 참고한 주요 파일

- `apps/web/app/page.tsx`
- `apps/api/src/routes/recognize.controller.ts`
- `apps/api/src/routes/prices.controller.ts`
- `apps/api/src/services/card.service.ts`
- `apps/api/src/services/price.service.ts`
- `apps/api/prisma/schema.prisma`
- `packages/shared/src/index.ts`
- `README.txt`
