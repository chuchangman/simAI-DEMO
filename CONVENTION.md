# front 코드 규칙

프론트 파트(`front/`)의 구조와 코드 규칙이다. 브랜치·커밋·MR은 `docs/git-convention.md`를 따른다.

## 구조

```
front/
  apps/
    admin/              관제 사이트 (데스크톱, Three.js 3D 관제·비상 2D·구역 편집·작업면 등록·TBM·설치·보정·CCTV)
      src/
        routes/         라우트 정의 (TanStack Router 파일 라우트). _app.tsx 아래가 공통 레이아웃을 쓰는 화면
        features/       화면별 도메인 폴더
          layout/       상단 바·하단 메뉴(도크) 등 공통 레이아웃
          monitor/      실시간 관제 화면 (/live): 3D 장면 또는 2D 평면 위에 이벤트 패널, 3D·2D 전환. 첫 화면(/)은 작업 관리(/work)로 보낸다
          events/       위험 이벤트 목록·상세·ACK·경보 배너·경보음
          plan/         2D 평면 (3D 가 멈췄을 때의 비상 화면, BEV 2D 개요). three.js 없이 SVG
          zones/        구역 조회·속성 입력·저장(새 버전)·현장 적용(구성 묶음 발행)·구역 편집 화면
          surfaces/     작업면(OBB) 조회·등록·저장(새 버전)·현장 적용 화면 (/surfaces)
          cctv/         CCTV 화면 (/cctv): 현장 노트북 중계의 루프백 미리보기, 아니면 EC2 원격 시청을 WebCodecs 로 4분할 표시
          work/         작업 관리 화면 (/work): 월 달력 → 날짜별 TBM 보고서 → 세팅(setup 화면 임베드) → 작업 전 확인(서명) → 작업 종료(제출·잠금), 지난 날짜 다시 보기
          setup/        현장 세팅 화면 (카메라 시야·보정·맵 생성·구역 단계). 작업 관리의 날짜 화면 안에도 들어간다
          history/      작업 다시 보기 부품 (재생 엔진 연결·타임라인·CCTV 목 화면·이벤트 로그·작업 목록 조회). 화면은 work/past 가 쓰고, 옛 /history 주소는 /work 로 보낸다
          settings/     설정 화면 (/settings): 계정 메뉴의 「설정」으로 들어온다. 화면 모드(모든 계정)·경보 소리(확인 권한 계정)·GPU(관리자) 구역
          tbm/          TBM 작업 공용 부품: 가상 레이아웃 편집 창(TbmLayoutEditorDialog·layoutEditorModel)·공용 창(ModalDialog)·작업·레이아웃 API 요청과 타입
          viewer3d/     3D 관제 뷰어 (3D 담당 영역)
        hooks/          두 도메인 이상이 쓰는 훅 (useLinkAlive 등)
        lib/            http, api, queryClient, stomp, realtime, bindSession, env, alarmSound 등 두 도메인 이상이 쓰는 것
        store/          두 도메인 이상이 쓰는 스토어 (세션, 실시간 연결 상태, 3D 작업면 편집 알림, 호스트가 3D 장면 상태에서 채우는 스캔 범위)
        mocks/          개발 서버·테스트용 REST·STOMP mock (msw 핸들러, STOMP 브로커, mock 계정·실시간 시나리오)
        __tests__/      src 구조를 따름
      .env.example      환경변수 이름과 로컬 예시 값
    pwa/                반장 사이트 (휴대폰 PWA). M1에 위험 알림, M2에 조치 상태(기획서 §19.2)
  packages/
    ui/                 공통 UI 컴포넌트(shadcn)와 simAI 토큰
    contracts/          ../contracts 스키마에서 생성한 타입·검증기 (손으로 고치지 않음)
    eslint-config/      ESLint·Prettier 공통 설정 (@simai/eslint-config)
    typescript-config/  tsconfig 공통 설정 (@simai/typescript-config)
```

## 의존 방향

- 앱은 `packages/`만 import한다. `admin`과 `pwa`는 서로 import하지 않는다. 둘이 같이 쓰는 것은 `packages/`로 올린다.
- `apps/admin/src/features/viewer3d/`는 3D 담당 영역이다. 바깥에서는 입구(`@/features/viewer3d`: `Viewer3D`, `createExternalSource`, 타입)만 import하고 내부 파일을 직접 import하지 않는다. 입구는 three.js 를 끌고 오므로 첫 화면에서 쓰는 모듈(`lib/` 등)은 타입만 정적으로 import하고 값은 동적 import로 부른다(`lib/stomp.ts`).
- World(미터, 오른손, +Z 상방) → Three.js `(x, z, −y)` 변환은 `viewer3d`의 어댑터 한 곳에서만 한다(`AGENTS.md` 규칙 3). World → 2D 평면(+Y 를 화면 위로 뒤집음) 변환은 `features/plan/plan.ts`의 `toPlan` 한 곳에서만 한다.
- `features/plan`은 3D 가 멈췄을 때 쓰는 비상 화면이라(명세 13.6) three.js·`@react-three/*`·`@/features/viewer3d`를 import 하지 않는다. `__tests__/features/plan/independence.test.ts`가 소스를 검사한다.
- 앱끼리 import 금지, viewer3d 입구 규칙, `@/` alias(`../` 금지), `vitest`는 `src/__tests__`에서만 쓰기는 `apps/admin/eslint.config.js`의 `no-restricted-imports`로 막는다. 테스트는 viewer3d 내부도 직접 import할 수 있다.
- 파트 사이 필드 정의의 정본은 저장소 루트 `contracts/`다. `packages/contracts`의 생성 타입은 손으로 고치지 않고, 필요한 변경은 스키마에 먼저 요청한다(`AGENTS.md` 「계약 우선」).

## 도구

