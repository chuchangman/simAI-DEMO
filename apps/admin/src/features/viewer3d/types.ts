import type { CalibratedCameraPose } from '@/features/viewer3d/cameras/cameraMarkers';
import type { SpatialSource } from '@/features/viewer3d/data/spatialSource';
import type {
  ViewerBeginEditOptions,
  ViewerEditBox,
  ViewerEditCommandResult,
  ViewerEditField,
  ViewerEditOverlayInput,
  ViewerEditPreview,
  ViewerEditResult,
  ViewerObjectEditField,
  ViewerObjectEditPreview,
  ViewerObjectEditResult,
  ViewerPlannedEditField,
  ViewerPlannedEditPreview,
  ViewerPlannedEditResult,
  ViewerPlannedGeometry,
  ViewerPlannedKind,
  ViewerWorkSurfaceGeometry,
} from '@/features/viewer3d/editing/editTypes';
import type { ViewerLayers } from '@/features/viewer3d/layers';
import type { RiskColorLevel } from '@/features/viewer3d/palette';
import type { PlannedLayoutInput } from '@/features/viewer3d/planned/plannedLayout';
import type { ViewerPostProcessingInput } from '@/features/viewer3d/PostProcessingLayer';
import type { ViewerSceneInput, ViewerSceneStatus } from '@/features/viewer3d/scene/sceneContract';
import type { ViewerVdtOptions } from '@/features/viewer3d/scene/vdtTypes';
import type { FloorCoverage } from '@/lib/floorCoverage';
import type { Ref } from 'react';

// FE 와 주고받는 값의 모양이다. FE 통합(S15P31A101-193 완료 조건) 때 함께 확정하며, 아직 팀 공통 계약이 아니다.

/** 관제 모드. LIVE 관측, PLANNED TBM 가상 배치, REPLAY 기록 재생(명세 13.4). */
export const VIEWER_MODES = ['LIVE', 'PLANNED', 'REPLAY'] as const;
export type ViewerMode = (typeof VIEWER_MODES)[number];

/**
 * 3D 에서 고를 수 있는 대상. person 은 world_id, zone 은 zone_id, object 는 등록 OBB(작업면·정적 객체)의 ID,
 * planned 는 PLANNED 가상 배치 객체의 ID 다(-186, PLANNED 모드에서만 장면에 있다).
 */
export const VIEWER_TARGET_TYPES = ['person', 'zone', 'object', 'planned'] as const;
export type ViewerTargetType = (typeof VIEWER_TARGET_TYPES)[number];

/** 사람에게 붙는 안전모·조끼의 상태(명세 13.3). WORN 만 실물로 그리고 UNKNOWN·NOT_WORN 은 형상 없음(하나라도 미착용이면 머리 위 경고 표식). */
export type PersonHelmetState = 'WORN' | 'NOT_WORN' | 'UNKNOWN';

/** 3D 사람 이름표의 왼쪽 워치 아이콘 상태(S15P31A101-658 A안). 배정 없는 사람은 워치 칸을 넣지 않는다. */
export type ViewerLabelWatchStatus = 'connected' | 'disconnected';

/**
 * 3D 사람 이름표 칸(S15P31A101-658 A안).
 * 왼쪽 워치 아이콘 칸·사람 이름 칸·뒤따르는 PPE 칸을 문자열 이어붙이기 대신 칸 목록으로 넘긴다.
 * 추후 PPE 아이콘 칸 등도 같은 배열에 더할 수 있게 태그드 유니온으로 둔다.
 */
export type ViewerLabelCell =
  { kind: 'watch'; status: ViewerLabelWatchStatus } | { kind: 'text'; text: string };

export interface ViewerTarget {
  type: ViewerTargetType;
  id: string;
}

export type ViewerPhase = 'initializing' | 'ready' | 'error';

/** RENDER_FAILED: 렌더러를 만들지 못했거나 장면이 예외를 냈다. CONTEXT_LOST: 브라우저가 WebGL 컨텍스트를 회수했다. */
export type ViewerErrorCode = 'RENDER_FAILED' | 'CONTEXT_LOST';

