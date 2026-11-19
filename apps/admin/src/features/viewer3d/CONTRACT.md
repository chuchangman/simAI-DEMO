# SpatialViewer 공개 계약

`@/features/viewer3d`(index.ts)가 이 폴더의 유일한 입구다. FE 앱 코드와 FE 시험은 내부 파일을 import 하지 않는다.
이 문서는 Spatial 이 구현해 둔 계약과 그 의미를 적는다. 화면별 정책 값과 저장 흐름은 FE 가 정하며, 여기 적힌 선택 사항을 쓸지도 FE 가 결정한다.
변경 이력은 [CHANGELOG.md](./CHANGELOG.md)에 둔다.

## 책임 경계

| 영역        | Spatial(viewer3d)                                                                           | FE                                                  |
| ----------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 형상 해석   | BE 응답 원문을 검사해 World 형상으로 바꾼다. 받기·빼기 규칙은 BE 저장 검사·Tier 0 와 맞춘다 | 응답 원문을 그대로 넘긴다                           |
| 데이터 수명 | Source 가 구역·정적 객체의 마지막 응답을 보관하고, 구독할 때 다시 보낸다                    | 로그인·로그아웃·세션·STOMP 연결, 언제 다시 조회할지 |
| 3D 조작     | 대기 선택, 미저장 초안 다시 열기, 손잡이·숫자 편집 엔진                                     | 초안 보관, 저장·버전 충돌·발행·ACK                  |
| 표시        | 레이어 값(hidden·visible·interactive)의 의미와 렌더링                                       | 화면마다 어떤 레이어 값을 쓸지                      |
| 이벤트      | 대상(person·zone·object)과 위험 강조만                                                      | 대상 → event_id 묶음, 경보 UI                       |

Viewer 는 위험을 다시 판정하지 않고, 저장 성공을 만들지 않는다(편집 결과는 늘 `saved: false`).

## 형상 입력

`ExternalSpatialSource.pushZones(result)`, `pushWorkSurfaces(result)`의 `result.raw` 는 응답 본문 그대로다. 본문 모양으로 출처를 가른다.

| 채널      | 본문                                                                 | 처리                           | 표시 출처(contract)                |
| --------- | -------------------------------------------------------------------- | ------------------------------ | ---------------------------------- |
| 구역      | 배열 = BE `GET /api/zones`(-120)                                     | `adaptOfficialZones`           | `BE_ZONES_V1`                      |
| 구역      | `{ contract: 'DEMO_UNCONFIRMED', zones }`                            | 기존 DEMO 상자(전환 기간 유지) | `DEMO_UNCONFIRMED`                 |
| 정적 객체 | 배열 = BE `GET /api/static-objects`(-58, WORK_SURFACE·OBSTACLE 모두) | `adaptOfficialStaticObjects`   | `BE_STATIC_OBJECTS_V1`             |
| 정적 객체 | `{ version?, work_surfaces?, static_objects? }`                      | 구성 묶음 모양(기존 경로)      | `OPERATIONAL_GEOMETRY_UNCONFIRMED` |

READY 는 형상을 받아 검사했다는 뜻이다. 구성 묶음 발행이나 Tier 0 적용(ACK)의 증거가 아니다. 적용 상태 표시는 여전히 `UNVERIFIED`가 기본이다.

### 정식 구역 규칙

- 꼭짓점은 3~256개, 유한수여야 한다. 닫는 점과 이어진 같은 점은 뺀다. 변이 서로 닿거나 넓이가 0 이면 거부한다(BE `ST_IsValid`·넓이 검사와 같다).
- `eval_type` 은 GROUND_FOOTPRINT 또는 VOLUME_3D, `severity` 는 CRITICAL·HIGH·CAUTION·INFO, `zone_version` 은 1 이상 정수여야 한다. `valid_to` 가 있으면 지난 버전이라 뺀다.
- VOLUME_3D 는 `z_min_m < z_max_m` 가 있어야 한다. 없으면 높이를 지어내지 않고 뺀다.
- 같은 `zone_id` 가 둘 이상이면 어느 쪽이 지금 버전인지 몰라 모두 뺀다.
- 세팅 화면이 싣는 `needs_review: true`(S15P31A101-629, 서버 응답에는 없음)는 형상·판정과 무관한 표시 힌트다. 그 구역은 옅은 채움·흐린 촘촘한 점선으로 그리고 이름표에 `확인 필요`를 붙인다.
- 표시 형상(`shape`):
  - BOX: VOLUME_3D 축 정렬 직사각형이다. 상자로 그리고 3D 상자 편집을 쓸 수 있다.
  - PRISM: 직사각형이 아닌 VOLUME_3D 다. 다각형 기둥으로 그리고, 상자 편집은 `NOT_EDITABLE` 이다.
  - FOOTPRINT: GROUND_FOOTPRINT 다. 바닥 판정면으로 그리고(높이 무관 표시), 상자 편집은 `NOT_EDITABLE` 이다.