- Node 24.19.0. `front/.node-version`에 고정했고, fnm을 `--use-on-cd`로 설정하면 `front/`에 들어갈 때 자동으로 바뀐다. 다른 Node 버전이면 `pnpm install`이 거부된다(`engineStrict`).
- pnpm 11.24.0 (`package.json`의 `packageManager`). 작업 명령은 turbo로 각 패키지에 나눠 실행한다.
- 포맷은 Prettier(`@simai/eslint-config/prettier-base`), 린트는 ESLint flat config. 앱은 각자 `eslint.config.js`를 두고, `front/eslint.config.js`는 루트 수준 설정 파일만 검사한다.
- 환경변수는 앱 폴더의 `.env.example`을 `.env.local`로 복사해 채운다(`.env.local`은 커밋하지 않음). 앱은 시작할 때 `src/lib/env.ts`로 검사하고, 비었거나 형식이 틀리면 화면을 그리기 전에 멈춘다. 빌드(`vite build`)와 개발 서버도 `vite.config.ts`에서 같은 검사(`parseEnv`)로 멈춘다.
- `VITE_API_BASE_URL`은 비워 두면 화면과 같은 출처로 부른다(운영 nginx). 개발 서버는 실서버로 갈 경로를 `API_PROXY_TARGET`(기본 `http://localhost:8080`, 예: `https://simai.live`)으로 넘긴다(`src/lib/devProxy.ts`). mock 을 끄면 `/api` 전체, 켜면 `VITE_API_REAL` 경로만(비우면 넘기지 않음) 넘기고, `vite preview`는 mock 이 없어 `/api` 전체를 넘긴다. 같은 출처라 갱신 쿠키(`SameSite=Strict`)가 실리고 서버 CORS 설정이 필요 없다. 프록시는 경로를 바꾸지 않고(쿠키 `Path=/api/auth`) 브라우저 `Origin`을 대상 서버의 출처로 바꾼다. 개발 중에 base URL 로 서버를 직접 부르면 다른 사이트가 되어 갱신이 안 된다. 브라우저는 `localhost`로 연다(`Secure` 쿠키는 `http://localhost`에서만 저장된다).
- `VITE_API_MOCK=true`면 개발 서버가 `src/mocks/handlers.ts`로 REST를, `src/mocks/stompBroker.ts`·`src/mocks/realtime.ts`로 STOMP를 흉내 낸다(msw, world 10Hz·health 1Hz, 메시지는 `src/mocks/realtimeScenario.ts`). 위험 이벤트는 저절로 만들지 않는다. 이벤트 상태(`event_sequence`·`acks`)는 `src/mocks/events.ts`가 들고 이벤트 목록·ACK REST 에 답하며, ACK 를 받으면 갱신 이벤트를 `/topic/events`로 다시 보낸다. 구역·구성 묶음은 `src/mocks/zones.ts`가 들고(발행 3초 뒤 ACK), 그 구성 상태를 health 에 싣는다. 작업면·정적 객체는 `src/mocks/staticObjects.ts`가 든다(단상·책상, 서버처럼 상판 높이를 float4 로 돌려주고 이은 구역을 `zone_id` 로 가진다). 둘의 저장소와 값 검사는 `src/mocks/staticObjectStore.ts` 에 있어, 구역 한 번 저장(`POST /api/zones/commit`)을 `zones.ts` 가 서버처럼 구역·작업면·묶음 한 트랜잭션으로 처리한다(실패하면 구역·작업면을 요청 전으로 되돌린다). 히스토리 작업 목록·구간 기록은 `src/mocks/history.ts`가 그때그때 합성한다(최근 3일의 TBM 데모 작업으로, 서버처럼 아직 시작하지 않은 작업도 `status`·`actual_*` 와 함께 준다. 오늘 작업은 개발 서버에서 TBM 목(`src/mocks/tbm.ts`, 작업 날짜는 오늘)의 작업이라 작업 관리에서 시작·종료한 것이 따라온다. 구간 기록은 실시간 시나리오를 그 시각으로 만들고 가운데 2분은 비운다). `main.tsx`가 DEV에서만 켜서 빌드에는 들어가지 않는다. 프레임이 많아 msw 콘솔 기록은 끈다. 개발 도구 콘솔에서 `simaiMock.pauseHealth(5000)`(health 끊김), `simaiMock.drop()`(연결 끊김), `simaiMock.expireAuth()`(다음 ACK 를 토큰 만료 401 로 거절), `simaiMock.rejectNextBundle()`(다음 구성 묶음을 Tier 0 가 거부)로 흉내 낸다. mock 계정은 `src/mocks/accounts.ts`에 있고, 테스트도 같은 핸들러·브로커를 `msw/node`로 쓴다.
- mock 을 켠 채 일부 경로만 실서버로 보내려면 `VITE_API_REAL`에 `/api/…` 경로를 쉼표로 적는다(예: `/api/auth`면 로그인·갱신·로그아웃만 실서버). `src/mocks/startBackend.ts`가 그 경로의 mock handler 를 빼서(`src/mocks/realPaths.ts`) 처리되지 않은 요청으로 내보내고(`onUnhandledFrame: 'bypass'`), 개발 서버 프록시가 그 경로를 실서버로 넘긴다. `passthrough()` handler 를 앞에 두지 않는다(msw 3 서비스 워커에서 같은 출처의 `Accept: application/json` 요청까지 mock 없이 내보냈다). mock 은 `src/mocks/mockUser.ts`로 mock 토큰(`mock-token.{id}`)과 실서버 JWT(payload 의 `sub`·`role`·`exp`, 서명은 보지 않음)를 함께 읽는다. 만료된 JWT 는 ACK mock 만 401 로 거절하고, STOMP mock 은 만료를 보지 않는다. 모두 mock 일 때 갱신 쿠키는 mock 로그인이 `Set-Cookie`로 주고 msw 가 저장해 새로고침에도 남는다.
- 계약 타입·검증기는 `packages/contracts`가 저장소 루트 `contracts/`에서 만든다(`pnpm --filter @simai/contracts generate`, 결과는 `src/generated`). 지금은 관제 앱이 STOMP로 받는 I2 메시지 4종(`world_state`, `risk_event`, `viewer_health`, `avatar_frame`)만 만든다. 늘리려면 `scripts/generate.mjs`의 `MESSAGES`에만 더한다(목록 `MESSAGE_TYPES`·`MessageByType`·검증기를 함께 만든다). 계약이 바뀌면 다시 만들어 커밋하고, `pnpm lint`는 생성물이 계약과 다르면 실패한다(`check:generated`, 줄바꿈 차이는 보지 않는다). 생성물은 `packages/contracts/.gitattributes`로 LF 로 체크아웃한다. 검증기는 미리 만든 코드라 브라우저에서 스키마를 컴파일하지 않는다(CSP `unsafe-eval` 불필요). 계약 예제가 바뀌어도 잡도록 contracts 테스트는 turbo 캐시를 쓰지 않는다.
- 받은 메시지는 `isMessageType(msg_type)`으로 아는 종류인지 먼저 보고 `validateMessage(msg_type, data)`로 검사한다. 생성 타입은 오타가 걸리도록 닫혀 있지만(모르는 필드 없음), 실행 중 검증은 계약대로 모르는 필드를 받는다.

| 명령 (`front/`에서)                 | 하는 일                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `pnpm install`                      | 의존성 설치, git 훅 연결(`core.hooksPath` = `front/.husky/_`) |
| `pnpm dev`                          | 개발 서버 (`pnpm --filter admin dev`로 앱 하나만)             |
| `pnpm build`                        | 전체 빌드                                                     |
| `pnpm lint`                         | 전체 ESLint, 계약 생성물이 최신인지 검사                      |
| `pnpm typecheck`                    | 전체 `tsc --noEmit`                                           |
| `pnpm test`                         | 전체 테스트                                                   |
| `pnpm format` / `pnpm format:check` | Prettier 적용 / 검사                                          |

