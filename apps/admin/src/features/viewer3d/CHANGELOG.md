# viewer3d 변경 이력

공개 입구(`index.ts`)와 그 타입을 바꾸면 여기에 적는다. 깨지는 변경은 FE 리뷰를 받은 뒤에만 한다.

## S15P31A101-783 사람에 안전모·조끼 형상을 그리지 않음

공개 입구·타입 변경 없음. 동작만 바뀐다.

- 변경: `personHelmets`·`personVests` 가 `WORN` 이어도 안전모·조끼 GLB 형상을 그리지 않는다. 캡슐 고정 자리에 붙어 아바타 메시 몸과 어긋나 목업처럼 보였다(사용자 결정). `NOT_WORN` 머리 위 빨간 경고 표식과 이름표 PPE 칸은 그대로다. prop·Store 는 표식 판단에 계속 쓴다.
- 없앰: 내부 `PpeGear`·`ppeAssets`·`ppeFit` 와 GLB 자산 2개(`people/ppe/assets`, CC BY 4.0 출처 표기 `CREDITS.txt` 포함). 공개 입구가 아니라 호환에 영향 없다.

## S15P31A101-658 사람 이름표 칸 목록(`personLabels`, A안)

모두 더하기이며 하위 호환이다. 설계 문서는 `docs/design/S15P31A101-658-person-name-label.md` 에 있다.

- 추가: `personLabels`(`Readonly<Record<string, readonly ViewerLabelCell[]>>`, 선택) prop, export 타입 `ViewerLabelCell` · `ViewerLabelWatchStatus`.
- 동작: 넘기면 한 이름표 알약 안에 왼쪽 스마트워치 선 아이콘 칸(연결 하늘색 + 칸 배경 강조 / 끊김 회색 + 빨간 점 / 미배정 생략)과 사람 이름 칸, 뒤따르는 PPE 칸을 그린다. World ID·기기 ID·`워치` 글자는 3D 이름표에서 빼고 상세 패널로 옮겼다. 넘기지 않으면 기존 `personBadges` 경로 그대로다.

## S15P31A101-656 PPE 모름은 장비를 그리지 않음

공개 입구·타입 변경 없음. 동작만 바뀐다.

- 변경: `personHelmets`·`personVests` 가 `UNKNOWN` 인 장비는 그리지 않는다(전에는 같은 형상 반투명 0.3 + 외곽선). `WORN` 실물과 `NOT_WORN` 경고 표식은 그대로다. 반투명 형상이 관제 거리에서 착용과 구분되지 않아(2026-11-12 교실 실험) 바꿨다. 명세 13.3.
- 없앰: 내부 외곽선 형상(`GearAsset.edges`)과 모름 재질. 공개 입구가 아니라 호환에 영향 없다.
- 관제 앱은 착용이 아닐 때의 상태를 이름표 뒤 글(`personBadges`)로 넘긴다.

## S15P31A101-651 상자 편집 화살표를 면 가운데로

공개 입구와 타입은 그대로다(그림만 바뀐다).

- 동작: 제어형 상자 편집(`boxEdit`)의 화살표 여섯을 상자 가운데가 아니라 각 면의 바깥 가운데에 놓는다. 가운데 구(바닥 이동)와 겹치지 않고 어느 면이 움직이는지 보인다. 끌기 축(상자 가운데를 지나는 그 축 직선)과 값 규칙은 그대로다. 손잡이 묶음은 `box-edit-at:<손잡이>` 이름의 위치 묶음 안에 있다.

## S15P31A101-629 확인 전 구역 표시(`needs_review`)

더하기이며 하위 호환이다.

- 추가: 구역 입력 항목의 선택 필드 `needs_review`(true 일 때만), `ZoneView.needsReview`. 세팅 구역 단계가 새 모델 + World 이어짐으로 채운 구역 중 사람이 아직 확인하지 않은 것에 싣는다.
- 동작: 같은 심각도 색으로 채움을 옅게(0.35배), 윤곽을 흐린 촘촘한 점선으로 그리고 이름표에 `· 확인 필요`를 붙인다. 넘기지 않으면 지금과 같다.