- 비직사각형을 둘레 상자로 넓혀 위험구역처럼 그리지 않는다. `ZoneView.min·max` 는 PRISM·FOOTPRINT 에서 초점·이름표 위치에만 쓴다.

### 정식 정적 객체 규칙

BE 구성 묶음 변환(ConfigBundleService.geometry)과 똑같이 옮긴 뒤 기존 묶음 검사기로 검사한다. 그래서 Viewer 와 Tier 0 가 같은 작업면을 본다.

- WORK_SURFACE: `center_xy = obb.center[0..1]`, `size_xy = obb.size[0..1]`, `top_height_m` 은 0 보다 커야 한다. 작업면 OBB 는 바닥~상판이며, `obb.center` 의 Z 와 `size` 의 Z 는 쓰지 않는다.
- OBSTACLE: `obb` 를 그대로 쓴다(3D 중심, 바닥에서 떠 있을 수 있다).
- 모르는 `kind`, 버전 누락, 지난 버전, 형식 오류는 이유와 함께 뺀다. 같은 ID 는 앞 항목을 쓴다(묶음 규칙과 같다).
- `snapshot.objectVersions` 에 그린 객체의 `object_version` 을 싣는다. 버전은 실제로 그린 항목의 행에서 읽는다(같은 ID 가 겹치거나 앞 행이 빠져도 형상과 버전이 같은 행이다).

## Source 수명

`createExternalSource(id)` 는 FE 가 세션마다 하나 만든다. 사용자가 바뀌면 새 Source 를 만들거나 `clearSnapshot()` 한다.

| 동작                                         | 의미                                                                                                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 형상 보관                                    | 구역·정적 객체는 채널마다 마지막으로 받은 응답을 보관한다. 새로 구독하는 Viewer(재마운트·StrictMode)에 다시 보내 지금 구독 중인 쪽과 같은 상태가 된다                                          |
| 실패 응답                                    | 구독 중인 Viewer 는 REJECTED(형상 없음)가 된다. 새 구독자도 실패를 받는다(이전 정상 형상을 지금 형상으로 다시 보내지 않는다). 마지막 정상 시각은 `snapshotInfo().lastOkReceivedAt` 에만 남는다 |
| `pushX(result, receivedAt, { requestedAt })` | 더 늦게 요청한 응답을 이미 받았거나, 그 채널을 비운(`clearSnapshot`·`setScope`) 시각보다 앞서 요청한 응답이면 버린다(`STALE_REQUEST`). 실패 응답도 같다                                        |
| `setScope(key)` / `pushX(..., { scope })`    | 범위가 바뀌면 보관한 형상을 버리고 Viewer 도 비운다. 범위가 다르거나, 범위를 정한 뒤 scope 없이 넘긴 응답은 버린다(`SCOPE_MISMATCH`)                                                           |
| `clearSnapshot(channel?)`                    | 보관한 형상을 버리고 Viewer 의 그 채널만 비운다. 진행 중 편집은 `STALE_SOURCE` 로 끝난다                                                                                                       |
| World·Health·이벤트                          | 보관하지 않는다. STOMP 최신 값 재생은 FE `lib/stomp` 의 `withReplay` 가 한다(역할을 겹치지 않는다)                                                                                             |

push 의 반환값(`ACCEPTED`·`STALE_REQUEST`·`SCOPE_MISMATCH`)은 새로 생긴 것이다. `setScope` 를 쓰지 않고 옵션 없이 부르면 예전처럼 늘 `ACCEPTED` 다.

### FE 가 지켜야 할 호출 조건(제안, FE 합의 대상)

- **세션 범위**: 로그인 세션마다 Source 를 새로 만들거나(현재 `lib/stomp` 방식), 한 Source 를 계속 쓰면 로그인 때 `setScope(사용자·세션 키)`, 로그아웃 때 `setScope(null)` 을 부르고 모든 형상 push 에 같은 `scope` 를 단다.
- **늦은 응답**: 조회를 시작한 시각을 `requestedAt` 으로 늘 함께 넘긴다(`now()` 와 같은 시계). 같은 채널에서 섞어 쓰지 않는다.
- **재조회 조건**: 구역·정적 객체 저장 성공(새 버전), Scene 변경, 세션 시작 때 다시 조회해 push 한다. Viewer 재마운트·3D 화면 복귀 때 다시 push 할 필요는 없다(Source 가 보관한다).
- **신선도·실패**: Viewer 는 실패를 받으면 그 채널을 비운다. 조회 실패에도 마지막 형상을 계속 보일지는 FE 가 정한다(그렇다면 실패를 push 하지 않는다). 형상이 오래됐는지 화면에 알리는 일도 FE 몫이다.
- **적용 상태**: READY(형상 수신·검사)는 적용(ACK)이 아니다. 적용 확인 계약이 생기기 전까지 3D 표시는 `적용 미확인` 이다.

## 명령(Viewer3DHandle)