git 훅 (`front/.husky/`):

- `pre-commit`: 스테이징된 파일에 `front/`가 없으면 그냥 통과한다. 있으면 lint-staged(ESLint `--fix`, Prettier)와 `typecheck`를 돌리고, 실패하면 커밋을 막는다.
- `commit-msg`: 첫 줄이 `[S15P31A101-번호] `로 시작하지 않으면 커밋을 막는다. `Merge`, `Revert`, `fixup!`, `squash!`는 통과한다.

## 코드

### 파일 배치

- `src/routes/*.tsx`는 라우트 정의(`createFileRoute`, `validateSearch`)만 갖는다. 화면 본문은 `src/features/<도메인>/<Name>Page.tsx`에 둔다.
- 도메인 폴더 하나가 한 화면을 책임진다: `<Name>Page.tsx`, `api.ts`, `types.ts`, `use*.ts`, 그 화면 전용 컴포넌트.
- 두 도메인 이상이 쓰는 것만 `src/hooks/`, `src/lib/`로 올린다.
- import는 상대 경로 대신 `@/` alias(`@/*` → `./src/*`)를 쓴다.

### 데이터

- 컴포넌트에 fetch, try/catch, pending 상태를 두지 않는다. `use*.ts` 훅으로 빼고 컴포넌트는 `{ data, pending, error }`처럼 결과만 받는다. 서버 데이터를 다루는 훅의 안쪽은 TanStack Query다.
- REST는 `src/lib/api.ts`의 인스턴스(`src/lib/http.ts`의 `createHttp`)를 거친다. 응답은 zod 스키마로 검사한다. 실패는 `ApiError`로 올라온다. `kind`는 `HTTP`(4xx·5xx), `NETWORK`, `TIMEOUT`(기본 10초), `INVALID_RESPONSE`(성공 상태인데 본문이 JSON 이 아니거나 스키마와 다름)이고, 응답을 못 받았으면 `status`는 0이다. 서버 문구(`serverMessage`)는 `message`에 넣지 않고, 보여 줄지는 훅이 정한다(4xx 만). 서버 메시지가 없으면 훅이 든 한국어 기본 문구를 쓴다.
- Query 기본값(`src/lib/queryClient.ts`): 4xx·`INVALID_RESPONSE`는 다시 보내지 않고 연결 실패·시간 초과·5xx만 두 번까지 다시 보낸다. 창 포커스 때 다시 받지 않는다. mutation 은 다시 보내지 않는다.
- STOMP 연결은 앱에 하나다(`src/lib/stomp.ts`의 `createRealtime`, 인스턴스는 `src/lib/realtime.ts`). 로그인·로그아웃·계정 바뀜에 맞춰 `src/lib/bindSession.ts`가 열고 닫으며, 화면은 연결을 다루지 않는다. 토큰은 연결·재연결마다 `beforeConnect`에서 `authSession.freshToken`으로 받아 CONNECT 헤더에 싣는다(만료 1분 전부터는 먼저 갱신한다. STOMP 는 REST 처럼 401 을 받아 갱신할 길이 없다). 같은 사용자의 토큰 갱신으로는 연결을 다시 열지 않는다. 구독 토픽은 `/topic/world`·`/topic/health`·`/topic/events`다. 연결이 (다시) 열리면 `/topic/health` 를 기다리지 않고 `GET /api/health`(FE 제안 형식: viewer_health 메시지 그대로, `features/layout/useHealthSnapshot`)로 지금 상태를 먼저 채운다. 그 사이 더 새 health 를 받았으면 덮지 않고(`seedHealth`), 실패하면 알리지 않고 `/topic/health` 를 기다린다.
- 받은 본문은 세션마다 만든 3D 뷰어 Source(`createExternalSource`)로 그대로 넘긴다. STOMP 는 3D 뷰어 코드(three.js 묶음)를 기다리지 않고 연결하고, Source 는 뷰어 코드를 받는 대로 붙인다. Source 는 구독 전 메시지를 남기지 않으므로, 연결은 계약을 통과한 가장 새 world·health 와 이벤트별 가장 새 risk_event(넘치면 해소된 것부터 뺌)를 두었다가, 화면에 준 Source 를 3D 뷰어가 구독하는 순간(늦게 붙거나 다시 띄움) 그 뷰어에 넘긴다(`withReplay`). 3D 뷰어에는 앱 처리 뒤에 넘기고 실패를 가둔다(3D 가 고장 나도 2D·경보는 계속 받는다). `world_state`는 앱도 검사해 최신 프레임 하나를 `realtime.store`의 `world`에 둔다(2D 평면용, `t_latest_global`이 더 새 것만, 재연결 뒤 첫 프레임이나 1.5초 넘게 못 받은 뒤의 프레임은 순서와 상관없이 받음). `viewer_health`는 앱도 검사해 `src/store/realtime.store.ts`에 두고(상단 바), health 가 3초 넘게 없으면 연결 끊김으로 본다(`isLinkAlive`). 이벤트 목록처럼 화면이 따로 쓰는 메시지는 해당 Query 캐시를 갱신한다.
- 실시간 위험 이벤트는 Query 키 `['events', 'live']` 하나에 모은다(`features/events/eventsCache.ts`). 첫 목록은 REST 로 받고, `/topic/events`는 `bindEventsCache`가 같은 캐시에 합친다(`mergeEvent`: `event_sequence`가 같거나 작으면 버리고, 확인 기록 `acks`만 합친다). STOMP 로 먼저 받은 것만 있으면 목록을 받은 것이 아니므로 `loaded`로 따로 표시하고, 목록을 받을 때까지(STOMP 재연결 뒤 포함) 다시 시도한다. ACK 는 응답이나 서버가 보낸 갱신 이벤트로 그린다.
- 구역(`GET·POST·PUT /api/zones`)과 구성 묶음(`GET·POST /api/config-bundles`)은 BE -120 형식을 따른다(`features/zones/types.ts`, 서버 `domain/zone`·`domain/config`). 목록은 구역 배열이고, 형상은 바닥 다각형(`polygon_xy`, 닫는 점 없음)과 높이(`z_min_m`·`z_max_m`, 입체 판정 `VOLUME_3D` 면 둘 다 있어야 한다)로 오며, 화면은 그것을 감싸는 상자로 본다. 3D 뷰어 Source 에는 상자 형식(`toViewerZones`)으로 넘긴다(`pushZones`, 뷰어가 준비됐을 때도 다시 넘김). 상자 편집기로 형상을 고칠 수 있는 것은 축에 맞춘 직사각형이고 높이가 있는 구역뿐이다(아니면 속성만 고친다). 저장은 덮어쓰지 않고 새 버전이다(서버가 지금 버전을 닫는다). 서버는 고치기 시작한 버전을 받지 않아 동시에 부딪친 저장만 409(`CONCURRENT_EDIT`)다. 속성 입력은 고친 칸만 들고 나머지는 받은 최신 버전을 보이며(409 로 다시 받은 다른 사람의 변경을 덮지 않는다), 화면에 없는 칸(`has_guardrail`·`requirements`)과 손대지 않은 칸은 받은 값을 그대로 보낸다. 구성 묶음을 발행해야 현장에 간다(명세 3.2). 구역 편집의 저장은 `POST /api/zones/commit` 한 번이다(`features/zones/zoneCommit.ts` 가 본문을 만들고 `useZoneCommitMutation` 이 보낸다): 구역(`zone.op` CREATE·UPDATE·ARCHIVE·KEEP)과 이은 작업면(`surface.op` CREATE·UPDATE·REPLACE·ARCHIVE)을 서버가 한 트랜잭션으로 저장하고 묶음 발행(`publish`)까지 하며, 어느 단계든 실패하면 아무것도 바뀌지 않는다. 보내기 직전에 이번에 덮거나 보관할 구역·작업면의 지금 버전을 다시 받아 고치기 시작한 버전과 다르면 보내지 않는다. 묶음을 만들 수 없는 현장(보정 문서 없음·공개 주소 미설정: 409 `CURRENT_CALIBRATION_MISSING`·`CALIBRATION_MISSING`·`RULES_MISSING`, 503 `PUBLIC_URL_NOT_SET`)이면 서버가 저장까지 되돌리므로 같은 본문을 `publish: false` 로 한 번 더 보내 저장만 하고, '저장했지만 현장 판정으로 보내지 못했습니다' 띠의 「다시 보내기」(`POST /api/config-bundles`)로 발행한다. 저장하면 그 구역의 초안을 통째로 지우고, 실패하면 서버에 아무것도 저장되지 않았으므로 초안을 그대로 둔다. 실패 문구는 서버 오류 `code` 를 먼저 보고 상태로 떨어진다(`commitErrors.ts`, `/commit` 의 404·409 는 뜻이 여럿이다). 구역과 작업면의 연결은 서버가 작업면에 저장한 `zone_id` 를 읽는다(`linkSurfaces`: 지금 구역에 걸린 것만, 한 구역에 여럿이면 작업면 ID 순 첫 번째). 기하로 다시 계산하지 않으며, 작업면 중심이 구역 밖인지는 작업면을 새로 만들거나 바꿀 때만 막는다(구역만 고칠 때는 막지 않는다). 적용 상태는 최근 묶음 목록(새것부터)의 첫 묶음 `status` 로 알고, 적용 대기(`PENDING`) 동안 3초마다 다시 받는다(`/topic/health` 의 `config` 는 발행·적용 버전과 sync 만 주어 상단 바가 쓰고, 거부·불일치와 현장이 쓰는 묶음은 묶음 목록에만 있다). 거부·불일치면 현장이 계속 쓰는 묶음(`last_ack.active_config_version`)을 함께 보이고 다시 발행할 수 있다. 마지막 묶음 발행 시각보다 늦게 저장한(`valid_from`) 구역을 발행 전으로 보인다(묶음이 없으면 모두).
- 작업면(`GET·POST·PUT /api/static-objects`, 서버 `domain/geometry`, BE -120)은 정적 객체 중 `WORK_SURFACE`만 다룬다(`features/surfaces`. 장애물 `OBSTACLE`은 빼고, 삭제 API 는 없다). 목록은 항목마다 검사해 틀린 항목·같은 ID 둘·바닥 ID(`floor`)를 빼고, 본문 OBB 는 바닥(Z=0)부터 상판까지(가운데 z = 상판/2, 높이 = 상판)로 보내며 yaw 는 [-π, π] 로 접는다(화면은 도로 보이고 받는다). 서버가 상판 높이를 float4 로 돌려주므로 형상 비교는 1e-6 차이를 같다고 본다. 저장은 새 버전이고(구역 편집 저장 `/commit` 에 함께 실린다), 서버는 고치기 시작한 버전을 받지 않아 보내기 직전에 목록을 다시 받아 고치기 시작한 버전과 다르면 보내지 않는다(다시 저장하면 그 버전을 기준으로 보낸다). 목록 항목의 `zone_id` 는 이은 구역이고 보관한 구역 ID 일 수 있다. 서버는 구역당 지금 작업면 하나만 받는다(409 `SURFACE_ZONE_TAKEN`). 현장 적용은 구역과 같은 구성 묶음 발행이고(`useConfigApply(zones, surfaces)`), 작업면 등록 화면의 발행 전 건수는 구역·작업면을 함께 센다(발행이 둘 다 보낸다). 작업면은 작업면 등록 화면(`/surfaces`)만 3D 뷰어 Source 에 넣고(`pushWorkSurfaces`, 뷰어가 준비될 때도 다시 넣음) 떠날 때 빈 목록으로 지운다. 관제·구역 화면 3D 에는 넣지 않는다(작업면 상자가 구역 상자와 겹쳐 고르기가 엉킨다). 틀(`SpatialViewportHost`)은 3D 작업면 선택을 `object:<id>` 키로 내고, 작업면 편집 알림(`onObjectEditPreview`·`onObjectEditResult`)을 `store/objectEdit.store.ts`로 넘긴다. 뷰어 편집은 늘 등록 형상에서 시작하므로 남긴 초안을 다시 열 때는 바뀐 칸을 `updateObjectEditField`로 다시 넣는다. 끝내기는 바뀐 형상을 초안으로 남기고, Esc·취소는 그 편집만 버린다(그 전 초안은 둔다). 다른 대상 선택·2D 전환·원본 변경으로 끝나면 마지막 미리보기를 초안으로 남긴다. 새 작업면 상자는 끝내면 장면에서 사라지므로 저장할 때 먼저 끝내고 그 형상을 보낸다.
- 시스템 상태 화면은 없다(관제 데모와 같이 지웠다). `features/system/health.ts` 의 `cameraRows` 만 남아 대시보드 카메라 칸과 CCTV 가 `viewer_health.tier0_health`(I1 health 원문, 계약은 객체인지만 검사)에서 카메라 칸만 느슨하게 읽는다(형식이 틀린 칸만 비우고 id 가 없는 카메라만 뺌, `tier0_link` 가 CONNECTED 가 아니면 읽지 않음). 시스템 지표 API(`GET /api/metrics`)는 화면에서 쓰지 않는다.
- CCTV 화면(`features/cctv`, 명세 3.3·16장, FR-133)은 현장 노트북 로컬 미리보기를 먼저 짧게(1.5초) 시도하고, 안 되면 EC2 원격 시청으로 붙는다(S15P31A101-400, `cctvView.ts`. 관리자 JWT 로 `POST /api/cctv/remote/tickets` 일회용 입장권 → STOMP 주소와 같은 EC2 의 `/ws/cctv/view?ticket=…`, 연결마다 새 입장권, 같은 형식에 `status`(live·waiting_source·viewer_limit·monthly_quota) 가 더해짐. 원격만 탭이 숨으면 닫고 보이면 다시, 입력 없음 10분·한 번 시청 30분이면 멈추고 "다시 보기", viewer_limit·monthly_quota 로 닫히면 다시 붙지 않음. 월 송출 표시(`GET /api/cctv/remote/status`)는 화면에서 지웠다(S15P31A101-546). 한도에 닿으면 시청 상태(`monthly_quota`)와 「다시 보기」 안내만 남는다). 로컬은 같은 노트북의 영상 중계(`gateway/relay --preview-port`)가 127.0.0.1 WebSocket(`VITE_CCTV_PREVIEW_URL`, 기본 `ws://127.0.0.1:47032`, 루프백 주소만)으로 보내는 H.264 를 카메라마다 WebCodecs `VideoDecoder` 하나로 풀어 캔버스에 그린다(형식 `contracts/messages/cctv_preview`, STOMP 메시지가 아니라 생성 대상이 아니어서 `types.ts` 의 zod 로 같은 규칙을 두고 계약 예시·반례로 시험한다). 연결·디코딩은 `previewSession.ts` 가 소켓·디코더를 주입받아 하고(시험은 가짜), 화면 상태(연결, 카메라 단계, 마지막 프레임 촬영 시각은 카메라마다 0.25초에 한 번)는 `cctv.store.ts` 에 둔다. 중계와 이어져 있지 않으면(연결 중·붙지 못함·WebCodecs 없음) 상태 줄(`tileLabel`: 연결 중·중계 끊김) 아래에 목 화면(`CctvDemo`, 관제 데모와 같다)을 보인다. 목 화면은 카메라 4대 자리에서 본 교실에 지금 받는 World 위치의 사람을 그린 그림이고(`cctvMockView.ts`), health 카메라 상태가 정상이 아니면 그 칸은 신호 없음이다. 설계 `docs/design/cctv-local-preview.md`.
- 이벤트 클립(`features/clips`, FR-59)은 관리자만, LIVE CRITICAL·HIGH 이벤트 상세에서 본다. 응답은 서버 구현(`docs/design/server-event-clips.md`)의 실제 형식이다(클립 칸 이름은 계약 `media_clip` 과 같고 EC2 가 `auto_retained`·`deleted_at_ms` 등을 더한다, BE 곽나혁). 재생 주소는 재생을 누를 때만 받는다(EC2 가 조회 기록을 남긴다). 서버는 영상을 변환하지 않아 `h264-annexb` 원본은 브라우저가 MP4 로 감싸 재생하고(`clips/mp4.ts`, 재인코딩 없음), `mp4` 는 그대로 재생한다. 지운 클립은 목록에 `deleted_at_ms` 로 남고 재생 주소는 410 `CLIP_DELETED` 다. 보존 표시는 낙관적으로 바꾸지 않고 목록을 다시 받아 그린다. 목록은 상세를 보는 동안 다시 받고, 실패해도 받아 둔 목록은 둔다(4xx·형식 오류면 상세를 다시 열 때까지 받지 않는다).
- 히스토리(`features/history`, FR-28·29)에는 작업 다시 보기 부품만 남았다. 옛 목록(`/history`)·다시 보기(`/history/$workId`) 화면은 작업 관리(`/work`)의 지난 날짜 다시 보기(`features/work/past`)로 합쳤고, 옛 주소는 `/work` 로 보낸다. 작업 목록 `GET /api/work-units?days=7` 은 서버의 실제 응답 `{ works }` 이고(docs/design/server-work-units.md, mock 도 같은 모양), 구간 기록 `GET /api/replay?from&to&step_ms`(명세 12.6)는 서버의 실제 응답이다(world_states·initial_events·events·gaps, mock 도 같은 모양). 화면은 서버의 실제 시작 기록(`actual_started_at`)이 있는 작업(진행 중·끝난 작업)만 쓰고(`startedWorks`), 다시 보는 구간은 실제 시작부터 실제 종료까지다(진행 중이면 그 작업이 화면에 처음 보인 때까지, 길이가 없으면 "아직 다시 볼 구간이 없습니다.", `replayRange`). 하루 작업 안에서 실행(작업 시작 ~ 작업 종료)을 여러 번 했으면(S15P31A101-696, 서버 `runs`, `lib/workRuns.ts`) 지난 날짜 화면이 실행을 골라 그 실행 구간만 다시 본다(기본은 마지막 실행, 실행 사이는 받지 않는다). 1시간·3000 칸을 넘는 구간은 창으로 나눠 받아 합친다. 구간 기록은 world_state·risk_event 메시지 원문이고, 3D 입구의 재생 엔진(`parseReplayLog`·`createReplaySource`, 동적 import)이 검사하고 재생한다. 기록된 이벤트(LIVE)는 재생 출처(REPLAY)로 바꿔 넣는다(재생 엔진이 REPLAY 만 받고, 실제 알림 경로와 섞이지 않는다). 기록 간격은 작업 길이로 정해 한 작업에 3,000 프레임을 넘지 않게 하고(100ms 단위), "데이터 없음"은 서버가 준 gaps 안에서 보이는 기록이 없을 때만이다(gaps 밖에서 기록이 없으면 그 시각에 사람이 없던 것이고, 보간하지 않는다). 가운데 칸은 CCTV 목 화면(`CctvWall`)이고 재생 시각에 보이는 World 기록의 사람을 그린다(기록이 바뀔 때만 다시 그리고, 데이터 없음이면 사람 없이 흐리게 둔다). 3D·2D 맵은 두지 않는다(2026-11-03 팀 결정). 재생 엔진은 구독자가 있어야 시계를 돌리므로 화면이 따로 구독한다. 재생 상태는 0.1초마다 바뀌어 타임라인·목록만 구독한다(`useReplayStatus`). 서버가 요청보다 넓은 간격(`step_ms`)으로 기록을 주면 그 간격으로 데이터 없음을 잡는다. 작업자는 익명 World ID 로만 보이고, 확인(ACK)은 없다.
- 구간 메시지는 `packages/contracts` 검증기를 통과한 것만 쓴다(`validateMessage(msg_type, data)`).
- 낙관적 갱신을 하지 않는다. 서버가 가진 상태(ACK, 이벤트 상태 등)는 서버 응답이나 메시지가 온 뒤에 그린다.
- 렌더링 중에 부작용(외부 변수·DOM 변경, 네트워크 요청, 타이머 등록, 다른 컴포넌트 상태 변경)을 두지 않는다. Effect나 이벤트 핸들러에서 한다.