## S15P31A101-618 확정 전 Scene(`CANDIDATE`) 입력

더하기이며 하위 호환이다.

- 변경: `SCENE_STATES` 가 `['COMMITTED', 'CANDIDATE', 'DEFAULT']` 가 되고 `SceneState` 에 `CANDIDATE` 가 들어간다. 서버 `GET /api/scenes/{scene_version}/view`(BE -613)가 세팅 미리보기·정밀 맵을 이 상태로 낸다. 예전에는 `REJECTED` 였다.
- 동작: `CANDIDATE` 는 `COMMITTED` 처럼 읽고 그린다. 자산 캐시는 `COMMITTED` 만 쓴다. 오류 이유 문구가 `state 는 COMMITTED·CANDIDATE·DEFAULT 중 하나여야 한다` 로 바뀌었다.

## S15P31A101-606 바닥 감시 범위 겹침(`floorCoverage`)

모두 더하기이며 하위 호환이다. 설계 문서는 `docs/design/S15P31A101-606-coverage-overlay.md` 에 있다.

- 추가: `floorCoverage`(`FloorCoverage | null`, 선택) prop. 타입과 순수 함수(`readFloorCoverage`·`coverageRuns`·`isCoverageCurrent`)는 2D 평면도 같이 쓰도록 three.js 가 없는 `@/lib/floorCoverage` 에 두었다(뷰어 입구에서 내보내지 않는다).
- 동작: 넘기면 바닥 위 3 cm 에 칸마다 사람을 통째로 보는 카메라 수(2대 이상 초록·1대 파랑·사각 보라, 위험 등급 색과 겹치지 않음)를 반투명하게 깐다. 바닥 모름 칸은 그리지 않고 클릭을 받지 않는다. 켜기·지금 보정과 맞는지는 호스트가 정한다. 넘기지 않으면 지금과 같다.

## S15P31A101-590 카메라 시점 보기와 카메라 시점 VDT

모두 더하기이며 하위 호환이다. 설계 문서는 `docs/design/S15P31A101-590-camera-view-vdt.md` 에 있다.

- 추가: `Viewer3DHandle.viewFromCamera?(cameraId)`·`exitCameraView?()`(선택 멤버, Viewer3D 는 늘 채움), `ViewerVdtOptions.cameraImageUrls`(카메라 ID → 사진 주소, 선택), 뷰어 바깥 요소의 `data-viewer-camera-view`(맞아 있는 카메라 ID 또는 `off`). `createViewerTestHandle` 기본값에 두 명령을 더했다.
- 동작: `viewFromCamera` 는 시점을 그 카메라 자리·방향·세로 시야각으로 1 초에 옮기고(움직임 줄이기면 바로) 그 카메라 마커를 숨긴다. 맞아 있는 동안만 VDT 를 0.4 초에 걸쳐 켜고, 시점이 바뀌거나 평균 FPS 가 24 아래로 떨어지면 서서히 끈다. `vdt` 를 넘기지 않아도 이 동안은 켠다(사진이 없으면 켜지지 않는다). `exitCameraView` 는 첫 요청 직전 시점으로 돌아간다. 시점 초기화(`resetView`)는 처음·위에서 보기 시야각도 처음 값으로 돌린다.

## S15P31A101-552 사람 안전모·조끼 GLB(`personVests`)

모두 더하기이며 하위 호환이다.

- 추가: `personVests`(`Readonly<Record<string, PersonHelmetState>>`, 선택) prop. 안전모(`personHelmets`)와 같은 모양이다.
- 동작: -531 의 단순 반구 안전모를 안전모·조끼 GLB 로 바꿨다. 골격 막대는 귀·어깨·골반 관절에, 캡슐·아바타 메시 사람은 캡슐 고정 자리에 붙는다. 둘 중 하나라도 NOT_WORN 이면 경고 표식 하나(메시 사람 포함). 두 prop 을 넘기지 않으면 지금과 같다.
- 없앰: 내부 `PersonHelmet` 컴포넌트(공개 입구가 아니라 호환에 영향 없음).