- `select(target, { waitMs?, focus? })`:
  - 대상이 아직 장면에 없거나 준비 중이면 `waitMs`(최대 `MAX_SELECT_WAIT_MS` = 30 초)까지 기다린다. 기다리는 동안 `{ ok: true, pending: true }` 를 돌려준다.
  - 진행은 `onSelectRequestChange` 로 알린다: PENDING → APPLIED, EXPIRED, 또는 CANCELLED(`REPLACED`·`SELECTION_CHANGED`·`NOT_READY`·`UNMOUNTED`).
  - 기다리는 요청은 하나뿐이고, 새 select·clearSelection·3D 클릭이 오면 취소된다. 옵션이 없으면 예전과 같다.
- `beginEdit(target, { draft?, before? })`:
  - 화면이 보관한 미저장 초안으로 편집을 한 번에 다시 연다. 미리보기 알림은 한 번만 간다.
  - `before` 가 지금 원본과 다르면 `STALE_SOURCE`, `draft` 가 유효하지 않으면 `INVALID_GEOMETRY` 로 거부한다. 거부되면 편집도 선택도 바뀌지 않는다.
  - 형상 모양은 다음과 같다. zone 은 `ViewerEditBox`, WORK_SURFACE 는 `ViewerWorkSurfaceGeometry`, OBSTACLE 은 `ViewerObstacleGeometry`.
  - 칸마다 `updateEditField` 를 차례로 다시 부르는 방식(`restoreZoneBoxSteps`)은 그대로 둔다. 제거는 FE 전환 뒤 별도로 예고한다.
- 편집 출처(provenance): 정식 입력이면 `zoneVersion`·`objectVersion` 을 싣는다(PUT 충돌 확인용). DEMO·묶음 입력의 출처 값은 예전과 같다. 정식 구역의 버전만 바뀌어도 진행 중 편집은 `STALE_SOURCE` 로 끝난다.

## 레이어(`layers` prop)

`layers={{ zones, workSurfaces, obstacles }}` 의 값은 다음 셋이다.

- hidden: 그리지 않는다. 장면 대상에서도 내려가며, 선택돼 있었으면 풀린다.
- visible: 그리지만 클릭을 받지 않는다. 광선이 지나가서 뒤의 대상이나 빈 곳 클릭이 그대로 된다. 명령(select·focus)으로는 고를 수 있고, 편집은 `NOT_EDITABLE` 이다.
- interactive: 그리고 클릭·선택·편집을 받는다. 적지 않은 레이어의 값이다(기존 동작).

사람과 위험 강조는 레이어로 끄지 않는다. 피킹 순서는 바꾸지 않았다: 광선의 가까운 대상부터 고르고, 투명 구역·작업면·장애물은 광선 위의 사람을 먼저 고른다. 화면별 값과 우선순위 정책은 FE 합의 전이라 정하지 않았다.

## 제어형 상자 편집(`boxEdit`)

호스트(FE)가 상자를 쥐고 뷰어는 그리고 입력만 받는 조작기다. 뷰어 안 편집 세션(`beginEdit`·`onEditPreview`)과 따로이고 서로 영향이 없다. 저장·검증은 FE 몫이다.

- 입력(props, 모두 선택 사항):
  - `boxEdit={{ id, kind: 'zone' | 'surface', box: { min, max } }}`: World(m) 축 정렬 상자. null·없음이면 조작기를 그리지 않는다. `id`(구역 ID·`surface:<zoneId>`·`new`)가 바뀌면 끌던 조작이 끝난다.
  - `onBoxEditChange(box)`: 끄는 동안 맞춘 결과가 지금 `boxEdit.box` 와 다를 때마다 부른다. FE 는 받은 상자를 다시 `boxEdit.box` 로 내려 준다.
  - `boxGhosts={[{ id, box }]}`: 보관한 미저장 초안의 읽기 전용 점선 윤곽. 클릭을 받지 않고 `boxEdit.id` 와 같은 `id` 는 그리지 않는다.
- 그림: 상자 미리보기(보라, 클릭 안 받음)와 화면 크기가 늘 같은 손잡이.
  - 상자 가운데의 주황 구(링은 카메라를 향함): 바닥(수평 평면)에서만 옮긴다. 크기·높이(Z)는 그대로다.
  - 화살표 여섯(x-·x+·y-·y+·z-·z+): 그 면의 바깥 가운데에 놓여 바깥을 가리키고, 그 면만 움직이며 반대 면은 고정한다. `kind: 'surface'` 면 z- 를 숨긴다. 겹치면 구가 먼저 잡힌다.
  - 높이 이동·회전·작은 손잡이는 없다.
- 값 규칙: 0.05 m 단위, 최소 크기 수평 0.2 m · 높이 0.05 m, 범위 x 0~10 · y 0~10 · z 0~5(z- 도 0 아래로 못 간다). 이동은 최소 모서리를 맞추고 상자를 교실 안에 가둔다. 끄는 동안은 끌기를 시작할 때의 상자에 전체 이동량을 더해 계산한다.
- 끌기: 끄는 동안 카메라 OrbitControls 를 끄고, 놓기·취소·버튼이 떨어진 움직임·`id` 바뀜·내려감에서 되돌린다. 시선이 화살표 축과 거의 나란하면 그 움직임은 건너뛴다. Esc 는 끌기를 시작 전 상자로 되돌려 `onBoxEditChange` 로 알리고, 그 Esc 는 다른 Esc 처리기에 넘기지 않는다(끄는 중이 아니면 가로채지 않는다).