### 인증

- access 토큰은 `src/store/session.store.ts`에 메모리로만 둔다. 갱신 토큰은 서버가 주는 HttpOnly 쿠키(`simai_refresh`, `Path=/api/auth`, 14일)라 앱이 읽지 않는다. 서버 계약은 `docs/design/server-auth.md`.
- `/api/auth/*`(로그인·갱신·로그아웃)는 `features/auth/authSession.ts`만 부른다. 토큰을 싣지 않는 http(`lib/api.ts`의 `authApi`, 만료된 Bearer 를 실으면 서버가 쿠키를 보기 전에 401 로 거절한다)로 `credentials: 'include'`를 붙여 부르고, 쿠키가 꼬이지 않게 한 줄로 세운다(로그아웃은 진행 중인 갱신 뒤, 로그인은 진행 중인 로그아웃 뒤).
- 앱을 켤 때 갱신으로 로그인을 되살린다(`main.tsx`, 3초까지 기다리고 그린다). 기다리기를 그만둬도 요청은 끊지 않고(요청 시간 제한 30초만), 그 사이 로그인을 시도했으면 복구 결과를 버린다. 로그아웃은 화면을 바로 로그아웃하고 서버에 쿠키 폐기를 부탁한다. 서버에 알리지 못하면(실패·탭 닫기) localStorage 표식(`simai.logoutPending`)을 남기고, 다음에 앱을 켤 때 복구 대신 로그아웃을 다시 보낸다(공용 PC 에서 이전 사용자로 들어가지 않게). 새로 로그인하면 표식을 지운다.
- REST 가 401 이면 `lib/http`가 `authSession.refresh`로 새 토큰을 받아 한 번만 다시 보낸다. 동시에 온 401 은 갱신 하나를 같이 기다리고, 409 `REFRESH_TOKEN_ROTATED`(다른 탭이 먼저 갱신)는 잠깐 뒤 다시 갱신한다. 큐에서 기다리는 사이 세션이 바뀌면 갱신하지 않는다. 서버 꺼짐(5xx·연결 실패·시간 초과)과 계속 겹친 409 는 세션을 두고, 그 밖의 실패(401 쿠키 거부, 403·404, 본문이 틀림)는 `signOutIfCurrent(token)`으로 그 토큰이 지금 토큰일 때 세션을 끝낸다. 다시 보낸 요청도 401 이면 세션을 끝낸다.
- 화면은 `features/auth`의 훅(`useLogin`, `useLogout`, `useCurrentRole`)만 쓰고 세션 저장소·토큰을 직접 다루지 않는다.
- 로그인이 필요한 화면은 `_app` 아래에 둔다. `_app`의 `beforeLoad`가 라우터 컨텍스트의 `sessionStore`로 막는다. 세션이 바뀌면 `bindSession`이 실시간 연결을 열거나 닫고 `router.invalidate()`로 가드를 다시 돌리며, 사용자가 끝나면(로그아웃·다른 계정) 가드가 끝난 뒤 Query 캐시를 지운다. 화면에서 로그인 화면으로 `navigate`하지 않는다.