export interface ViewerError {
  code: ViewerErrorCode;
  message: string;
}

export interface ViewerStatus {
  phase: ViewerPhase;
  mode: ViewerMode;
  error: ViewerError | null;
}

/** INVALID_*: 값의 모양이 틀렸다. NOT_FOUND: 장면에 없는 대상이다. NOT_READY: 렌더러가 준비되지 않았거나 오류 상태다. */
export type CommandFailureReason = 'INVALID_TARGET' | 'INVALID_MODE' | 'NOT_FOUND' | 'NOT_READY';

/** pending 은 select 를 waitMs 로 불렀고 대상이 아직 장면에 없어 기다리는 중이라는 뜻이다(결과는 onSelectRequestChange). */
export type CommandResult =
  { ok: true; pending?: true } | { ok: false; reason: CommandFailureReason };

/** select 선택 사항(S15P31A101-234). 없으면 예전처럼 지금 장면에 있을 때만 고른다. */
export interface ViewerSelectOptions {
  /**
   * 대상이 아직 장면에 없거나 뷰어가 준비 중이면 이 시간(ms)까지 기다렸다가 고른다. 0·없음이면 기다리지 않는다.
   * 최대 MAX_SELECT_WAIT_MS 로 자른다. 기다리는 요청은 하나뿐이고, 새 select·clearSelection·3D 클릭이 오면 취소된다.
   */
  waitMs?: number;
  /** 고르면서 카메라 초점도 맞춘다. */
  focus?: boolean;
}

/**
 * 기다리는 선택 요청의 진행. PENDING 기다리기 시작 · APPLIED 장면에 올라와 골랐음 ·
 * EXPIRED waitMs 가 지남 · CANCELLED 다른 선택·해제·오류·뷰어 내려감으로 그만둠.
 */
export type ViewerSelectRequestStatus = 'PENDING' | 'APPLIED' | 'EXPIRED' | 'CANCELLED';
export type ViewerSelectCancelReason = 'REPLACED' | 'SELECTION_CHANGED' | 'NOT_READY' | 'UNMOUNTED';

export interface ViewerSelectRequest {
  target: ViewerTarget;
  status: ViewerSelectRequestStatus;
  focus: boolean;
  /** CANCELLED 일 때만. */
  reason?: ViewerSelectCancelReason;
}