## 사람 이름표 칸 목록(`personLabels` prop, -658 A안) · 레거시 뒤 글(`personBadges` prop, -342)

- `personLabels`: World ID → `readonly ViewerLabelCell[]`(`{ kind: 'watch', status: 'connected' | 'disconnected' }` | `{ kind: 'text', text: string }`).
- 넘기면 한 이름표 알약 안에 `[선택 워치 아이콘 칸, 사람 이름 칸, ...선택 PPE 칸]` 을 그린다.
  - 연결(`connected`): 하늘색 둥근 스마트워치 선 아이콘 + 왼쪽 칸 배경 은은한 강조.
  - 끊김(`disconnected`): 회색 둥근 스마트워치 선 아이콘 + 작은 빨간 점, 이름은 그대로.
  - 배정 없음: 워치 칸 없이 이름 칸만.
  - World ID·기기 ID·`워치` 글자는 3D 이름표에 넣지 않고 선택 시 열리는 사람 상세 패널로 옮긴다.
  - 위험 글자 색(`riskStyle`)·관측 톤 글자 색·배경 투명도 규칙은 그대로 유지한다.
- 내용으로 비교한다: 전체와 사람별 칸 배열 모두 값이 같으면 참조를 유지해 다른 아바타를 다시 그리지 않는다.
- `personBadges`: `personLabels` 를 넘기지 않는 단독 시험·하네스용 레거시 경로(World ID 끝에 ` · 글`).

## 사람 안전모·조끼 상태(`personHelmets`·`personVests` prop, -531·-552·-783)

- World ID → `PersonHelmetState`(WORN·NOT_WORN·UNKNOWN), 안전모는 `personHelmets`, 조끼는 `personVests`.
- 안전모·조끼 형상(GLB)은 그리지 않는다(-783). 캡슐 고정 자리에 붙인 형상이 아바타 몸과 어긋나 목업처럼 보여 뺐다. WORN·UNKNOWN 은 3D 에 아무것도 더하지 않는다.
- 둘 중 하나라도 NOT_WORN 이면 머리 위 빨간 경고 표식 하나. 상태 글은 호스트가 이름표 PPE 칸(`personLabels`) 또는 `personBadges` 로 넘긴다.
- 뷰어는 PPE 를 다시 판정하지 않는다. 같은 World ID·`identity_revision`·만료·EC2 연결은 호스트가 따져 붙일 사람만 넘긴다. 키가 없는 사람은 표식이 없다.
- 표식 위치: Tier 0 골격 막대는 골격 머리 위를 따른다. 캡슐과 아바타 메시 사람은 캡슐 머리 구 위(1.64 m), 높이 모름 기둥은 기둥 위(2.0 m)에 둔다. 클릭을 받지 않는다.
- 경보가 아니다(경보는 R9 이벤트). 내용이 같으면 Store 를 바꾸지 않는다.

## 사람 강조(`personHighlights` prop, -509)

- World ID → 큰 이름표 글. 있는 동안 그 사람 발밑에 고리 펄스와 큰 이름표를 보인다. 기존 이름표는 그대로 둔다.
- 강조 시간은 호스트가 정한다(키를 빼면 바로 사라진다). 내용이 같으면 Store 를 바꾸지 않는다. 화면에 없는 사람은 그리지 않는다.
- 관제 앱은 워치가 새로 이어진 순간(손 흔들기 등)에 4 s 넣는다. 편집 모드에서는 넘기지 않는다. 사람 이름을 넣지 않는다.

## 보정 카메라 마커·시야 절두체(`cameraPoses` · `onCameraClick` prop, -522)

- 입력: `readCalibrationCameraPoses(raw)` 로 `GET /api/calibrations/current` 응답 본문(`camera_poses`)을 검사해 `CalibratedCameraPose[]`(`{ cameraId, position, forward, hfovRad }`)로 바꾼 뒤 `cameraPoses` prop 으로 넘긴다.
- 표시: LIVE 모드에서 카메라마다 `worldToThree(position)` 위치에 작은 카메라 본체·렌즈 메시, `cameraId` 이름표(`LabelSprite`), 그리고 `worldDirectionToThree(forward)` 방향·`hfovRad` 수평 시야각으로 길이 약 1.5 m(`CAMERA_FRUSTUM_LENGTH_M`)의 옅은 시야 절두체를 그린다.
- 숨김·성능: 구역·작업면 편집 중(`boxEdit` 또는 뷰어 안 편집 세션)에는 숨긴다. 내용이 같으면 Store 를 바꾸지 않으며, 1 Hz `viewer_health` 갱신으로 다시 그리지 않는다.
- 사람 선택 강조: 사람이 선택돼 있으면(`selected?.type === 'person'`) 그 트랙의 `cameras` 에 든 카메라 마커·절두체·이름표를 강조 색으로 표시한다.
- 클릭: 카메라 본체·렌즈를 클릭하면 `onCameraClick(cameraId)` 를 부른다(시야 절두체는 뒤의 사람·구역 클릭을 가리지 않게 광선 검사를 끈다).

