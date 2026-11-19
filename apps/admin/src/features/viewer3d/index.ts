// viewer3d 의 입구. 바깥에서는 여기서만 import 한다(front/CONVENTION.md 「의존 방향」).
// 공개 계약과 변경 이력은 같은 폴더의 CONTRACT.md·CHANGELOG.md 에 둔다. 여기서 빼거나 모양을 바꾸면 FE 리뷰가 필요하다.
export {
  CAMERA_FRUSTUM_ASPECT,
  CAMERA_FRUSTUM_LENGTH_M,
  cameraFrustumDimensions,
  cameraMarkerTransform,
  highlightedCameraIds,
  readCalibrationCameraPoses,
  sameCalibratedCameraPoses,
} from '@/features/viewer3d/cameras/cameraMarkers';
export type {
  CalibratedCameraPose,
  CameraFrustumDimensions,
  CameraMarkerTransform,
} from '@/features/viewer3d/cameras/cameraMarkers';
export { adaptZones } from '@/features/viewer3d/data/contractAdapter';
export type {
  OfficialZoneInfo,
  ZoneContract,
  ZoneEvalType,
  ZoneSeverity,
  ZoneShape,
} from '@/features/viewer3d/data/spatialFrame';
export {
  SOURCE_SNAPSHOT_CHANNELS,
  createExternalSource,
} from '@/features/viewer3d/data/spatialSource';
export type {
  ExternalSpatialSource,
  SnapshotPushOptions,
  SnapshotPushOutcome,
  SourceConnection,
  SourceConnectionChange,
  SourceSnapshotChannel,
  SourceSnapshotInfo,
  SpatialSource,
  SpatialSourceSink,
  WorkSurfacesResult,
  ZonesResult,
} from '@/features/viewer3d/data/spatialSource';
export {
  EDIT_FACES,
  EDIT_FIELDS,
  OBJECT_EDIT_FIELDS,
  OBSTACLE_OBB_POLICY,
  PLANNED_OBB_POLICY,
  WORK_SURFACE_OBB_POLICY,
  ZONE_AABB_POLICY,
  applyEditOperation,
  applyEditOperations,
  applyZoneBoxOperation,
  boxJson,
  fieldOperation,
  isValidBox,
  objectFieldOperations,
  restoreZoneBoxSteps,
  sameBox,
} from '@/features/viewer3d/editing/editGeometry';
export type {
  BoxEditOutcome,
  EditFace,
  EditFailureReason,
  EditField,
  EditOperation,
  EditOutcome,
  EditPolicy,
  EditShape,
  ObjectEditField,
  SerializableEditBox,
  WorldBox,
  WorldObb,
} from '@/features/viewer3d/editing/editGeometry';
export { VIEWER_EDIT_REJECT_REASONS } from '@/features/viewer3d/editing/editTypes';
export type {
  ViewerBeginEditOptions,
  ViewerEditBox,
  ViewerEditCancelReason,
  ViewerEditCommandResult,
  ViewerEditField,
  ViewerEditOverlay,
  ViewerEditOverlayInput,
  ViewerEditPreview,
  ViewerEditProvenance,
  ViewerEditRejectReason,
  ViewerEditResult,
  ViewerObjectEditField,
  ViewerObjectEditOrigin,
  ViewerObjectEditPreview,
  ViewerObjectEditProvenance,
  ViewerObjectEditResult,
  ViewerObjectKind,
  ViewerObstacleGeometry,
  ViewerPlannedEditField,
  ViewerPlannedEditPreview,
  ViewerPlannedEditResult,
  ViewerPlannedGeometry,
  ViewerPlannedKind,
  ViewerWorkSurfaceGeometry,
} from '@/features/viewer3d/editing/editTypes';
export { DEFAULT_LAYERS, VIEWER_LAYER_KEYS, VIEWER_LAYER_MODES } from '@/features/viewer3d/layers';
export type { ViewerLayerKey, ViewerLayerMode, ViewerLayers } from '@/features/viewer3d/layers';
export type { AvatarMeshFetch } from '@/features/viewer3d/people/avatarMesh';
export {
  AVATAR_IDENTITY_HOLD_MS,
  AVATAR_LATE_MS,
  AVATAR_PLAYBACK_DELAY_MS,
  AVATAR_STALL_MS,
} from '@/features/viewer3d/people/avatarMeshPolicy';
export {
  PLANNED_KINDS,
  plannedGeometryProblem,
  readPlannedLayout,
} from '@/features/viewer3d/planned/plannedLayout';
export type {
  PlannedGeometry,
  PlannedKind,
  PlannedLayoutInput,
  PlannedObjectInput,
  PlannedSnapshot,
} from '@/features/viewer3d/planned/plannedLayout';
export {
  DEFAULT_POST_PROCESSING,
  resolvePostProcessing,
} from '@/features/viewer3d/PostProcessingLayer';
export type {
  ResolvedPostProcessing,
  ViewerPostProcessingInput,
  ViewerPostProcessingOptions,
} from '@/features/viewer3d/PostProcessingLayer';
export { parseReplayLog } from '@/features/viewer3d/replay/replayLog';
export type {
  ReplayFile,
  ReplayIssue,
  ReplayIssueReason,
  ReplayLog,
} from '@/features/viewer3d/replay/replayLog';
export { REPLAY_SPEEDS, createReplaySource } from '@/features/viewer3d/replay/replaySource';
export type {
  ReplaySourceOptions,
  ReplaySpatialSource,
  ReplayStatus,
} from '@/features/viewer3d/replay/replaySource';
export {
  SCENE_STATES,
  SURFACE_SOURCE_VALUES,
  readCurrentScene,
  sceneStatusOf,
  verifyScene,
} from '@/features/viewer3d/scene/sceneContract';
export type {
  CurrentScene,
  SceneDisplay,
  SceneReadResult,
  SceneState,
  SceneStatusPhase,
  SceneVerification,
  SceneVersions,
  SurfaceSourceMapUrls,
  ViewerSceneInput,
  ViewerSceneStatus,
} from '@/features/viewer3d/scene/sceneContract';
export {
  applyMapCamerasToVdtCameras,
  applyMapCamerasToVdtConfig,
  buildOpenGlProjectionMatrix,
  convertVdtCameraToThree,
  convertVdtFreeViewToThree,
  convertVdtQuadToThree,
  evaluateCameraWeightCpu,
  parseExperimentVdtDocs,
  readSceneMapCameras,
  readSceneMapCamerasFromObject3D,
  readSceneVdtConfig,
  resolveVdtOutliersAndBlendCpu,
  srgbToOklab,
} from '@/features/viewer3d/scene/vdtMath';
export type {
  SceneMapCamera,
  SceneMapCameras,
  SceneVdtConfig,
  VdtCameraInput,
  VdtCameraThree,
  VdtFloorPlaneInput,
  VdtFreeViewInput,
  VdtMatrix3,
  VdtPoseSource,
  VdtQuadCornersWorld,
  VdtRenderMode,
  VdtVec2,
  VdtVec3,
  VdtWallPlaneInput,
  ViewerVdtOptions,
} from '@/features/viewer3d/scene/vdtTypes';
export {
  OFFICIAL_STATIC_OBJECT_CONTRACT,
  adaptGeometry,
  adaptOfficialStaticObjects,
} from '@/features/viewer3d/surfaces/officialStaticObjects';
export {
  adaptWorkSurfaces,
  geometryProblem,
  obbWorkSurface,
  sameWorkSurface,
  surfaceCorners,
  surfaceTopEdge,
  workSurfaceItem,
  workSurfaceObb,
} from '@/features/viewer3d/surfaces/workSurfaceGeometry';
export type {
  WorkSurfaceContract,
  WorkSurfaceGeometry,
  WorkSurfaceSnapshot,
  WorkSurfaceView,
} from '@/features/viewer3d/surfaces/workSurfaceGeometry';
export { createViewerTestHandle } from '@/features/viewer3d/testing';
export type { ViewerTestCall, ViewerTestHandle } from '@/features/viewer3d/testing';
export type {
  CommandFailureReason,
  CommandResult,
  PersonHelmetState,
  Viewer3DHandle,
  Viewer3DProps,
  ViewerBoxEdit,
  ViewerBoxGhost,
  ViewerError,
  ViewerErrorCode,
  ViewerLabelCell,
  ViewerLabelWatchStatus,
  ViewerMode,
  ViewerPhase,
  ViewerSelectCancelReason,
  ViewerSelectOptions,
  ViewerSelectRequest,
  ViewerSelectRequestStatus,
  ViewerStatus,
  ViewerTarget,
  ViewerTargetType,
} from '@/features/viewer3d/types';
export { Viewer3D } from '@/features/viewer3d/Viewer3D';
export { MAX_SELECT_WAIT_MS } from '@/features/viewer3d/viewer3d.store';
export {
  toWorldPoint,
  toWorldUnitVector,
  worldDirectionToThree,
  worldPoint,
  worldToThree,
  type ThreePoint,
  type WorldPoint,
} from '@/features/viewer3d/worldCoordinates';
export {
  MAX_ZONE_VERTICES,
  OFFICIAL_ZONE_CONTRACT,
  adaptOfficialZones,
  polygonArea,
  readOfficialZone,
  readPolygonXy,
} from '@/features/viewer3d/zones/officialZones';