### 상태

- 화면 상태는 zustand로 관리한다. 값을 쓰지 않는 컴포넌트가 2단계 이상 props로 넘기기만 하면 스토어로 옮긴다. 바로 아래 자식에게만 넘기는 값은 props로 충분하다.
- 스토어 하나는 화면 하나의 관심사 하나만 갖는다. 새 스토어는 `src/features/<도메인>/<domain>.store.ts`에 두고, 두 도메인 이상이 쓸 때만 `src/store/`로 올린다.
- 렌더링에 쓰는 값은 selector로 구독하고(`useXStore((s) => s.value)`), 렌더 밖 콜백에서는 `useXStore.getState()`로 그 순간 값을 읽는다.
- 30 FPS로 바뀌는 World 상태는 React 상태로 두지 않는다. 스토어에 두고 3D 렌더 루프가 `getState()`로 직접 읽는다(뷰어의 데이터 저장소). 2D 평면은 world 를 쓰는 컴포넌트(`LivePlan`)만 구독해 그 층만 다시 그리고, 바탕·구역 층은 `memo`로 바뀔 때만 그린다.
- 자주 바뀌는 값(health 1Hz, 시계)은 그 값을 보이는 작은 컴포넌트가 직접 구독한다. 위 컴포넌트가 받아서 props 로 내리면 화면 전체가 다시 그려진다(`features/layout/TopBar.tsx`).
- 스토어는 컴포넌트 없이 액션과 상태 전이를 테스트할 수 있어야 한다.