## 바닥 감시 범위(`floorCoverage` prop, -606)

- 입력: `readFloorCoverage(GET /api/scenes/current 응답 본문)` 결과(`FloorCoverage`, `@/lib/floorCoverage`). 응답의 `floor_coverage` 는 계약 `site_setup#/$defs/floor_coverage` 원문이다: 칸 크기 `cell_m`, 최소 모서리 `origin_xy`, `cols`·`rows`, 행 우선 `cells`(행 0 이 가장 작은 Y, `.` 바닥 모름·`0` 사각·`1` 1대만·`2` 2대 이상).
- 표시: 행마다 같은 종류를 이은 사각형(`coverageRuns`)을 바닥 위 `FLOOR_COVERAGE_LIFT_M`(3 cm)에 종류별 반투명 메시로 그린다. 꼭짓점은 `worldToThree` 로만 바꾼다. 깊이를 쓰지 않고 클릭을 받지 않는다(사람·구역 피킹 그대로).
- 켜기와 정합: 뷰어는 받은 것만 그린다. 관제 앱은 기본 꺼 두고 도구 모음 「감시 범위」로 켜며, 칸을 센 보정 버전이 world_state 의 보정 버전과 같거나, 회전 자동 복구로 버전만 바뀌어 서버 Scene 정합 판정이 VERIFIED 일 때만 넘긴다(`isCoverageCurrent`). 구역 편집 중에는 넘기지 않는다.
- Visual 층이다: 가림을 계산하지 않은 상한이며 위험 판정·사람 위치와 무관하다. 같은 객체면 다시 그리지 않는다.

## 카메라 시점 보기(`viewFromCamera` · `exitCameraView` 명령, -590)

- `viewFromCamera(cameraId)`: `cameraPoses` 의 그 카메라 광학 중심·정면·세로 시야각(수평 시야각과 16:9)으로 시점을 1 초(`CAMERA_VIEW_MOVE_MS`) 동안 이음 이동한다. 움직임 줄이기 설정이면 다음 프레임에 바로 옮긴다. 회전 중심은 정면 광선이 바닥(Z=0)에 닿는 점(1~15 m, 바닥을 향하지 않으면 4 m 앞)이다. 준비 전 `NOT_READY`, 없는 카메라 `NOT_FOUND`.
- 옮기는 동안과 맞아 있는 동안 그 카메라 마커를 숨긴다. 다 옮긴 뒤 시점이 자리 1 cm·방향 0.25°·시야각 0.1° 안에 있는 동안만 "맞아 있음"이고, 이때만 VDT 를 0.4 초(`CAMERA_VDT_FADE_MS`)에 걸쳐 켠다. 사용자 조작·초점·위에서 보기 등으로 시점이 바뀌면 맞음을 풀고 VDT 를 서서히 끈다. 같은 카메라를 다시 부르면 다시 맞춘다.
- 켠 동안 1 초 준비 뒤 2 초 평균 FPS 가 24 아래면 그 카메라 시점에서는 VDT 를 끄고 시점은 둔다(다음 `viewFromCamera` 에서 다시 시도). 사진을 받지 못하면 구운 텍스처 그대로다.
- `exitCameraView()`: 첫 `viewFromCamera` 직전 시점(자리·회전 중심·시야각)으로 1 초에 돌아간다. 카메라 시점이 아니면 아무것도 하지 않는다. `resetView` 는 카메라 시점 보기를 끝내고 돌아갈 시점을 잊는다.
- 사진: 장면 `vdt` 가 있으면 그 사진, `vdt.cameraImageUrls`(카메라 ID → 주소)가 있으면 같은 카메라의 주소를 바꾸고, 장면 `vdt` 가 없으면 `map_cameras` 자세와 주소로 표시 층 없는 설정을 만든다(`withVdtCameraImages`). 둘 다 없으면 시점만 옮긴다.

## 배경 Scene 상태(`scene` prop, -618)

- 받는 `state` 는 `COMMITTED`·`CANDIDATE`·`DEFAULT` 이다. `CANDIDATE` 는 아직 확정되지 않은 Scene(세팅 미리보기·정밀 맵)으로, 버전을 지정한 `GET /api/scenes/{scene_version}/view` 가 낸다. 그 응답은 `default` 가 늘 false 이고 `committed_at_ms` 가 null 이며 `compatibility` 가 없다. 다른 값은 `REJECTED` 다.
- `COMMITTED` 만 자산을 버전 키로 캐시한다. `CANDIDATE` 는 내용이 바뀔 수 있어 캐시하지 않는다. 정합 판정은 `COMMITTED` 와 같다(`DEFAULT` 만 근거 없음).

## 기타 공개 항목