/** FE → 뷰어 명령. 실패해도 예외를 던지지 않고 이유를 돌려준다. */
export interface Viewer3DHandle {
  /** 대상을 고른다. options.waitMs 를 주면 아직 없는 대상을 기다렸다가 고른다(-234, 선택 사항). */
  select(target: ViewerTarget, options?: ViewerSelectOptions): CommandResult;
  clearSelection(): CommandResult;
  focus(target: ViewerTarget): CommandResult;
  setMode(mode: ViewerMode): CommandResult;
  /**
   * 형상 편집을 시작한다(S15P31A101-195, Spatial 선제안·FE 미합의). 그 대상을 선택하고 손잡이를 띄운다.
   * 원본은 바꾸지 않고 초안만 바꾼다. REPLAY 는 NOT_EDITABLE. zone(구역 AABB)과 object(등록 작업면 OBB, -188)를 받는다.
   * 작업면 편집의 초안·결과는 onObjectEditPreview·onObjectEditResult 로 따로 알린다(구역 콜백은 부르지 않는다).
   */
  beginEdit(target: ViewerTarget, options?: ViewerBeginEditOptions): ViewerEditCommandResult;
  /** 구역 초안을 버린다. 구역 편집 중이 아니면 null. 결과는 onEditResult 로도 알린다. */
  cancelEdit(): ViewerEditResult | null;
  /** 구역 초안을 World 결과로 돌려주고 편집을 끝낸다. 저장하지 않는다(saved: false). 구역 편집 중이 아니면 null. */
  finishEdit(): ViewerEditResult | null;
  /**
   * 편집 중 초안의 한 값을 World 절대값(m)으로 고친다(숫자 입력, S15P31A101-241). 손잡이 끌기와 같은 엔진으로 검사한다.
   * 편집 중이 아니면 NOT_EDITABLE, 유한하지 않거나 경계가 교차하면 INVALID_GEOMETRY 이고 초안은 그대로다.
   * 성공하면 onEditPreview 로 새 초안을 알린다.
   */
  updateEditField(change: { field: ViewerEditField; value: number }): ViewerEditCommandResult;
  // 아래 작업면 명령(-188)은 기존 FE 가짜 핸들·시험과 호환되도록 선택 멤버로 둔다. Viewer3D 는 늘 채운다.
  /** 작업면 초안을 버린다(-188). 작업면 편집 중이 아니면 null. 결과는 onObjectEditResult 로도 알린다. */
  cancelObjectEdit?(): ViewerObjectEditResult | null;
  /** 작업면 초안을 World 결과(center_xy·size_xy·yaw_rad·top_height_m)로 돌려준다. 저장하지 않는다. 편집 중이 아니면 null. */
  finishObjectEdit?(): ViewerObjectEditResult | null;
  /**
   * 작업면 초안의 한 값을 절대값으로 고친다(숫자 입력, -188). 손잡이와 같은 엔진·정책으로 검사한다.
   * 편집 중이 아니면 NOT_EDITABLE, 유한하지 않거나 크기·상판이 0 이하이거나 yaw 가 [-π, π] 밖이면 INVALID_GEOMETRY 이고 초안은 그대로다.
   */
  updateObjectEditField?(change: {
    field: ViewerObjectEditField;
    value: number;
  }): ViewerEditCommandResult;
  /**
   * 새 작업면을 3D 에서 만든다(-188). FE 가 정한 ID 와 처음 형상(World m·rad)으로 NEW 편집 세션을 열고 손잡이를 띄운다.
   * ID 가 비었거나 floor·이미 장면에 있는 ID 면 INVALID_TARGET, 형상이 틀리면 INVALID_GEOMETRY. 끝나면 장면에서 사라진다
   * (결과 afterItem 으로 등록 요청을 만들고, 등록된 묶음이 다시 들어오면 그때 작업면으로 그린다).
   */
  beginObjectCreate?(input: {
    id: string;
    geometry: ViewerWorkSurfaceGeometry;
  }): ViewerEditCommandResult;
  // 아래 PLANNED 명령(-186)도 FE 가짜 핸들과 호환되도록 선택 멤버다. Viewer3D 는 늘 채운다.
  // 기존 가상 객체 편집은 beginEdit({ type: 'planned', id }) 로 연다. PLANNED 모드가 아니면 NOT_EDITABLE 이다.
  /**
   * 새 가상 객체를 3D 에서 만든다(-186). FE 가 정한 ID·종류·처음 형상으로 NEW 편집을 열고 손잡이를 띄운다.
   * PLANNED 모드가 아니면 NOT_EDITABLE, ID 가 비었거나 배치에 이미 있으면 INVALID_TARGET, 형상이 틀리면 INVALID_GEOMETRY.
   * 끝나면 장면에서 사라진다(결과 after 로 FE 배치에 더하고, 다시 넘기면 그때 배치 객체로 그린다).
   */
  beginPlannedCreate?(input: {
    id: string;
    kind: ViewerPlannedKind;
    geometry: ViewerPlannedGeometry;
  }): ViewerEditCommandResult;
  /** 가상 객체 초안을 버린다. 가상 객체 편집 중이 아니면 null. 결과는 onPlannedEditResult 로도 알린다. */
  cancelPlannedEdit?(): ViewerPlannedEditResult | null;
  /** 가상 객체 초안을 World 결과로 돌려주고 편집을 끝낸다. 저장하지 않는다. 편집 중이 아니면 null. */
  finishPlannedEdit?(): ViewerPlannedEditResult | null;
  /** 가상 객체 초안을 절대값으로 고친다(숫자 입력). 손잡이와 같은 엔진으로 검사한다. */
  updatePlannedEditField?(change: {
    field: ViewerPlannedEditField;
    value: number;
  }): ViewerEditCommandResult;
  /**
   * 카메라를 처음 시점(방 가운데를 내려다봄)으로 돌린다(관제 화면 '시점 초기화'). 선택은 그대로다.
   * 기존 FE 가짜 핸들과 호환되도록 선택 멤버로 둔다. Viewer3D 는 늘 채운다.
   */
  resetView?(): CommandResult;
  /**
   * 카메라를 바로 위에서 내려다보는 시점('위에서 보기')으로 바꾸거나 원래 시점으로 돌린다.
   * 선택 멤버로 둔다. Viewer3D 는 늘 채운다.
   */
  setTopView?(enabled: boolean): CommandResult;
  /**
   * 3D 시점을 그 카메라 자리·방향·세로 시야각으로 약 1 초에 걸쳐 옮긴다(-590, 움직임 줄이기 설정이면 바로).
   * 맞아 있는 동안만 장면에 VDT(시점 의존 텍스처)를 켜고, 사용자가 시점을 돌리거나 다른 시점으로 가면 서서히 끈다.
   * 처음 부를 때의 시점을 기억해 exitCameraView 로 돌아간다. 같은 카메라를 다시 부르면 다시 맞추고 켠다.
   * 준비 전이면 NOT_READY, cameraPoses 에 없는 카메라면 NOT_FOUND. 선택 멤버로 둔다. Viewer3D 는 늘 채운다.
   */
  viewFromCamera?(cameraId: string): CommandResult;
  /** 카메라 시점에서 나가 기억한 시점으로 부드럽게 돌아가고 VDT 를 끈다(-590). 카메라 시점이 아니면 아무것도 하지 않는다. */
  exitCameraView?(): CommandResult;
}

