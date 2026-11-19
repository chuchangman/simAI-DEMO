import type { ZoneContract } from '@/features/viewer3d/data/spatialFrame';
import type { PlannedGeometry, PlannedKind } from '@/features/viewer3d/planned/plannedLayout';
import type { ObstacleGeometry } from '@/features/viewer3d/surfaces/obstacleGeometry';
import type {
  WorkSurfaceContract,
  WorkSurfaceGeometry,
} from '@/features/viewer3d/surfaces/workSurfaceGeometry';
import type { ViewerMode, ViewerTarget } from '@/features/viewer3d/types';

// 3D 편집(S15P31A101-195)이 바깥(FE)에 알리는 값. Spatial 이 먼저 낸 선택 접점이며 FE·BE 와 합의한 저장 계약이 아니다.
// - 미리보기·결과는 저장 성공을 뜻하지 않는다(saved: false 고정). 저장·구성 적용(ACK)은 FE -189·BE -120 이 한다.
// - 좌표는 World(m, 오른손, +Z 위)의 축 정렬 상자 min·max 다. 네 모서리·다각형 같은 정식 구역 형상 계약이 아니다.

/**
 * 편집을 시작하지 못했거나 중간에 끝난 이유.
 * INVALID_TARGET 대상 모양이 틀림 · NOT_EDITABLE 이 대상·모드(REPLAY)·조작은 편집할 수 없음 ·
 * NOT_READY 뷰어가 준비되지 않았거나 오류 · NOT_FOUND 장면에 그 구역이 없음 ·
 * STALE_SOURCE 편집 중 원본(구역 형상·입력 Source·Scene 버전)이 바뀜 · INVALID_GEOMETRY 결과 형상이 유효하지 않음.
 */
export const VIEWER_EDIT_REJECT_REASONS = [
  'INVALID_TARGET',
  'NOT_EDITABLE',
  'NOT_READY',
  'NOT_FOUND',
  'STALE_SOURCE',
  'INVALID_GEOMETRY',
] as const;
export type ViewerEditRejectReason = (typeof VIEWER_EDIT_REJECT_REASONS)[number];

/** 취소 이유. USER 는 cancelEdit·Esc, 나머지는 선택·모드가 바뀌었거나 다른 편집으로 바뀌었거나 뷰어가 내려간 경우다. */
export type ViewerEditCancelReason =
  'USER' | 'SELECTION_CHANGED' | 'MODE_CHANGED' | 'REPLACED' | 'UNMOUNTED';

/** World 축 정렬 상자(m, Z-up). */
export interface ViewerEditBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** 편집을 시작할 때 실제로 확인한 출처. 모르는 값은 지어내지 않고 null 이다. */
export interface ViewerEditProvenance {
  /** 뷰어가 구독 중이던 입력 Source 의 id. */
  sourceId: string | null;
  /** 구역 형상 출처. DEMO_UNCONFIRMED 개발·전환용 DEMO 상자 · BE_ZONES_V1 BE GET /api/zones(-120). */
  zoneContract: ZoneContract;
  /** 구역 목록을 받은 시각(이 브라우저 시계, ms). */
  zonesReceivedAt: number | null;
  /** 편집을 시작할 때 받은 World 의 scene_version. World 를 받기 전이면 null. */
  sceneVersion: string | null;
  /** 구성 버전은 형상 응답에 실려 오지 않아 늘 null 이다(적용 ACK 는 FE·BE 몫). */
  configVersion: null;
  /** BE 정식 구역이면 편집을 시작한 zone_version(PUT 충돌 확인용). DEMO 구역·모르면 null 이거나 없다. */
  zoneVersion?: number | null;
}

/** 편집 중 초안. 원본(before)은 바뀌지 않는다. */
export interface ViewerEditPreview {
  target: ViewerTarget;
  mode: ViewerMode;
  before: ViewerEditBox;
  draft: ViewerEditBox;
  provenance: ViewerEditProvenance;
  saved: false;
}

export type ViewerEditResult =
  | {
      status: 'FINISHED';
      target: ViewerTarget;
      mode: ViewerMode;
      before: ViewerEditBox;
      after: ViewerEditBox;
      /** 초안이 원본과 다른지. */
      changed: boolean;
      provenance: ViewerEditProvenance;
      /** 저장 요청용 결과일 뿐 저장·적용 성공이 아니다. */
      saved: false;
    }
  | {
      status: 'CANCELLED';
      target: ViewerTarget;
      mode: ViewerMode;
      before: ViewerEditBox;
      reason: ViewerEditCancelReason;
      provenance: ViewerEditProvenance;
      saved: false;
    }
  | {
      status: 'REJECTED';
      target: ViewerTarget | null;
      reason: ViewerEditRejectReason;
      detail: string;
      saved: false;
    };

export type ViewerEditCommandResult = { ok: true } | { ok: false; reason: ViewerEditRejectReason };