- `personModelUrl`: 사람 모델 GLB 주소(선택). 읽지 못하면 캡슐로 그린다. 에셋 권리와 배포 경로는 미정이다.
- `createViewerTestHandle(overrides)`: FE 시험용 가짜 핸들이다. 부른 명령을 `calls` 에 남긴다. FE 시험이 viewer3d 내부 Store 를 직접 조립하지 않게 한다.
- 순수 검사 함수 `readPolygonXy`·`readOfficialZone`·`adaptOfficialZones`·`adaptOfficialStaticObjects`·`geometryProblem`: 2D 폼 검사에서 같은 규칙을 쓸 수 있다. 다만 three.js 가 없는 공용 위치로 옮기는 일은 FE 합의 뒤에 한다(이 입구는 Viewer3D 도 내보낸다).

## FE 소비처 영향(dev 570bd45 기준)

`git grep -l "from '@/features/viewer3d'" -- front/apps/admin/src` 결과(viewer3d 밖)는 앱 코드 11파일, FE 시험 9파일이다(`plan/independence.test` 는 문자열 검사). 바뀐 것은 모두 더하기이고, 기존 호출은 그대로 컴파일·통과한다.

- `pushZones`·`pushWorkSurfaces` 반환형이 `void` 에서 `SnapshotPushOutcome` 으로 바뀌었다. 반환값을 쓰지 않는 호출과 `vi.fn()` 가짜는 영향이 없다.
- `ZoneSnapshot.contract`·`ViewerEditProvenance.zoneContract`·`geometryContract` 의 값 종류가 늘었다. 기존 값을 직접 적는 FE 시험은 그대로 맞다.
- `CommandResult` 의 성공 값에 선택 필드 `pending` 이 생겼다. `select` 를 `waitMs` 로 부를 때만 붙는다.

## PLANNED 가상 배치(-186)

TBM 계획의 가상 개구부·비계·장비를 3D 에 놓고 고친다. 배치 목록·저장·평가·보고서는 FE -62·BE -30 몫이고, Viewer 는 받은 배치를 그리고 편집 결과를 World 값으로 돌려준다(`saved: false`).

- 입력: `plannedLayout={{ layoutId, objects: [{ id, kind, geometry: { center, size, yawRad }, label? }] }}`. `kind` 는 OPENING·WORK_SURFACE(고소 작업면)·SCAFFOLD(옛 비계)·EQUIPMENT.
  - 형상은 World(m, +Z 위) OBB 다. `center` 는 3D 중심, `size` 는 지역 X'·Y'·높이 전체 길이(> 0), `yawRad` 는 [-π, π] 다. 도 값과 0 크기는 거부한다.
  - 같은 `id` 는 모두 빼고, 모르는 종류도 뺀다(`readPlannedLayout`·`plannedGeometryProblem` 으로 FE 폼 검사에 같은 규칙을 쓸 수 있다).
- 격리:
  - PLANNED 모드에서만 그리고 장면 대상(`{ type: 'planned', id }`)으로 올린다. LIVE·REPLAY 로 바뀌면 내려가고, 선택이 풀리며 편집은 끝난다(LIVE 는 `MODE_CHANGED` 취소, REPLAY 는 `NOT_EDITABLE` 거부).
  - 배치는 LIVE 데이터 Store 와 따로 두어 World·구역·작업면·위험 이벤트를 바꾸지 않는다. 위험 강조 대상도 아니다.
- 편집:
  - 기존 객체는 `beginEdit({ type: 'planned', id }, { draft?, before? })`, 새 객체는 `beginPlannedCreate({ id, kind, geometry })` 로 연다.
  - 손잡이·엔진은 작업면·장애물과 같은 OBB 조작기다(X·Y·Z 이동, 6면 크기, 수평 회전, 기울임 없음, 정책 `PLANNED_OBB_POLICY`).
  - 숫자 입력은 `updatePlannedEditField`, 끝내기는 `finishPlannedEdit`·`cancelPlannedEdit` 다.
  - 결과는 `onPlannedEditPreview`·`onPlannedEditResult` 로만 알리고, LIVE `onObjectEdit*` 에는 섞지 않는다. LIVE object 명령(`cancelObjectEdit` 등)은 가상 객체 편집에 쓰이지 않는다.
- 결과: `{ status, target, mode: 'PLANNED', origin: REGISTERED|NEW, plannedKind, layoutId, before, after, changed, saved: false }`. FE 가 FINISHED 결과로 배치를 고쳐 다시 넘기면 그 값이 새 원본이다.
  - 편집 중 그 객체가 배치에서 사라지거나 바뀌거나 `layoutId` 가 바뀌면 `STALE_SOURCE` 로 끝난다. NEW 와 같은 ID 가 배치에 들어와도 같다.
- 하지 않는 것: 가상 객체로 위험 판정·평가, 서버 저장·발행, 종류별 의미 해석(예: 개구부를 바닥 구멍으로 렌더링).

## EXP-02 사람 메시(-65)