## S15P31A101-531 사람 안전모 형상(`personHelmets`)

모두 더하기이며 하위 호환이다. 설계 문서는 `docs/design/ppe-viewer.md` 에 있다.

- 추가: `personHelmets`(`Readonly<Record<string, PersonHelmetState>>`, 선택) prop, export 타입 `PersonHelmetState`.
- 동작: 키가 있는 사람만 머리 위에 단순 안전모 형상(WORN·UNKNOWN) 또는 경고 표식(NOT_WORN)을 그린다. prop 을 넘기지 않으면 지금과 같다.

## S15P31A101-541 관제 뷰어가 맵 카메라 자세(`map_cameras`)로 투영

모두 더하기이며 하위 호환이다. 설계 문서는 `docs/design/viewer-map-cameras.md` 에 있다.

- 추가: `CurrentScene.mapCameras`(`SceneMapCameras` 선택 필드), `SceneVdtConfig.mapCameras`, `VdtCameraInput.poseSource`, `VdtCameraThree.poseSource`.
- 추가 export: `readSceneMapCameras`, `readSceneMapCamerasFromObject3D`, `applyMapCamerasToVdtCameras`, `applyMapCamerasToVdtConfig`, `SceneMapCamera`, `SceneMapCameras`, `VdtPoseSource`.
- 동작: `GET /api/scenes/current` 응답(`map_cameras`), `vdt.map_cameras`, 또는 GLB `extras.simai.map_cameras` 가 있으면 시점 의존 텍스처(VDT) 투영 시 해당 맵 카메라 자세(`K`, `R`, `t`, `image_size`, `pose_source`)를 쓰고, 없으면(레거시 Scene) 기존 calibration 자세로 폴백한다.

## S15P31A101-534 시점 의존 텍스처(VDT) 모듈 통합

모두 더하기이며 하위 호환이다(기능 플래그 기본값 `false`). 설계 문서는 `docs/design/viewer-view-dependent-texture.md` 에 있다.

- 추가: `vdt`(`boolean | ViewerVdtOptions`, 기본 `false`) prop, `CurrentScene.vdt`(`SceneVdtConfig | null` 선택 필드).
- 추가 export: `readSceneVdtConfig`, `parseExperimentVdtDocs`, `convertVdtCameraToThree`, `convertVdtQuadToThree`, `convertVdtFreeViewToThree`, `buildOpenGlProjectionMatrix`, `evaluateCameraWeightCpu`, `resolveVdtOutliersAndBlendCpu`, `srgbToOklab`, `SceneVdtConfig`, `VdtCameraInput`, `VdtCameraThree`, `VdtFloorPlaneInput`, `VdtWallPlaneInput`, `VdtFreeViewInput`, `ViewerVdtOptions`, `VdtRenderMode`, `VdtMatrix3`, `VdtQuadCornersWorld`, `VdtVec2`, `VdtVec3`.
- 그대로: `vdt` 가 `false`(기본)일 때는 기존 `MeshBasicMaterial` + `SURFACE_SOURCE_MAP` 렌더 경로가 한 줄도 바뀌지 않고 그대로 동작하며, 사람·아바타·구역·작업면·접지 그림자 레이어는 영향을 받지 않는다.

## S15P31A101-522 보정 카메라 마커·시야 절두체 및 CCTV 연동

모두 더하기이며 하위 호환이다.

- 추가: `cameraPoses`(`readonly CalibratedCameraPose[]`) · `onCameraClick`(`(cameraId: string) => void`) prop.
- 추가 export: `readCalibrationCameraPoses`, `sameCalibratedCameraPoses`, `cameraMarkerTransform`, `cameraFrustumDimensions`, `highlightedCameraIds`, `CAMERA_FRUSTUM_LENGTH_M`, `CAMERA_FRUSTUM_ASPECT`, `CalibratedCameraPose`, `CameraMarkerTransform`, `CameraFrustumDimensions`, `toWorldUnitVector`, `worldDirectionToThree`, `worldToThree`, `ThreePoint`.
- 동작: LIVE 모드에서 카메라 본체·렌즈, `cameraId` 이름표, 약 1.5 m 시야 절두체를 그린다. 편집 모드에서는 숨기고, 사람이 선택되면 그 트랙의 `cameras` 에 속한 카메라 마커를 강조하며, 마커 클릭 시 `onCameraClick(cameraId)` 를 호출한다.