/**
 * beginEdit 선택 사항(S15P31A101-234). 화면이 보관한 미저장 초안으로 편집을 한 번에 다시 연다
 * (칸별 updateEditField 를 차례로 다시 부르지 않는다). 둘 다 없으면 예전처럼 원본에서 시작한다.
 * - zone: ViewerEditBox · object WORK_SURFACE: ViewerWorkSurfaceGeometry · object OBSTACLE: ViewerObstacleGeometry
 * - draft: 다시 열 초안. 유효하지 않으면 INVALID_GEOMETRY 로 거부하고 편집을 열지 않는다.
 * - before: 초안을 만들 때 본 원본. 지금 원본과 다르면 STALE_SOURCE 로 거부한다(원본이 그새 바뀌었다).
 */
export interface ViewerBeginEditOptions {
  draft?: ViewerEditBox | ViewerWorkSurfaceGeometry | ViewerObstacleGeometry;
  before?: ViewerEditBox | ViewerWorkSurfaceGeometry | ViewerObstacleGeometry;
}

/**
 * 숫자로 고치는 값(World, m). originX·originY 는 min X·Y(크기 유지 이동), width·depth 는 min 을 고정한 폭·깊이,
 * zMin·zMax 는 하단·상단 높이다(S15P31A101-241).
 */
export type ViewerEditField = 'originX' | 'originY' | 'width' | 'depth' | 'zMin' | 'zMax';

/** 화면이 보관한 미저장 미리보기 형상을 읽기 전용 Ghost 로 겹쳐 그린다. 원본·위험 강조·선택에 영향을 주지 않는다. */
export interface ViewerEditOverlay {
  target: ViewerTarget;
  box: ViewerEditBox;
}

export type ViewerEditOverlayInput = ViewerEditOverlay | readonly ViewerEditOverlay[] | null;

// ---- 작업면 OBB 편집(S15P31A101-188) ----
// 구역 편집 값(ViewerEditPreview·ViewerEditResult)과 모양이 달라 따로 둔다. 구역 쪽 타입·콜백은 그대로다.
// 형상은 계약 work_surface 필드와 1:1 이다(centerXy=center_xy, sizeXy=size_xy, yawRad=yaw_rad, topHeightM=top_height_m).
// 저장·구성 묶음 적용·버전 확정은 FE -165·BE -58 이 한다. 여기 결과는 저장 요청에 쓸 값일 뿐이다(saved: false).
// 등록 정적 객체(OBSTACLE, -274)도 같은 object 대상·같은 콜백으로 알린다. objectKind 로 형상 모양을 가른다.
// 정적 객체 형상은 계약 obb 와 1:1 이다(center=obb.center 3D 중심, size=obb.size 전체 길이, yawRad=obb.yaw_rad).

/** 작업면 형상(World m·rad). */
export type ViewerWorkSurfaceGeometry = WorkSurfaceGeometry;

/** 정적 객체 형상(World m·rad, -274). */
export type ViewerObstacleGeometry = ObstacleGeometry;

/** object 편집 대상 종류. 계약 static_object.kind 와 같은 값이다. */
export type ViewerObjectKind = 'WORK_SURFACE' | 'OBSTACLE';

/** REGISTERED 받은 등록 작업면·정적 객체를 고침 · NEW 3D 에서 새 작업면을 만듦(아직 어디에도 등록되지 않음). */
export type ViewerObjectEditOrigin = 'REGISTERED' | 'NEW';

/** 작업면 편집을 시작할 때 실제로 확인한 출처. 모르는 값은 null 이다. */
export interface ViewerObjectEditProvenance {
  sourceId: string | null;
  /** 형상 출처. OPERATIONAL_GEOMETRY_UNCONFIRMED 구성 묶음 모양 · BE_STATIC_OBJECTS_V1 BE GET /api/static-objects(-58). */
  geometryContract: WorkSurfaceContract;
  /** 작업면 묶음을 받은 시각(이 브라우저 시계, ms). */
  surfacesReceivedAt: number | null;
  /** 묶음에 실린 version. 없으면 null. */
  geometryVersion: string | null;
  sceneVersion: string | null;
  configVersion: null;
  /** BE 정식 응답이면 편집을 시작한 object_version. NEW·묶음 모양 입력은 null 이거나 없다. */
  objectVersion?: number | null;
}

interface ObjectEditPreviewBase {
  target: ViewerTarget;
  mode: ViewerMode;
  origin: ViewerObjectEditOrigin;
  provenance: ViewerObjectEditProvenance;
  saved: false;
}

export type ViewerObjectEditPreview =
  | (ObjectEditPreviewBase & {
      objectKind: 'WORK_SURFACE';
      before: ViewerWorkSurfaceGeometry;
      draft: ViewerWorkSurfaceGeometry;
    })
  | (ObjectEditPreviewBase & {
      objectKind: 'OBSTACLE';
      before: ViewerObstacleGeometry;
      draft: ViewerObstacleGeometry;
    });