AI -88 의 사람별 스키닝 glTF 와 `avatar_frame`(/topic/avatar) 관절 회전으로 사람을 메시로 그린다. 구독·인증은 FE, 자산 생성·포즈 계산은 AI(-88·-227), 중계는 BE(-138) 몫이다.

- 입력: FE 가 /topic/avatar 본문을 world_state 와 같은 Source 에 `push` 한다. 스키마 검사 뒤 스키마 밖 규칙도 본다.
  - 같은 메시지에 같은 `world_id` 가 둘이면 그 사람을 모두 뺀다. 회전각 > π, 관절 0 회전이 0 이 아니면 그 사람만 뺀다.
  - 자산 `identity_revision` 이 포즈보다 크면 자산을 쓰지 않는다(캡슐).
  - 사람별로 `(identity_revision, capture_time_ms)` 가 더 클 때만 바꾼다. 30 초 넘게 새 포즈가 없는 사람은 지운다.
- 위치: 사람의 존재·위치·접지·관측 상태·ID 신뢰도는 늘 world_state 다. 메시는 pelvis 뼈를 그 표본의 Tier 0 `pelvis_xyz` 에 맞추고, 관절 회전만 재생 지연 250 ms 로 두 표본 사이를 slerp 한다(새 표본이 없으면 마지막 포즈 유지, 외삽 없음).
  - 회전: 감싼 그룹 = `quat(Rx(−π/2))·quat(root_rotation)`, 뼈 i = `joint_rotations[i]`(null 이면 바인드 회전). 노드 이동·크기(체형)는 glTF 값 그대로다.
- 자산: `mesh_url` 을 `avatarMeshFetch`(없으면 같은 출처 fetch)로 받고, 바이트 sha256 = `mesh_sha256`, 뼈 수 = `joint_count`, 부모 배열 해시 = `joint_parents_sha256`, `pelvis_joint_index` 범위를 확인한다. `mesh_sha256` 이 캐시 키다. 실패하면 10 초 뒤 다시 받는다. 텍스처·표면 출처 지도는 아직 쓰지 않는다(기본 회색 재질).
- 되돌아가기(하나라도 맞으면 기존 캡슐·골격 경로):
  1. 0.5 초 넘게 새 포즈 없음(`AVATAR_STALL_MS`)
  2. world_state `t_latest_global` − 포즈 `capture_time_ms` > 500 ms(`AVATAR_LATE_MS`)
  3. 트랙 `identity_revision` 이 포즈와 다르거나, 같은 차수로 `IDENTITY_UNCERTAIN` 이 1.5 초 넘게 이어짐(`AVATAR_IDENTITY_HOLD_MS`, -661. 그 안이면 마지막 자세로 메시를 유지하고 1·2 기준도 그만큼 늘린다)
  4. 포즈 `calibration_version` 이 world_state 와 다름
  5. 자산 없음·내려받기/sha256/리그 확인 실패·`joint_count` ≠ 관절 회전 길이, 그리고 Tier 0 pelvis 없음
- 표시: 사람 이름표에는 메시 상태를 적지 않는다(사람 ID 만 적는다). 메시 사용 여부와 HMR 지연 수치는 상태 표시줄의 FE 몫이다.
- `avatarMesh="off"` 면 포즈가 와도 늘 기존 경로다. 메시는 위험 판정·이벤트·선택 규칙을 바꾸지 않는다(같은 사람 대상 `{ type: 'person', id }`).
- ID 병합 승계(-661): 선택·초점 대상인 사람 ID 가 장면에서 빠질 때 그 ID 가 지금 world 트랙의 `aliases` 에 있으면 선택·초점을 그 생존 트랙으로 옮긴다. 별칭이 아직 오지 않았으면 선택을 비우고 500 ms(`MERGE_CARRY_GRACE_MS`) 안에 별칭이 오면 옮긴다. 분할로 생긴 새 ID(`split_from`)로는 옮기지 않는다.

## 배경 사진 화질·출처 지도·접지 그림자·후처리(-360)

실영상 재구성 glTF 배경이 이중 조명·톤매핑으로 흐려지지 않고 사진 그대로 보이게 하며, 표면 출처 지도(`SURFACE_SOURCE_MAP`)·접지 그림자·선택적 후처리(N8AO·SMAA)를 지원한다.

- 사진 배경(`SceneBackground`):
  - `map` 텍스처가 있는 배경 메시는 광원·톤매핑을 거치지 않는 `MeshBasicMaterial`(`SRGBColorSpace`, `toneMapped: false`, `DoubleSide`)로 바꾼다. Canvas 출력도 `SRGBColorSpace`·`NoToneMapping`(`flat`)으로 맞춘다.
  - `map` 이 없는 정점색·회색 메시는 기존 조명 재질(`MeshStandardMaterial` 등)을 유지하고, 정점 법선이 없으면 `computeVertexNormals()` 로 계산한다.
  - 정합 미확인(`DEFAULT_UNVERIFIED`·`UNCONFIRMED`·서버 `DIMMED`)이어도 사진과 무텍스처 메시를 FULL과 같은 색·불투명도로 표시한다. `MISMATCH`는 숨기며 정합 상태와 재생성 필요 표시는 유지한다.