/**
 * 호스트가 쥐고 있는 상자 편집(제어형 조작기, `boxEdit` prop). 뷰어 안 편집 세션(beginEdit)과 따로이며 서로 영향이 없다.
 * 화면에는 상자 미리보기와 가운데 이동 구, 면별 화살표를 그린다. 상자는 늘 호스트가 정본이다(onBoxEditChange 로 올리고 다시 내려 받는다).
 */
export interface ViewerBoxEdit {
  /** 바뀌면 끌던 조작을 끝낸다(구역 ID · "surface:<zoneId>" · "new"). */
  id: string;
  /** zone 은 여섯 화살표 모두, surface 는 z- 화살표를 숨긴다(작업면은 바닥 위 판이라 아래쪽 끝을 끌지 못한다). */
  kind: 'zone' | 'surface';
  /** World 축 정렬 상자(m). */
  box: ViewerEditBox;
}

/** 호스트가 보관한 미저장 초안 하나(읽기 전용 윤곽, `boxGhosts` prop). */
export interface ViewerBoxGhost {
  id: string;
  box: ViewerEditBox;
  /** 있으면 점선 윤곽 대신 그 위험 등급색의 실선 윤곽과 반투명 면으로 도드라지게 그린다(초안 카드에 커서를 댔을 때). */
  highlight?: RiskColorLevel;
}