### 타입

- `any`를 쓰지 않는다. 타입을 모르면 `unknown`으로 받고 좁혀서 쓴다.
- 서버와 주고받는 타입은 앱에 따로 정의하지 않고 `packages/contracts`에 둔다. 단, REST 요청·응답은 서버 OpenAPI(springdoc)가 나오기 전까지 도메인 `types.ts`에 zod 스키마로 두고, 나오면 생성 타입으로 바꾼다.

### 자동 생성물

- `routeTree.gen.ts`, `packages/contracts`의 생성물, `packages/ui`의 shadcn 컴포넌트는 직접 고치지 않는다. 생성 도구로 다시 만든다.
- import 순서와 Tailwind 클래스 순서를 손으로 정렬하지 않는다. Prettier 플러그인이 정렬한다.

### 테스트

- `src/__tests__/`에 소스 구조를 그대로 따라 둔다(예: `src/__tests__/features/<도메인>/<domain>.store.test.ts`). 테스트 코드는 이 폴더 밖에 두지 않는다.
- 대상은 순수 로직(데이터 연령 계산, 메시지 처리 등)과 훅, 스토어다. 렌더 스냅샷 테스트는 두지 않는다.
- 테스트는 서로 의존하지 않고, 어느 환경에서나 같은 결과를 낸다.
- `import.meta.env`를 읽는 모듈은 테스트에서 import하지 않는다. Vite가 테스트에도 `.env.local`을 읽어서, 그 파일이 없는 PC·CI에서만 실패한다. 검사·계산은 값을 인자로 받는 함수로 떼어 그 함수를 시험한다(`parseEnv`). 앱 REST 인스턴스(`@/lib/api`)를 쓰는 훅은 `vi.mock('@/lib/api')`로 `createHttp` 인스턴스를 시험 주소에 만들어 바꿔 끼운다(`__tests__/features/events/useLiveEvents.test.tsx`).

## 화면