## S15P31A101-509 사람 강조(워치 연결 순간)

더하기이며 하위 호환이다.

- 추가: `personHighlights` prop(World ID → 큰 이름표 글). 그 사람 발밑 고리 펄스와 큰 이름표를 보인다. 시간은 호스트가 정한다.

## S15P31A101-342 사람 이름표 뒤 글(워치 채널 상태)

더하기이며 하위 호환이다.

- 추가: `personBadges` prop(World ID → 짧은 글). 사람 이름표(사람 ID) 끝에 ` · 글` 로 붙인다(-470 부터 이름표는 늘 보인다).
  관제 앱은 워치 채널 상태(연결·끊김)를 넣는다. 사람 이름은 넣지 않는다.
- 그대로: 위험은 글자 색, 선택·위험 강조.

## S15P31A101-470 3D 이름표: 사람은 ID, 구역은 이름, 늘 보인다

하위 호환이다.

- 바뀜(호환): 구역 이름표는 구역 이름만 적는다(이름이 비면 `구역`). 구역 번호·높이·적용 상태·위험 글자를 적지 않고, 위험은 글자 색으로만 보인다. 작업면·정적 객체 이름표는 없앴다.
- 바뀜(호환): 사람 이름표는 사람 ID 만 적는다. 위험은 글자 색으로만 보이고, 예측·확인 불가·위치 근거·수신 끊김·메시 상태는 글자에서 뺐다(몸 색·투명도로 보인다).
- 바뀜(호환): 사람·구역 이름표는 늘 보인다. 포인터를 머물러야 보이던 동작을 없앴고, 그것만 쓰던 `HOVER_LABEL_MS`·`useIsHovered`·스토어의 `hovered`·`setHovered`·`LabelSprite` 의 `visible` 도 지웠다.
- 바뀜(호환): 편집 미리보기 이름표는 `{구역 이름} · 미저장` 이고, 작업면·정적 객체 초안 이름표에는 ID 를 적지 않는다(계획 가상 객체는 그대로).
- 바뀜(호환): `official` 구역에 `name` 이 없으면 구역 ID 로 채우지 않고 빈 값으로 둔다(화면은 `구역`으로 보인다).
- 지움(내부): 이름표 문구만 만들던 `riskLabel`·`personLabel`·`avatarMeshTag`.
- 그대로: `Viewer3D` props, 선택·위험 강조(표식·윤곽선·색).

## S15P31A101-435 정합 미확인 배경 흐림 제거

- `DIMMED` 배경도 `FULL`과 같은 색·불투명도로 표시한다. 불일치 숨김, 정합 상태와 표면 출처별 표시는 유지한다.

## S15P31A101-395 스캔이 보일 때 목업 바탕 숨김·교실 범위

하위 호환이다.

- 바뀜(내부): 뷰어는 스캔 World 경계를 자기 장면 저장소(`load.boundsWorld`, `display`)에서 읽어 처음 시점과 `boxEdit` 손잡이 범위를 정한다. 호스트·뷰어를 잇는 전역 저장소는 없다. 호스트 쪽 소비자(새 구역 자리·머리글)는 호스트가 `onSceneStatusChange` 의 `boundsWorld`·`display` 로 채우는 `@/store/roomBounds.store` 를 읽는다. 순수 계산(`@/lib/roomLimit`)만 둘이 같이 쓴다. props·입구 export 는 그대로다.
- 바뀜(호환): 정적 배경(스캔)이 보이는 동안 목업 격자·바닥·벽 경계선(`world-walls`)을 숨긴다(예전에는 개발 검수일 때만 벽 경계선을 숨겼다). 스캔이 없거나 읽기 실패·판정 숨김이면 예전 그대로 그린다. 처음 시점·시점 초기화·`boxEdit` 손잡이 범위(스캔이 보이면 x·y 는 스캔 경계, z 는 0~5m)는 스캔 범위를 따른다. 스캔이 없으면 예전 목업 교실(x 0~10 · y 0~10 · z 0~5)과 같다.
- 바뀜(호환): 스캔 경계가 유한하지 않거나 x·y 한 변이 1m 미만·50m 초과면 스캔 범위로 쓰지 않고 목업 교실 범위를 쓴다(스캔 그림은 그대로 보인다).
- 그대로: `Viewer3D` props, 2D 평면, 장면 표시 판정(`display`).