interface ObjectEditFinishedBase {
  status: 'FINISHED';
  target: ViewerTarget;
  mode: ViewerMode;
  origin: ViewerObjectEditOrigin;
  /**
   * 계약 항목(snake_case). 작업면은 work_surface(surface_id·top_height_m·center_xy·size_xy·yaw_rad),
   * 정적 객체는 static_objects 항목(object_id·kind·obb{center·size·yaw_rad})이다. 받은 원본 항목의 다른 키
   * (top_height_sigma_m·name 등)는 그대로 실린다. 저장 요청 본문을 만들 때 쓴다. NEW 는 형상 필드만 있다.
   */
  afterItem: Record<string, unknown>;
  changed: boolean;
  provenance: ViewerObjectEditProvenance;
  saved: false;
}

interface ObjectEditCancelledBase {
  status: 'CANCELLED';
  target: ViewerTarget;
  mode: ViewerMode;
  origin: ViewerObjectEditOrigin;
  reason: ViewerEditCancelReason;
  provenance: ViewerObjectEditProvenance;
  saved: false;
}

export type ViewerObjectEditResult =
  | (ObjectEditFinishedBase & {
      objectKind: 'WORK_SURFACE';
      before: ViewerWorkSurfaceGeometry;
      after: ViewerWorkSurfaceGeometry;
    })
  | (ObjectEditFinishedBase & {
      objectKind: 'OBSTACLE';
      before: ViewerObstacleGeometry;
      after: ViewerObstacleGeometry;
    })
  | (ObjectEditCancelledBase & { objectKind: 'WORK_SURFACE'; before: ViewerWorkSurfaceGeometry })
  | (ObjectEditCancelledBase & { objectKind: 'OBSTACLE'; before: ViewerObstacleGeometry })
  | {
      status: 'REJECTED';
      target: ViewerTarget | null;
      reason: ViewerEditRejectReason;
      detail: string;
      saved: false;
    };

/**
 * 숫자로 고치는 작업면 값. centerX·centerY 중심(m) · width·depth 지역 축 전체 길이(m, 중심 고정) ·
 * topHeight 상판 높이(m, 바닥 고정) · yaw 수평 회전(rad, [-π, π]).
 * 정적 객체(-274)는 centerZ 중심 높이(m, 크기 유지) · height 높이(m, 중심 고정)도 받는다. topHeight 는 윗면 높이(아랫면 고정)다.
 * 작업면에서 centerZ·height 는 NOT_EDITABLE 이다(바닥에 놓인 형상).
 */
export type ViewerObjectEditField =
  'centerX' | 'centerY' | 'width' | 'depth' | 'topHeight' | 'yaw' | 'centerZ' | 'height';

// ---- PLANNED 가상 배치 편집(S15P31A101-186) ----
// 구역·작업면 콜백과 따로 알린다(onPlannedEditPreview·onPlannedEditResult). LIVE 편집 결과와 섞이지 않는다.
// 형상은 World(m, +Z 위) OBB(center 3D 중심·size 전체 길이·yawRad)이고, 저장·평가·발행은 FE -62·BE -30 몫이다(saved: false).

/** 가상 객체 종류. 개구부·비계·장비. */
export type ViewerPlannedKind = PlannedKind;
/** 가상 객체 형상(World m·rad). */
export type ViewerPlannedGeometry = PlannedGeometry;
/** 숫자로 고치는 가상 객체 값. 정적 객체와 같다(centerX·centerY·centerZ·width·depth·height·topHeight·yaw). */
export type ViewerPlannedEditField = ViewerObjectEditField;

interface PlannedEditBase {
  target: ViewerTarget;
  /** 늘 PLANNED 다. */
  mode: ViewerMode;
  /** REGISTERED 받은 배치의 객체를 고침 · NEW 3D 에서 새로 만듦(아직 배치에 없음). */
  origin: ViewerObjectEditOrigin;
  plannedKind: ViewerPlannedKind;
  /** 편집을 시작할 때 받은 배치의 layoutId(없으면 null). */
  layoutId: string | null;
  saved: false;
}

export interface ViewerPlannedEditPreview extends PlannedEditBase {
  before: ViewerPlannedGeometry;
  draft: ViewerPlannedGeometry;
}

export type ViewerPlannedEditResult =
  | (PlannedEditBase & {
      status: 'FINISHED';
      before: ViewerPlannedGeometry;
      after: ViewerPlannedGeometry;
      changed: boolean;
    })
  | (PlannedEditBase & {
      status: 'CANCELLED';
      before: ViewerPlannedGeometry;
      reason: ViewerEditCancelReason;
    })
  | {
      status: 'REJECTED';
      target: ViewerTarget | null;
      reason: ViewerEditRejectReason;
      detail: string;
      saved: false;
    };
