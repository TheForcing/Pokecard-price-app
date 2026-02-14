# 프로젝트 진행 현황 및 향후 방향

작성일: 2026-02-14

## 1) 현재 진행상황

### 아키텍처/기반

- 모노레포(workspaces) 구조가 정리되어 있음: `apps/web`, `apps/api`, `packages/shared`.
- 공통 스크립트(`dev`, `build`, `test`, `typecheck`, `docker:up/down`)가 루트에 정의되어 기본 개발 루프가 안정적임.
- Prisma 스키마 기준으로 카드 식별, 외부 상품 매핑, 가격 스냅샷 모델이 이미 구성됨.

### Web (`apps/web`)

- 핵심 사용자 플로우 구현됨: 이미지 업로드/카메라 촬영 -> 인식 요청 -> 후보 선택 -> 시세 조회.
- 이미지 품질 경고, 자동/수동 크롭, 저신뢰도 후보 선택 UX 등 실제 사용 시나리오를 반영한 기능이 포함됨.
- 수동 검색(`setCode`, `number`, `variant`)으로 OCR 실패 시 우회 경로가 제공됨.
- 기존 단일 대형 페이지를 컴포넌트/훅으로 분리해(`UploadCameraCropSection`, `CandidatesSection`, `ManualSearchPriceSection`, `useRecognize`, `usePrice`, `useCardSearch`) 변경 안정성을 개선함.

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
- `pnpm -r lint`: 통과 (web + api + shared)
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

2. 운영 환경 대비 부족
   - 가격 캐시/로그가 메모리 중심이라 다중 인스턴스 운영 시 일관성이 깨질 수 있음.
   - Redis를 실제 캐시 계층으로 붙이고 TTL/키 정책을 명확히 해야 함.

3. 관측성(Observability) 부족
   - 실패율, OCR confidence 분포, 공급자별 응답시간/실패율 같은 운영 지표가 구조화되어 있지 않음.
   - 현재는 로그 확인 중심이라 운영 대시보드/알림 연계가 어려움.

### 우선순위 중간 (중기)

1. 에러/보안 가드레일 보강 필요
   - 대용량 이미지 요청, 외부 API 실패 폭주, 악성 반복 요청에 대한 제한(레이트리밋/서킷브레이커/타임아웃 정책) 강화 필요.

2. OCR 정확도 개선
   - confidence 낮은 샘플 구간(0.18~0.30)에 대한 후처리/가중치 개선이 필요함.

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
2. Redis 캐시 적용 + 캐시 미스/히트 로그 추가
3. API 통합 테스트 실패 경로(외부 API 실패/유효성 실패/경계값) 보강
4. OCR confidence 분포/공급자 지연시간 지표 수집 추가
5. CI에서 `pnpm lint`/`pnpm typecheck`/`pnpm test`를 필수 게이트로 고정

---

## 참고한 주요 파일

- `apps/web/app/page.tsx`
- `apps/web/app/components/*`
- `apps/web/app/hooks/*`
- `apps/api/src/routes/recognize.controller.ts`
- `apps/api/src/routes/prices.controller.ts`
- `apps/api/src/services/card.service.ts`
- `apps/api/src/services/price.service.ts`
- `apps/api/prisma/schema.prisma`
- `packages/shared/src/index.ts`
- `README.txt`