## S15P31A101-360 뷰어 배경 화질·출처 지도·접지 그림자·후처리

모두 더하기이며 하위 호환이다. 계약 설명은 [CONTRACT.md](./CONTRACT.md)와 `docs/design/viewer-background-quality.md`에 있다.

- 추가: `postProcessing` prop(`ViewerPostProcessingProp`, `ViewerPostProcessingOptions`, `DEFAULT_POST_PROCESSING`, `resolvePostProcessing`), `sceneTextureLoader` prop(`SceneTextureLoader`).
- 추가: `SURFACE_SOURCE_VALUES`, `SurfaceSourceMapUrls`, `CurrentScene.surfaceSourceMapUrls`(`surface_source_map_urls` 선택 필드), `hasValidGroundShadow`.
- 바뀜(호환): `SceneBackground` 가 텍스처(`map`) 있는 배경 메시를 `MeshBasicMaterial`(`SRGBColorSpace`, `toneMapped: false`)로 바꾸고, 사진 텍스처 메시의 깊이 가림을 유지한다. `VALID` 접지 사람 발밑에만 `GroundShadowLayer` 그림자를 그린다.
- 그대로: `DIMMED` 판정 규칙(`DEFAULT_UNVERIFIED`·`UNCONFIRMED`), 무텍스처 메시의 조명, `people/` 내부 구현.

## 제어형 상자 편집 조작기(`boxEdit`)

모두 더하기이며 하위 호환이다. 계약 설명은 [CONTRACT.md](./CONTRACT.md) '제어형 상자 편집(boxEdit)' 절에 있다.

- 추가: `boxEdit`(`ViewerBoxEdit`)·`onBoxEditChange`·`boxGhosts`(`ViewerBoxGhost[]`) prop. 호스트가 상자를 쥐고, 뷰어는 미리보기·손잡이(가운데 구 = 바닥 이동, 면별 화살표 = 그 면만 이동)를 그린다.
- 추가 export(타입): `ViewerBoxEdit`, `ViewerBoxGhost`.
- 그대로: 뷰어 안 편집 세션(`beginEdit`·`GizmoController`·`ObbGizmo`)과 그 콜백·시험은 건드리지 않았다. 두 방식은 서로 영향이 없다.

## S15P31A101-65 EXP-02 사람 메시

모두 더하기이며 하위 호환이다. 계약 설명은 [CONTRACT.md](./CONTRACT.md) 'EXP-02 사람 메시' 절에 있다.

- 추가: `avatarMesh`('auto' | 'off', 기본 auto)·`avatarMeshFetch` prop, `AvatarMeshFetch` 타입, `AVATAR_STALL_MS`·`AVATAR_LATE_MS`·`AVATAR_PLAYBACK_DELAY_MS`.
- 바뀜: source 로 들어온 `avatar_frame`(/topic/avatar)을 검사만 하고 버리던 것을 사람별 최신 포즈로 받아 그린다. avatar_frame 을 넘기지 않으면 화면은 예전과 같다.
- 그대로: 사람의 존재·위치·접지·관측 상태·선택·위험 강조는 world_state·risk_event 그대로다. avatar_frame 은 재생 기록(-187)에는 넣지 않는다.

## S15P31A101-186 PLANNED 가상 배치

모두 더하기이며 하위 호환이다.