export interface Viewer3DProps {
  ref?: Ref<Viewer3DHandle>;
  /** 장면 색표. 화면 테마(다크·화이트)를 넘긴다. 바꿔도 장면은 그대로이고 색만 바뀐다. 없으면 다크. */
  theme?: 'dark' | 'light';
  /** 처음 마운트할 때만 읽는다. 이후 바꾸려면 setMode 를 쓴다. */
  initialMode?: ViewerMode;
  /** 3D 클릭이든 FE 명령이든 선택이 바뀔 때마다 부른다. 해제는 null. */
  onSelectionChange?: (target: ViewerTarget | null) => void;
  /** 기다리는 선택(select 의 waitMs)의 진행을 알린다(-234, 선택 사항). */
  onSelectRequestChange?: (request: ViewerSelectRequest) => void;
  /**
   * 레이어별 표시·피킹(-234, 선택 사항). 적지 않은 레이어는 interactive(기존 동작)다.
   * 데이터는 그대로 두고 화면에서 보이는 방식만 바꾼다. 렌더마다 새 객체를 만들어도 값이 같으면 다시 그리지 않는다.
   */
  layers?: ViewerLayers;
  /**
   * 사람 모델(glTF/GLB) 주소(선택). 읽지 못하면 캡슐 아바타로 그린다. 에셋 권리·배포 경로는 FE·팀이 정한다.
   * 처음 값을 쓰며 바꾸면 모델을 다시 읽는다.
   */
  personModelUrl?: string | null;
  /**
   * EXP-02 사람 메시(-65, 선택 사항). 'auto'(기본)면 source 로 avatar_frame(/topic/avatar)이 들어온 사람만 스키닝 메시로 그리고,
   * 끊김(0.5 s)·늦음(500 ms)·ID 불확실·보정 불일치·자산 실패면 기존 캡슐·골격으로 되돌아간다. 'off' 면 늘 기존 경로다.
   * 위치·접지·관측 상태는 늘 world_state 를 따른다.
   */
  avatarMesh?: 'auto' | 'off';
  /**
   * 사람 이름표 칸 목록(World ID → 칸 배열, S15P31A101-658 A안, 선택 사항).
   * 넘기면 기존 World ID 문자열 이름표 대신 한 이름표 안에 `[선택 워치 아이콘 칸, 이름 칸, ...PPE 칸]` 을 그린다.
   * World ID·기기 ID·"워치" 글자는 넣지 않는다. 내용이 같으면 다시 그리지 않는다.
   */
  personLabels?: Readonly<Record<string, readonly ViewerLabelCell[]>>;
  /**
   * 레거시 사람 이름표 뒤에 붙일 짧은 글(World ID → 글, -342, 선택 사항). `personLabels` 를 넘기지 않을 때만 쓰인다.
   */
  personBadges?: Readonly<Record<string, string>>;
  /**
   * 사람 강조(World ID → 큰 이름표 글, -509, 선택 사항). 있는 동안 그 사람 발밑에 고리 펄스와 큰 이름표를 보인다.
   * 시간은 호스트가 정한다(키를 빼면 바로 사라진다). 내용이 같으면 다시 그리지 않고, 화면에 없는 사람은 그리지 않는다.
   */
  personHighlights?: Readonly<Record<string, string>>;
  /**
   * 사람별 안전모 상태(World ID → 상태, -531, 선택 사항). 호스트가 같은 World ID·identity_revision·만료·연결을 이미 따진 값만 넘긴다.
   * 안전모·조끼 형상은 그리지 않는다(-783). 안전모나 조끼가 미착용이면 머리 위에 빨간 경고 표식 하나가 보인다.
   * 경보가 아니다(경보는 R9 이벤트). 키가 없는 사람은 그리지 않는다. 내용이 같으면 다시 그리지 않는다.
   */
  personHelmets?: Readonly<Record<string, PersonHelmetState>>;
  /**
   * 사람별 조끼 상태(World ID → 상태, -552, 선택 사항). `personHelmets` 와 같은 규칙이다: 호스트가 같은 World ID·identity_revision·
   * 만료·연결을 이미 따진 값만 넘기고, 키가 없는 사람은 그리지 않는다. 내용이 같으면 다시 그리지 않는다.
   */
  personVests?: Readonly<Record<string, PersonHelmetState>>;
  /**
   * 보정된 카메라 마커 목록(-522, 선택 사항). LIVE 모드에서 카메라 본체·렌즈, 카메라 ID 이름표, 약 1.5 m 시야 절두체를 그린다.
   * 구역·작업면 편집 중에는 자동으로 숨기고, 사람이 선택되면 그 트랙의 cameras 에 포함된 카메라 마커를 강조 표시한다.
   * 렌더마다 새 배열을 넘겨도 값이 같으면 다시 그리지 않는다.
   */
  cameraPoses?: readonly CalibratedCameraPose[];
  /** 3D 카메라 마커를 클릭했을 때 부른다(-522, 선택 사항). 호스트가 떠 있는 CCTV 창을 열어 해당 카메라로 맞춘다. */
  onCameraClick?: (cameraId: string) => void;
  /**
   * 바닥 감시 범위 겹침(-606, 선택 사항). `readFloorCoverage(scene 응답)` 결과를 넘기면 바닥(Z=0) 바로 위에 칸마다
   * 사람을 통째로 보는 카메라 수(2대 이상·1대·사각)를 반투명 색으로 깐다. 바닥 모름 칸은 그리지 않는다. 클릭을 받지 않는다.
   * 지금 보정과 맞는지(`isCoverageCurrent`)와 켜고 끄기는 호스트가 정한다. null·없음이면 그리지 않는다.
   * 같은 객체면 다시 그리지 않으니 응답이 바뀔 때만 새로 만든다. Visual 층이라 위험 판정·사람 위치와 무관하다.
   */
  floorCoverage?: FloorCoverage | null;
  /**
   * 아바타 자산(mesh_url, 같은 출처 /api/avatars/...) 내려받기(선택 사항). FE 가 인증된 요청 함수를 넘긴다.
   * 없으면 fetch(url, { credentials: 'same-origin' }). 렌더마다 새 함수를 만들지 말고 고정해 넘긴다.
   */
  avatarMeshFetch?: (url: string) => Promise<ArrayBuffer>;
  /** 3D 대상을 더블클릭했을 때 부른다(구역 편집 모드에서 구역 더블클릭 즉시 수정 진입용). */
  onTargetDoubleClick?: (target: ViewerTarget) => void;
  /** 마운트 직후 한 번, 이후 단계·모드·오류가 바뀔 때마다 부른다. */
  onStatusChange?: (status: ViewerStatus) => void;
  /**
   * World·위험 이벤트·Health 입력(Mock 또는 외부 Live). 렌더마다 새로 만들지 말고 고정해 넘긴다.
   * 다른 Source(다른 id)로 바꾸면 받은 데이터만 비우고 Canvas·카메라·선택·모드는 그대로다. 없으면 데이터 없이 장면만 그린다.
   */
  source?: SpatialSource | null;
  /**
   * 편집 초안. 시작할 때와 손잡이를 놓을 때마다 부른다(끄는 도중에는 부르지 않는다). 저장 성공이 아니다.
   * 선택 사항이며 없으면 편집 결과를 받지 않는다(기존 화면 그대로).
   */
  onEditPreview?: (preview: ViewerEditPreview) => void;
  /** 편집이 끝날 때(완료·취소·거부) 부른다. 시작하지 못한 이유(REJECTED)도 알린다. */
  onEditResult?: (result: ViewerEditResult) => void;
  /** 작업면 OBB 편집 초안(-188). 시작할 때와 손잡이를 놓을 때마다 부른다. 저장 성공이 아니다. */
  onObjectEditPreview?: (preview: ViewerObjectEditPreview) => void;
  /** 작업면 OBB 편집이 끝날 때(완료·취소·거부) 부른다. */
  onObjectEditResult?: (result: ViewerObjectEditResult) => void;
  /**
   * 화면이 보관한 미저장 미리보기를 겹쳐 그린다(선택 사항, 읽기 전용 Ghost). 클릭·위험 강조·원본 구역에 영향이 없고,
   * 그 구역이 장면에 없으면 그리지 않는다. 같은 구역을 편집하는 동안에는 편집 미리보기가 대신한다.
   * 단일 구역 또는 여러 구역 배열을 모두 받는다.
   */
  editDraftOverlay?: ViewerEditOverlayInput;
  /**
   * 정적 배경 Scene(S15P31A101-59). FE 가 인증된 HTTP 로 받은 GET /api/scenes/current 결과를 그대로 넘긴다
   * (확정 전 Scene 은 GET /api/scenes/{scene_version}/view 결과. `{ ok: true, raw: 응답 본문 }` 또는 실패 `{ ok: false, reason, httpStatus? }`). 없거나 null 이면 기본 바닥만 그린다.
   * 렌더마다 새 객체를 만들지 말고 응답이 바뀔 때만 바꾼다. 같은 scene_version 의 서명 주소만 바뀌면 자산을 다시 읽지 않는다.
   */
  scene?: ViewerSceneInput | null;
  /**
   * 배경 상태(읽기 단계·정합 판정·표시 방식·다시 받기 필요)가 바뀔 때 부른다. needsRefetch 면 FE 가 다시 조회한다.
   * 서명 주소·토큰은 싣지 않는다.
   */
  onSceneStatusChange?: (status: ViewerSceneStatus) => void;
  /**
   * PLANNED 가상 배치(-186, 선택 사항). FE 가 가진 계획의 가상 개구부·비계·장비 목록이다. PLANNED 모드에서만 그리고 고른다.
   * LIVE World·판정·구역과 섞이지 않는다. 렌더마다 새 객체를 만들지 말고 배치가 바뀔 때만 바꾼다.
   */
  plannedLayout?: PlannedLayoutInput | null;
  /** 가상 객체 편집 초안(-186). 시작할 때와 손잡이를 놓을 때마다 부른다. 저장이 아니다. */
  onPlannedEditPreview?: (preview: ViewerPlannedEditPreview) => void;
  /** 가상 객체 편집이 끝날 때(완료·취소·거부) 부른다. */
  onPlannedEditResult?: (result: ViewerPlannedEditResult) => void;
  /**
   * 호스트가 쥐고 있는 상자 편집 조작기(선택 사항). 넘기면 상자 미리보기와 손잡이(가운데 구 = 바닥 이동, 면별 화살표 = 그 면만 이동)를 그린다.
   * null·없음이면 조작기를 그리지 않는다. 뷰어 안 편집 세션과 따로 동작한다.
   */
  boxEdit?: ViewerBoxEdit | null;
  /**
   * 끄는 동안 맞춘 결과(0.05 m 단위, 교실 범위 안)가 지금 상자와 다를 때마다 새 상자를 올린다. Esc 는 끌기 전 상자로 올린다.
   * 호스트는 받은 상자를 boxEdit.box 로 다시 내려 준다(끄는 동안은 끌기 시작 때의 상자에서 계산한다).
   */
  onBoxEditChange?: (box: ViewerEditBox) => void;
  /** 보관된 미저장 초안의 읽기 전용 윤곽(점선). 클릭을 받지 않고, boxEdit.id 와 같은 id 는 그리지 않는다. */
  boxGhosts?: readonly ViewerBoxGhost[];
  /**
   * 후처리 옵션(-360, 선택 사항). N8AO 주변 차폐와 SMAA 안티앨리어싱을 켜고 끈다.
   * 노트북 부하를 고려해 기본값은 false(끔)다.
   */
  postProcessing?: ViewerPostProcessingInput;
  /**
   * 카메라를 바로 위에서 내려다보는 시점('위에서 보기')으로 둘지 여부(선택 사항, 기본 false).
   * true 로 바뀌면 위에서 내려다보는 시점으로 옮기고, false 로 바뀌면 이전 시점(또는 기본 시점)으로 돌아간다.
   */
  topView?: boolean;
  /**
   * 시점 의존 텍스처(VDT, -534, 선택 사항). 장면 배경에 카메라 4대 실제 사진을 시점 각도·깊이 가림 검사·외톨이 제거에 따라
   * 실시간 투영하고 바닥·벽 미관측 표시 층 및 구멍 경계 페더링을 적용한다.
   * 기능 플래그 기본값은 false(끔)이며, 꺼져 있을 때는 기존 구운 텍스처(MeshBasicMaterial) 경로를 그대로 사용한다.
   * 꺼져 있어도 viewFromCamera 로 카메라 시점에 맞아 있는 동안은 켠다(-590). 사진이 없으면(장면 vdt·cameraImageUrls 모두 없음) 켜지 않는다.
   */
  vdt?: boolean | ViewerVdtOptions;
  className?: string;
}