- 설명용 작은 글씨(힌트, 명세 번호, "데모" 표시 등)를 화면에 넣지 않는다.
- 빨강·주황·노랑은 위험 등급에만 쓴다: 위험 `sev-critical` 빨강, 경고 `sev-high` 주황, 주의 `sev-caution` 노랑. 지연 표시는 경고와 가르려고 채도를 낮춘 주황 `delay` 를 쓴다(예외: CCTV 칸의 카메라 판정 지연 배지는 사용자 결정으로 `ok`·`sev-caution`·`sev-critical` 신호등 색이다, S15P31A101-704. 상단 바 GPU 점도 사용자 결정으로 초록 연결·노랑 깜빡임 준비 중·회색 꺼짐·빨강 오류다, S15P31A101-702. GPU 켜기 표의 VRAM 등급 표시도 사용자 결정으로 권장 미만 `sev-caution` 노랑·제한 `sev-high` 주황·위험 `sev-critical` 빨강이고 「추천」은 `primary` 다(`features/gpu/gpuStatus.ts` 의 `TIER_TONE`·`TIER_TEXT`, S15P31A101-705). 확인 대기 경보 표시처럼 이벤트 등급을 따라 색이 바뀌는 곳은 `features/events/alarmTone.ts` 의 맵을 쓴다(`sev-critical` 을 박아 경고를 빨강으로 그리지 않는다). 2D 평면은 `features/plan/plan.ts` 의 `severityTone` 이 등급을 색 이름으로 바꾼다.
- 구역 윤곽선(3D·2D)은 그 구역의 심각도 색이다. 구역 심각도는 화면에서 위험·경고만 고르고(`SEVERITY_CHOICES`), 이미 저장된 주의·안내 구역은 읽되 위험이나 경고로 다시 골라야 저장한다. 3D 는 배경에 가려진 윤곽선 부분을 깊이 검사 없이 흐리게 덧그려 늘 보이게 한다(`ZoneEdges`).
- 확인 대기 경보(`features/events/events.ts`의 `isAlarming`: LIVE·CRITICAL/HIGH·RAISED/UPDATED 이고 지금 경보 단계 뒤 ACK 가 없음)는 경보 배너·소리·점멸로 알린다. 배너와 소리는 관제 앱 어느 화면에서나 나오고(`AppLayout`의 `AlarmBanner`·`AlarmSoundLoop`), 소리는 확인 대기 경보 중 가장 높은 등급 하나만 ACK 까지 되풀이하고(위험은 880Hz 3번을 2.5초마다, 경고는 587Hz 2번을 6초마다, 주의·안내는 소리 없음), EC2 연결이 끊겨도 마지막으로 받은 상태에서 멈추지 않는다(끊긴 화면에서 확인하면 그 화면에 바로 반영하고, 연결이 돌아오면 다시 보낸다). 상단 바 소리 버튼으로 끄고 켜며(시간 제한 없음, 끔은 localStorage `simai.sound`="off"), 브라우저가 막고 있으면 버튼에 차단 표시가 붙는다. 열람 계정은 확인 권한이 없어 끌 수 없으므로 소리 없이 배너만 본다. 브라우저 자동 재생 제한 때문에 클릭·키 입력에서 소리를 깨우고, 나중에 멈춰도 다음 입력에서 다시 깨운다(`lib/alarmSound.ts`의 `installAudioUnlock`). 점멸은 `motion-safe:animate-alarm-blink`로 써서 움직임 줄이기 설정이면 멈춘다.
- 상단 바는 관제 데모처럼 로고·현장명·EC2 시계·관리자 메뉴(설치 · 보정, 화이트/다크 모드, 로그아웃)만 둔다. S15P31A101-702 부터 시계 앞에 GPU 점(점 + 「GPU」 글자만, 상태 글은 마우스 올림 정보창 첫 줄과 화면 읽기 이름(aria-label)에, 누르면 관리자 켜기·끄기 패널, `features/gpu`)을 둔다. 계정 메뉴는 「설정」 진입과 로그아웃뿐이고 화면 모드·GPU 설정은 설정 화면(`/settings`, `features/settings`)의 구역이다(S15P31A101-705). 켜기 표는 공급자 카탈로그의 모든 GPU 를 행으로 보이고(순서·추천·VRAM 등급은 서버 `GpuTiers` 가 정함), 칸 재고는 「켤 수 있음」·「없음」·「모름」만 쓴다(등급 글 많음·보통·적음은 쓰지 않음). 제한·위험 등급은 막지 않고 확인창 경고를 거쳐 켠다. 점은 Tier 0 연결만 보고, VLM 준비(GPU 세션 단계 VLLM·시한 초과 READY, `vlmReadiness`)는 세팅 구역 단계 창(`features/setup/VlmZoneNotice`)과 사건 상세 「AI 근거 준비 중」에서만 알린다(S15P31A101-706, 세션이 없거나 관리자가 아니면 지금 그대로). System Health·데이터 연령·카메라·보정·구성·장면 값은 화면에 두지 않는다(명세 FR-5·12·13 과 어긋나므로 팀과 맞출 것).
- 경보 배너는 상단 바 아래다(`AppLayout`). 모든 화면에서 내용 위에 띄우고 본문을 밀거나 줄이지 않는다(관제 데모와 같다). 실시간 관제는 이벤트 패널 자리를 비키고, 그 높이를 `--notices-h` 로 알려 사건 상세 창이 그 아래에서 시작한다.
- 색·간격 값을 새로 넣기 전에 `packages/ui`의 토큰에 이미 있는지 먼저 확인한다. simAI 토큰은 shadcn 토큰(`background`, `card`, `primary`, `muted-foreground` 등)에 더해 `surface-2`, `surface-3`, `faint`, `point-soft`, `sev-critical`, `sev-high`, `sev-caution`, `delay`, `ok`, `stripe-a`, `stripe-b`, 로고 `brand-hat`, 떠 있는 패널 그림자 `shadow-float`, 글꼴 `font-mono`가 있다(`packages/ui/src/styles/globals.css`). 컴포넌트에 색 값(`#…`, `rgba(…)`)을 직접 쓰지 않는다.
- 다크(기본)·화이트 모드는 `<html class="dark">`로 가르고, 설정 화면의 「화면」 구역에서 바꾼다(`features/layout/theme.store.ts`, 브라우저에 저장, S15P31A101-705). 토큰은 두 모드 값을 모두 두고, 값은 팀에 공유한 관제 데모와 같다(심각도 `sev-*`·`delay` 는 사용자 결정으로 데모와 다르다). `paper` 클래스를 붙인 영역(TBM 회의록 종이)은 다크 모드에서도 화이트 값을 쓴다. 3D 장면은 CSS 토큰을 읽지 못해 같은 값의 색표(`features/viewer3d/palette.ts`)를 두고(위험·경고·주의 값은 `palette.test.ts` 가 토큰과 맞춰 본다), 틀이 테마를 `Viewer3D` 의 `theme` 로 넘긴다(바꿔도 장면을 다시 만들지 않는다).
- 화면 부품은 shadcn 컴포넌트로 만든다. 필요한 컴포넌트가 없으면 `packages/ui`에서 `pnpm exec shadcn add <이름>`으로 추가하고, 모양은 쓰는 쪽의 `className`과 토큰으로 맞춘다.
- 실시간 관제 왼쪽 위 버튼은 「시점 초기화」(3D 를 처음 시점으로, `Viewer3DHandle.resetView`)이고, 3D 가 멈추면(렌더 실패·WebGL 끊김·3D 코드 받기 실패) 2D 평면으로 바꾸고 「3D 다시 시도」가 된다. 손으로 2D 로 바꾸는 토글은 없고, 2D 는 왼쪽 아래 미니맵(`features/plan/PlanMinimap`)을 눌러 큰 창으로 본다(창에서 사람·구역을 고른다). 화면에 들어와 3D 가 2초 안에 첫 화면을 그리지 못하면 그동안 2D 평면을 보인다(그보다 빨리 뜨면 2D 를 비추지 않는다). 2D 를 보다가 3D 로 바꾸면 3D 가 준비될 때까지 2D 를 그대로 둔다. 2D 일 때는 3D 뷰어를 그리지 않는다. 경보 배너·소리·이벤트 패널은 보기와 상관없이 그대로다. 이벤트 패널·미니맵은 실시간 관제에만 둔다(라우트 `staticData.eventPanel`, 구역 편집·작업면 등록에는 없음). 구역 편집 패널 맨 위는 구역 선택 드롭다운이고 기본은 「새 구역」(속성·상자 양식, 「구역 추가」로 v1 저장 뒤 3D 편집)이다.
- 실시간 관제의 왼쪽 칼럼(`MonitorSideColumn`)에는 위험 구역 목록만 있다. 작업 시작·종료는 작업 관리(`/work`)에서만 한다(날짜 화면의 작업 전 확인·작업 종료 단계, `features/work`). 오늘 남은 작업(오늘 날짜의 작업과 진행 중인 작업 중 예정·진행 중, `todayWorks`)이 없으면 대기 화면(`MonitorStandby`)이 지도 위를 덮고(`z-6`, 그림 순서에서 이벤트 패널·경보 배너·하단 메뉴보다 앞), 아래 층(도구 모음·왼쪽 칼럼·워치 패널·2D 미니맵)은 `inert` 로 마우스·Tab 을 막는다(`useMonitorStandby`; `MonitorPage` 가 칼럼·워치 패널을 `inert` 래퍼로 감싸고 대기 화면을 그 뒤에 그린다). 구역 편집 중에는 대기 화면을 그리지 않는다.
- 이벤트 패널은 머리줄을 끌어 옮기고(두 번 누르면 제자리), 가장자리 손잡이로 크기를 바꾸고(`features/events/panelBox.ts`), ▾ 로 접는다. 머리줄에 지금 추적 중인 작업자 수와 진행 중 사건 수가 있고, 목록은 「진행 중」(사람별 묶음)과 「최근 해소」(해소된 발생을 사람·규칙·구역별로 묶고 `resume_count` 와 새 `event_id` 를 더해 「N회 발생」)로 나뉜다(`eventSections`). 카드는 작업자 칩과 규칙 줄(등급·규칙 이름·구역, 확인 필요·지연 알림)만 보이고, 규칙 줄을 누르면 장면 위 사건 상세 창(같은 대상의 규칙 전부, 근거·AI 설명·클립·처리(ACK)·타임라인)이 열린다. 「CCTV로 확인」은 CCTV 관제 화면의 카메라 칸(`CameraTile`)을 오른쪽에 연다. 사라진 사람의 카드(「지금 안 보임」) 중 이 브라우저가 생긴 때와 끝난 때를 이어서 보았고 30초(`GHOST_MAX_LIFE_MS`) 안에 사라진 번호, 또는 병합으로 흡수됐는데 흡수한 사람이 보이거나 그 사람 카드가 남는 번호(유령 트랙)는 진행 중·해소 대기에서 빼 목록 끝의 접힌 칸 「잠깐 잡힌 번호 · 안 보임」에 둔다(S15P31A101-785, `splitGhostCards`, 보인 구간 기록은 `lib/trackLife`). 확인 대기 경보, 워치가 배정된 적 있는 사람, 보인 길이를 모르는 사람(화면을 연 때 이미 있었음·프레임 공백)은 접지 않는다.
- 지도 위 이름표는 늘 띄우지 않고 한 대상에 1초 머물 때만 보인다(2D 는 `features/plan/HoverTip` 말풍선, 3D 는 이름표 스프라이트). 3D 는 선택한 대상과 위험이 걸린 대상의 이름표를 늘 보인다.
- 2D 평면은 연결이 끊겼거나 world 가 1.5초 넘게 없으면(`isWorldFresh`) 흐리게 그린다. 경보 대상은 병합 전 ID(`aliases`)까지 본다. 확인 대기는 점멸에 더해 선을 굵게 해 움직임 줄이기 설정에서도 구분한다.
- 관제 화면의 상단 바와 하단 메뉴는 `features/layout`에 있다. 하단 메뉴 순서는 작업 관리 → 실시간 관제 → CCTV 관제다. 상단 바 GPU 점의 마우스 올림 정보창 「판정 지연」 줄(S15P31A101-702, 상단 바 글에서는 뺐다)과 CCTV 칸 오른쪽 위 카메라 지연 배지(초록 < 300 ms, 노랑 < 600 ms, 빨강 ≥ 600 ms)는 Tier 0 가 자기 시계로 잰 `health.pipeline_lag_ms`(카메라별은 같은 health 의 `t_latest_global − last_capture` 를 더함)의 최근 평균만 쓰고(`lib/tier0Lag`), 브라우저 시계로 촬영 시각을 빼지 않는다. 모르면 숨기고, Tier 0(GPU)가 이어지지 않았으면(`useTier0Connected`: EC2 연결 + `viewer_health.tier0_link` CONNECTED, 꺼 둔 정상 상태 포함) 지연도 칸의 「끊김」도 보이지 않는다. 실시간 관제처럼 상단 바 아래까지 화면을 채우는 화면은 라우트에 `staticData: { fullBleed: true }`를 준다. 하단 메뉴가 본문 위에 반투명하게 떠 있어도 되는 화면(CCTV 관제·작업 관리)은 `staticData: { dockOverlay: true }`를 주어 본문 아래의 독 자리 여백(90px)을 줄인다.