- 추가: `plannedLayout` prop, `onPlannedEditPreview`·`onPlannedEditResult`, 선택 명령 `beginPlannedCreate`·`cancelPlannedEdit`·`finishPlannedEdit`·`updatePlannedEditField`.
- 추가: 대상 종류 `planned`(VIEWER_TARGET_TYPES), `PLANNED_OBB_POLICY`, `PLANNED_KINDS`·`readPlannedLayout`·`plannedGeometryProblem`, `ViewerPlanned*`·`Planned*` 타입.
- 바뀜(호환): `ViewerTargetType` 에 `planned` 가 늘었다. FE 코드에 종류별 완전 분기는 없다(dev 기준 확인). `createViewerTestHandle` 이 새 명령을 갖는다.
- 그대로: LIVE 작업면·장애물 편집 결과(`onObjectEdit*`)와 그 명령은 같은 모양이고 가상 객체 결과를 받지 않는다.

## S15P31A101-234 Spatial 독립 기반

모두 더하기이며 하위 호환이다. 계약 설명은 [CONTRACT.md](./CONTRACT.md)에 있다.

- 추가: BE 정식 구역(`GET /api/zones` 배열) 입력. BOX·PRISM·FOOTPRINT 로 표현하고 `ZoneView.shape`·`official` 을 둔다. 공개 함수는 `adaptZones`·`adaptOfficialZones`·`readOfficialZone`·`readPolygonXy`·`polygonArea` 다.
- 추가: BE 정식 정적 객체(`GET /api/static-objects` 배열) 입력. WORK_SURFACE·OBSTACLE 모두 받고 `objectVersions` 를 싣는다. 공개 함수는 `adaptGeometry`·`adaptOfficialStaticObjects` 다.
- 추가: `ExternalSpatialSource` 의 형상 보관·재전송, `clearSnapshot`, `setScope`·`scope`, `snapshotInfo`, push 옵션(`requestedAt`·`scope`)과 결과(`SnapshotPushOutcome`). 받는 쪽 `SpatialSourceSink.onSnapshotClear` 도 추가했다.
- 추가: `select(target, { waitMs, focus })`, `onSelectRequestChange`, `MAX_SELECT_WAIT_MS`.
- 추가: `beginEdit(target, { draft, before })` 로 초안을 한 번에 다시 연다(`ViewerBeginEditOptions`). 출처에는 `zoneVersion`·`objectVersion` 을 싣는다(정식 입력일 때만).
- 추가: `layers` prop(`ViewerLayers`, `ViewerLayerKey`·`ViewerLayerMode`, `VIEWER_LAYER_KEYS`·`VIEWER_LAYER_MODES`·`DEFAULT_LAYERS`).
- 추가: `personModelUrl` 공개 prop, `createViewerTestHandle`.
- 추가 export: `OBSTACLE_OBB_POLICY`, `ViewerObstacleGeometry`, `ViewerObjectKind`, `VIEWER_EDIT_REJECT_REASONS`.
- 바뀜(호환): `pushZones`·`pushWorkSurfaces` 반환형이 `void` 에서 `SnapshotPushOutcome` 이 됐다. `ZoneSnapshot.contract`·`zoneContract`·`geometryContract` 의 값 종류가 늘었다. `CommandResult` 성공 값에 선택 필드 `pending` 이 생겼다.
- 그대로: DEMO 구역·구성 묶음 입력의 결과, 기존 명령·콜백, 피킹 순서, `restoreZoneBoxSteps`(폐기는 FE 전환 뒤 따로 예고한다).

### MR !230 보완

- 고침: `objectVersions` 를 실제로 그린 항목의 행에서 읽는다. 같은 ID 의 앞 행이 빠지거나 작업면·장애물이 같은 ID 일 때 형상과 버전이 다른 행에서 나오던 문제다.
- 바뀜: 새 구독자는 마지막으로 받은 응답을 받는다(실패 뒤 이전 정상 형상을 다시 보내지 않음). `SourceSnapshotInfo.lastOkReceivedAt` 을 추가했다.
- 바뀜: 범위를 정한 Source 는 scope 없는 응답을 버린다. 비운 시각보다 앞서 요청한 응답(`requestedAt`)도 버린다.