- 표면 출처 지도(`SURFACE_SOURCE_MAP`):
  - `scene_output` 2.1.0 규칙에 맞춰 `CurrentScene.surfaceSourceMapUrls`(`surface_source_map_urls` 배열 또는 재질/메시 이름 키 맵) 또는 재질·메시 `userData.surfaceSourceMap` 을 받는다.
  - 보간·색공간 변환으로 값이 섞이지 않게 `NearestFilter`·`generateMipmaps = false`·`NoColorSpace` 로 읽는다.
  - `2`(`OBSERVED`)는 사진 그대로(`1.0`), `3`(`ESTIMATED_PLANE`)과 `1`(`INTERPOLATED`)은 명도·채도를 약간 낮추고(`0.82` / `0.72`), `0`(`UNOBSERVED`) 및 미정의 값은 어둡게 흐리고(`0.38`) 빗금을 얹는다.
- 접지 그림자(`GroundShadowLayer`):
  - `ground_contact.state === 'VALID'` 로 바닥 접지가 확인된 사람 발밑에만 가벼운 방사형 접지 그림자를 그린다(`people/` 파일은 건드리지 않는 별도 레이어).
- 후처리(`postProcessing` prop):
  - `postProcessing?: boolean | Partial<ViewerPostProcessingOptions>` 로 N8AO + SMAA 후처리를 켜고 끌 수 있다. 기본값은 `false`(끔)이며, 개발 하네스에서는 `?post=on|off` 쿼리로 전환할 수 있다.

## 시점 의존 텍스처(VDT)·미관측 표시 층·경계 섞기·외톨이 제거(`vdt` prop, -534, -541)

- 입력:
  - `GET /api/scenes/current` 응답의 선택 필드 `vdt`(`readSceneVdtConfig(raw)`) 또는 `parseExperimentVdtDocs(camerasJson, wallsJson, baseUrl)` 로 읽은 `SceneVdtConfig`: 카메라별 왜곡 보정 배경 사진 URL·크기·`K`·정본 World 기준 `R`·`t`·노출 보정 계수(`colorGainSrgb`) 및 바닥·벽 표시 층 평면(`floorPlane`, `wallPlanes`).
  - `GET /api/scenes/current` 응답의 선택 필드 `map_cameras`(`scene_output.method.map_cameras`) 또는 GLB `extras.simai.map_cameras`(`Object3D.userData.simai.map_cameras`): 최종 맵 굽기에 실제로 쓰인 카메라별 `{ image_size, K, R, t, pose_source }`(`CALIBRATION` | `MA_ALIGNED_SIM3` | `MA_ALIGNED`). `R`, `t` 규약은 정본 World(m, +Z 상방) → OpenCV 카메라(+X 우, +Y 하, +Z 정면) 변환(`p_cam_cv = R * p_world + t`, `C_world = -R^T * t`)이다.
  - `vdt?: boolean | ViewerVdtOptions` prop 으로 켜고 끈다. **기능 플래그 기본값은 `false`(끔)** 이다.
- 동작:
  - 플래그가 꺼져 있을 때(기본)는 기존 `MeshBasicMaterial` + `SURFACE_SOURCE_MAP` 렌더 경로를 그대로 유지한다.
  - 플래그가 켜져 있고 장면 데이터에 `vdt` 가 있으면:
    1. `map_cameras` 가 있으면(응답의 `map_cameras` → `vdt.map_cameras` → GLB `userData.simai.map_cameras` 순) 해당 카메라의 `image_size, K, R, t, pose_source` 로 투영 카메라 자세를 오버라이드하고, 없으면(레거시 Scene) 기존 calibration 자세(`CALIBRATION`)로 폴백한다. Tier 0 `calibration.json` 정본(`GET /api/calibrations/current`)은 변경하지 않는다.
    2. 정본 World 좌표계의 `R`, `t`, 평면 꼭짓점·법선을 오직 `worldCoordinates.ts` 를 통해 Three.js 공간으로 변환한다.
    3. 정적 장면·카메라 기준 깊이 그림자 맵 4장(`shadowMapSize`, 기본 `1536`)을 장면/카메라 변경 시 1회만 굽는다.
    4. 카메라별 시점 각도·깊이 가림 검사(5-tap)와 4차 Oklab 메도이드 카메라 간 외톨이 제거(`outlierRemoval = true`), 미관측 TSDF 면 투영 기본 끔(`projectUnobserved = false`), 바닥·벽 미관측 표시 층(깊이 5 cm 일치 게이트 + 차분한 톤·격자), 열린 구멍 경계 페더링(`aBoundaryDist` 11 cm)을 적용한다.
    5. 사람·아바타(`PersonLayer`), 구역(`ZoneLayer`), 접지 그림자(`GroundShadowLayer`), 작업면(`WorkSurfaceLayer`), 카메라 마커(`CameraLayer`)의 재질과 깊이 가림은 영향받지 않는다.
