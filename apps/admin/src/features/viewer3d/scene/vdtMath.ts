import {
  THREE_TO_WORLD_MATRIX,
  toWorldUnitVector,
  WORLD_TO_THREE_MATRIX,
  worldDirectionToThree,
  worldPoint,
  worldToThree,
} from '@/features/viewer3d/worldCoordinates';
import * as THREE from 'three';
import type {
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
  VdtVec2,
  VdtVec3,
  VdtWallPlaneInput,
} from './vdtTypes';

const POSE_SOURCES = new Set<VdtPoseSource>(['CALIBRATION', 'MA_ALIGNED_SIM3', 'MA_ALIGNED']);
const CAMERA_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function readPoseSource(raw: unknown): VdtPoseSource | null {
  return typeof raw === 'string' && POSE_SOURCES.has(raw as VdtPoseSource)
    ? (raw as VdtPoseSource)
    : null;
}

function matrix3FromRows(rows: VdtMatrix3): THREE.Matrix3 {
  const m = new THREE.Matrix3();
  m.set(
    rows[0][0],
    rows[0][1],
    rows[0][2],
    rows[1][0],
    rows[1][1],
    rows[1][2],
    rows[2][0],
    rows[2][1],
    rows[2][2],
  );
  return m;
}

const THREE_TO_WORLD_MAT3 = matrix3FromRows(THREE_TO_WORLD_MATRIX);
const WORLD_TO_THREE_MAT3 = matrix3FromRows(WORLD_TO_THREE_MATRIX);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPositiveNum(v: unknown): v is number {
  return isFiniteNum(v) && v > 0;
}

function readVec2(raw: unknown): VdtVec2 | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [x, y] = raw;
  if (!isFiniteNum(x) || !isFiniteNum(y)) return null;
  return [x, y];
}

function readVec3(raw: unknown): VdtVec3 | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const [x, y, z] = raw;
  if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(z)) return null;
  return [x, y, z];
}

function readMatrix3(raw: unknown): VdtMatrix3 | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const r0 = readVec3(raw[0]);
  const r1 = readVec3(raw[1]);
  const r2 = readVec3(raw[2]);
  if (!r0 || !r1 || !r2) return null;
  return [r0, r1, r2];
}

function readQuadCorners(raw: unknown): VdtQuadCornersWorld | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const c0 = readVec3(raw[0]);
  const c1 = readVec3(raw[1]);
  const c2 = readVec3(raw[2]);
  const c3 = readVec3(raw[3]);
  if (!c0 || !c1 || !c2 || !c3) return null;
  return [c0, c1, c2, c3];
}

function rowsFromMatrix3(m: THREE.Matrix3): VdtMatrix3 {
  const e = m.elements;
  // Three.js Matrix3.elements 는 열 우선(column-major)
  return [
    [e[0], e[3], e[6]],
    [e[1], e[4], e[7]],
    [e[2], e[5], e[8]],
  ];
}

function readFloorPlane(raw: unknown): VdtFloorPlaneInput | null {
  if (!isRecord(raw)) return null;
  const zWorldM = isFiniteNum(raw.z_world_m)
    ? raw.z_world_m
    : isFiniteNum(raw.zWorldM)
      ? raw.zWorldM
      : -0.015;
  const normalWorld = readVec3(raw.normal_world ?? raw.normalWorld) ?? [0, 0, 1];
  const cornersWorld = readQuadCorners(raw.corners_world ?? raw.cornersWorld);
  if (!cornersWorld) return null;
  const observedMedianSrgb = readVec3(raw.observed_median_srgb ?? raw.observedMedianSrgb) ?? [
    0.41, 0.44, 0.49,
  ];
  const calmIndicatorSrgb = readVec3(raw.calm_indicator_srgb ?? raw.calmIndicatorSrgb) ?? [
    0.36, 0.38, 0.43,
  ];
  return {
    zWorldM,
    normalWorld,
    cornersWorld,
    observedMedianSrgb,
    calmIndicatorSrgb,
  };
}

function readWallPlane(raw: unknown): VdtWallPlaneInput | null {
  if (!isRecord(raw)) return null;
  const wallId =
    typeof raw.wall_id === 'string' && raw.wall_id.length > 0
      ? raw.wall_id
      : typeof raw.wallId === 'string' && raw.wallId.length > 0
        ? raw.wallId
        : null;
  if (!wallId) return null;
  const normalWorld = readVec3(raw.normal_world ?? raw.normalWorld);
  const tWorldXy = readVec2(raw.t_world_xy ?? raw.tWorldXy);
  const cornersWorld = readQuadCorners(raw.corners_world ?? raw.cornersWorld);
  if (!normalWorld || !tWorldXy || !cornersWorld) return null;
  const dWorldM = isFiniteNum(raw.d_world_m)
    ? raw.d_world_m
    : isFiniteNum(raw.dWorldM)
      ? raw.dWorldM
      : 0;
  const dRenderWorldM = isFiniteNum(raw.d_render_world_m)
    ? raw.d_render_world_m
    : isFiniteNum(raw.dRenderWorldM)
      ? raw.dRenderWorldM
      : dWorldM - 0.018;
  const observedMedianSrgb = readVec3(raw.observed_median_srgb ?? raw.observedMedianSrgb) ?? [
    0.6, 0.6, 0.6,
  ];
  const calmIndicatorSrgb = readVec3(raw.calm_indicator_srgb ?? raw.calmIndicatorSrgb) ?? [
    0.5, 0.52, 0.55,
  ];
  return {
    wallId,
    normalWorld,
    tWorldXy,
    dWorldM,
    dRenderWorldM,
    cornersWorld,
    observedMedianSrgb,
    calmIndicatorSrgb,
  };
}

function readCameraInput(raw: unknown, convertFromGlbConvention: boolean): VdtCameraInput | null {
  if (!isRecord(raw)) return null;
  const cameraId =
    typeof raw.camera_id === 'string' && raw.camera_id
      ? raw.camera_id
      : typeof raw.cameraId === 'string' && raw.cameraId
        ? raw.cameraId
        : null;
  const imageUrl =
    typeof raw.image_url === 'string' && raw.image_url
      ? raw.image_url
      : typeof raw.imageUrl === 'string' && raw.imageUrl
        ? raw.imageUrl
        : typeof raw.image === 'string' && raw.image
          ? raw.image
          : null;
  if (!cameraId || !imageUrl) return null;

  const sizeRaw = raw.image_size ?? raw.imageSize;
  if (!Array.isArray(sizeRaw) || sizeRaw.length !== 2) return null;
  const [w, h] = sizeRaw;
  if (!isPositiveNum(w) || !isPositiveNum(h)) return null;

  const K = readMatrix3(raw.K);
  const rawR = readMatrix3(raw.R);
  const t = readVec3(raw.t);
  if (!K || !rawR || !t) return null;
  if (K[0][0] <= 0 || K[1][1] <= 0) return null;

  // 실험 산출물(GLTF_Y_UP 기준 R_glb2cv = R_w2c * G^T)인 경우,
  // worldCoordinates.ts 의 WORLD_TO_THREE_MATRIX(G)를 곱해 정본 World 기준 R_w2c 로 정규화한다.
  const R: VdtMatrix3 = convertFromGlbConvention
    ? rowsFromMatrix3(
        new THREE.Matrix3().multiplyMatrices(matrix3FromRows(rawR), WORLD_TO_THREE_MAT3),
      )
    : rawR;

  const gain = readVec3(raw.color_gain_srgb ?? raw.colorGainSrgb) ?? [1, 1, 1];
  const expRaw = raw.image_expires_at_ms ?? raw.imageExpiresAtMs;
  const imageExpiresAtMs = isFiniteNum(expRaw) ? expRaw : null;
  const poseSource = readPoseSource(raw.pose_source ?? raw.poseSource) ?? 'CALIBRATION';

  return {
    cameraId,
    imageUrl,
    imageExpiresAtMs,
    imageSize: [w, h],
    K,
    R,
    t,
    colorGainSrgb: gain,
    poseSource,
  };
}

function readSceneMapCamera(raw: unknown): SceneMapCamera | null {
  if (!isRecord(raw)) return null;
  const sizeRaw = raw.image_size ?? raw.imageSize;
  if (!Array.isArray(sizeRaw) || sizeRaw.length !== 2) return null;
  const [w, h] = sizeRaw;
  if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0) return null;

  const K = readMatrix3(raw.K);
  const R = readMatrix3(raw.R);
  const t = readVec3(raw.t);
  const poseSource = readPoseSource(raw.pose_source ?? raw.poseSource);
  if (!K || !R || !t || !poseSource) return null;
  if (K[0][0] <= 0 || K[1][1] <= 0) return null;

  return {
    imageSize: [w, h],
    K,
    R,
    t,
    poseSource,
  };
}

/**
 * `GET /api/scenes/current` 의 `map_cameras` (`scene_output.method.map_cameras` 또는 GLB `extras.simai.map_cameras`)를
 * 검증하여 `SceneMapCameras` 로 변환한다. 형식이 맞지 않거나 빈 객체면 `null` 을 반환한다.
 */
export function readSceneMapCameras(raw: unknown): SceneMapCameras | null {
  if (!isRecord(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length === 0) return null;
  const out: Record<string, SceneMapCamera> = {};
  for (const [cameraId, value] of entries) {
    if (!CAMERA_ID_RE.test(cameraId)) return null;
    const parsed = readSceneMapCamera(value);
    if (!parsed) return null;
    out[cameraId] = parsed;
  }
  return out;
}

/**
 * GLB 루트(`Object3D.userData.simai.map_cameras`)에 기록된 맵 카메라 자세 사본을 읽는다.
 * 없거나 형식이 맞지 않으면 `null` 을 반환한다.
 */
export function readSceneMapCamerasFromObject3D(
  root: THREE.Object3D | null | undefined,
): SceneMapCameras | null {
  if (!root || !isRecord(root.userData)) return null;
  const simai = isRecord(root.userData.simai) ? root.userData.simai : null;
  const raw = simai?.map_cameras ?? root.userData.map_cameras;
  if (raw === undefined || raw === null) return null;
  return readSceneMapCameras(raw);
}

/**
 * `map_cameras` 가 주어진 카메라는 맵 베이크에 쓰인 `imageSize, K, R, t, poseSource` 로 교체하고,
 * 없거나 해당 카메라 항목이 없는 레거시 카메라는 기존 calibration 자세(`CALIBRATION`)를 유지한다.
 */
export function applyMapCamerasToVdtCameras(
  cameras: readonly VdtCameraInput[],
  mapCameras?: SceneMapCameras | null,
): VdtCameraInput[] {
  return cameras.map((cam) => {
    const mc = mapCameras?.[cam.cameraId];
    if (!mc) {
      return cam.poseSource ? cam : { ...cam, poseSource: 'CALIBRATION' };
    }
    return {
      ...cam,
      imageSize: mc.imageSize,
      K: mc.K,
      R: mc.R,
      t: mc.t,
      poseSource: mc.poseSource,
    };
  });
}

/**
 * `SceneVdtConfig` 에 `map_cameras` 를 적용하여 각 카메라 자세를 오버라이드한 사본을 반환한다.
 */
export function applyMapCamerasToVdtConfig(
  vdtConfig: SceneVdtConfig,
  mapCameras?: SceneMapCameras | null,
): SceneVdtConfig {
  const effectiveMapCameras =
    mapCameras && Object.keys(mapCameras).length > 0 ? mapCameras : vdtConfig.mapCameras;
  return {
    ...vdtConfig,
    cameras: applyMapCamerasToVdtCameras(vdtConfig.cameras, effectiveMapCameras),
    ...(effectiveMapCameras ? { mapCameras: effectiveMapCameras } : {}),
  };
}

/** VDT 셰이더가 받는 최대 카메라 수. */
const VDT_MAX_CAMERAS = 4;

/**
 * 카메라별 사진 주소(사람 지운 배경 등, -590)를 VDT 설정에 끼운다.
 * - 장면 `vdt` 가 있으면 같은 카메라의 `imageUrl` 만 바꾼다(주소가 없는 카메라는 그대로).
 * - 없으면 `map_cameras` 자세와 주소가 둘 다 있는 카메라(ID 순, 최대 4대)로 최소 설정을 만든다(표시 층 없음).
 * 주소가 비었거나 만들 카메라가 없으면 `base` 그대로(없으면 null)다. 사진을 지어내지 않는다.
 */
export function withVdtCameraImages(
  base: SceneVdtConfig | null,
  mapCameras: SceneMapCameras | null | undefined,
  imageUrls: Readonly<Record<string, string>> | null | undefined,
): SceneVdtConfig | null {
  const urlOf = (cameraId: string): string | null => {
    const url = imageUrls?.[cameraId];
    return typeof url === 'string' && url.length > 0 ? url : null;
  };
  if (!imageUrls || Object.keys(imageUrls).length === 0) return base;
  if (base) {
    let changed = false;
    const cameras = base.cameras.map((cam) => {
      const url = urlOf(cam.cameraId);
      if (!url || url === cam.imageUrl) return cam;
      changed = true;
      return { ...cam, imageUrl: url, imageExpiresAtMs: null };
    });
    return changed ? { ...base, cameras } : base;
  }
  if (!mapCameras) return null;
  const cameras: VdtCameraInput[] = [];
  for (const cameraId of Object.keys(mapCameras).sort()) {
    const mc = mapCameras[cameraId];
    const url = urlOf(cameraId);
    if (!mc || !url) continue;
    cameras.push({
      cameraId,
      imageUrl: url,
      imageSize: mc.imageSize,
      K: mc.K,
      R: mc.R,
      t: mc.t,
      poseSource: mc.poseSource,
    });
    if (cameras.length === VDT_MAX_CAMERAS) break;
  }
  if (cameras.length === 0) return null;
  return {
    formatVersion: 'camera-images',
    colorSigmaOklab: 0.056,
    nearM: 0.1,
    farM: 25.0,
    cameras,
    floorPlane: null,
    wallPlanes: [],
    mapCameras,
  };
}

/**
 * `GET /api/scenes/current` 의 선택 필드 `vdt` (또는 실험 메타)를 검증하여 `SceneVdtConfig` 로 변환한다.
 * 형식이 맞지 않거나 필수 필드가 누락되면 `null` 을 반환한다.
 */
export function readSceneVdtConfig(raw: unknown): SceneVdtConfig | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.cameras) || raw.cameras.length === 0) return null;

  const axisConv = typeof raw.axis_convention === 'string' ? raw.axis_convention : '';
  const coordConv = typeof raw.coordinate_convention === 'string' ? raw.coordinate_convention : '';
  const coordSys = typeof raw.coordinate_system === 'string' ? raw.coordinate_system : 'WORLD';
  const convertFromGlb =
    axisConv.startsWith('GLTF_Y_UP') ||
    coordConv.startsWith('GLTF_Y_UP') ||
    coordSys === 'GLTF_Y_UP';

  const cameras: VdtCameraInput[] = [];
  for (const item of raw.cameras) {
    const parsed = readCameraInput(item, convertFromGlb);
    if (!parsed) return null;
    cameras.push(parsed);
  }

  let colorSigmaOklab = 0.056;
  const sigmaRaw = raw.color_sigma_oklab ?? raw.colorSigmaOklab;
  if (isFiniteNum(sigmaRaw) && sigmaRaw > 0) {
    colorSigmaOklab = sigmaRaw;
  }

  const nearRaw = raw.near_m ?? raw.nearM;
  const farRaw = raw.far_m ?? raw.farM;
  const nearM = isPositiveNum(nearRaw) ? nearRaw : 0.1;
  const farM = isPositiveNum(farRaw) ? farRaw : 25.0;

  const floorRaw = raw.floor_plane ?? raw.floorPlane;
  const floorPlane = floorRaw ? readFloorPlane(floorRaw) : null;
  const wallPlanes: VdtWallPlaneInput[] = [];
  const wallsRaw = raw.wall_planes ?? raw.wallPlanes;
  if (Array.isArray(wallsRaw)) {
    for (const wp of wallsRaw) {
      const parsedWp = readWallPlane(wp);
      if (parsedWp) wallPlanes.push(parsedWp);
    }
  }

  const freeViews: Record<string, VdtFreeViewInput> = {};
  const freeRaw = raw.free_views ?? raw.freeViews;
  if (isRecord(freeRaw)) {
    for (const [k, v] of Object.entries(freeRaw)) {
      if (!isRecord(v)) continue;
      const posW = readVec3(v.position_world ?? v.positionWorld);
      const tgtW = readVec3(v.target_world ?? v.targetWorld);
      const hfovRaw = v.hfov_deg ?? v.hfovDeg;
      const hfovDeg = isPositiveNum(hfovRaw) ? hfovRaw : 75;
      if (posW && tgtW) {
        freeViews[k] = { name: k, positionWorld: posW, targetWorld: tgtW, hfovDeg };
      }
    }
  }

  const fmtVer = raw.format_version ?? raw.formatVersion;
  let mapCameras: SceneMapCameras | undefined;
  const rawMapCameras = raw.map_cameras ?? raw.mapCameras;
  if (rawMapCameras !== undefined && rawMapCameras !== null) {
    const parsedMapCameras = readSceneMapCameras(rawMapCameras);
    if (!parsedMapCameras) return null;
    mapCameras = parsedMapCameras;
  }

  return {
    formatVersion: typeof fmtVer === 'string' ? fmtVer : '1.0.0',
    colorSigmaOklab,
    nearM,
    farM,
    cameras: applyMapCamerasToVdtCameras(cameras, mapCameras),
    floorPlane,
    wallPlanes,
    freeViews: Object.keys(freeViews).length > 0 ? freeViews : undefined,
    ...(mapCameras ? { mapCameras } : {}),
  };
}

/**
 * -527 실험 산출물(`cameras.json` + `walls.json`)을 정본 World 좌표계 기반 `SceneVdtConfig` 로 합친다.
 */
export function parseExperimentVdtDocs(
  camerasDoc: unknown,
  wallsDoc: unknown,
  assetBaseUrl: string,
): SceneVdtConfig | null {
  if (!isRecord(camerasDoc) || !Array.isArray(camerasDoc.cameras)) return null;
  const prefix = assetBaseUrl.replace(/\/+$/, '');
  const patchedCameras = camerasDoc.cameras.map((c) => {
    if (!isRecord(c)) return c;
    const relImg = typeof c.image === 'string' ? c.image.replace(/^\/+/, '') : '';
    return {
      ...c,
      image_url:
        typeof c.image_url === 'string' ? c.image_url : relImg ? `${prefix}/${relImg}` : '',
    };
  });

  const firstCam = isRecord(camerasDoc.cameras[0]) ? camerasDoc.cameras[0] : null;
  const merged: Record<string, unknown> = {
    ...camerasDoc,
    cameras: patchedCameras,
    near_m: firstCam && isPositiveNum(firstCam.near) ? firstCam.near : 0.1,
    far_m: firstCam && isPositiveNum(firstCam.far) ? firstCam.far : 25.0,
    floor_plane: isRecord(wallsDoc) ? wallsDoc.floor_plane : null,
    wall_planes: isRecord(wallsDoc) ? wallsDoc.wall_planes : [],
  };
  return readSceneVdtConfig(merged);
}

/**
 * OpenCV 핀홀 내부 행렬 K 와 이미지 크기 (width, height) 로부터 OpenGL/Three.js 4x4 투영 행렬을 생성한다.
 */
export function buildOpenGlProjectionMatrix(
  K: VdtMatrix3,
  width: number,
  height: number,
  near = 0.1,
  far = 25.0,
): THREE.Matrix4 {
  const fx = K[0][0];
  const fy = K[1][1];
  const cx = K[0][2];
  const cy = K[1][2];

  const m = new THREE.Matrix4();
  m.set(
    (2.0 * fx) / width,
    0,
    1.0 - (2.0 * cx) / width,
    0,
    0,
    (2.0 * fy) / height,
    (2.0 * cy) / height - 1.0,
    0,
    0,
    0,
    -(far + near) / (far - near),
    -(2.0 * far * near) / (far - near),
    0,
    0,
    -1.0,
    0,
  );
  return m;
}

function worldCoordsToThreeVector(x: number, y: number, z: number): THREE.Vector3 {
  const [tx, ty, tz] = worldToThree(worldPoint(x, y, z));
  return new THREE.Vector3(tx, ty, tz);
}

function worldDirToThreeVector(dx: number, dy: number, dz: number): THREE.Vector3 {
  const unit = toWorldUnitVector([dx, dy, dz]) ?? worldPoint(dx, dy, dz);
  const [tx, ty, tz] = worldDirectionToThree(unit);
  return new THREE.Vector3(tx, ty, tz).normalize();
}

/**
 * 정본 World 좌표계 카메라 입력(`VdtCameraInput`)을 `worldCoordinates.ts` 만 거쳐
 * Three.js 공간(`GLTF_Y_UP`) 행렬과 벡터로 변환한다 (AGENTS 규칙 3).
 */
export function convertVdtCameraToThree(
  cam: VdtCameraInput,
  nearM = 0.1,
  farM = 25.0,
): VdtCameraThree {
  const rWorldToCv = matrix3FromRows(cam.R);
  // P_world = THREE_TO_WORLD_3x3 * P_three 이므로:
  // p_cv = R_w2c * P_world + t_w2c = (R_w2c * THREE_TO_WORLD_3x3) * P_three + t_w2c
  const rThreeToCv = new THREE.Matrix3().multiplyMatrices(rWorldToCv, THREE_TO_WORLD_MAT3);
  const tThreeToCv = new THREE.Vector3(cam.t[0], cam.t[1], cam.t[2]);

  // 카메라 광학 중심 C_world = -R_w2c^T * t_w2c
  const R = cam.R;
  const [tx, ty, tz] = cam.t;
  const cxWorld = -(R[0][0] * tx + R[1][0] * ty + R[2][0] * tz);
  const cyWorld = -(R[0][1] * tx + R[1][1] * ty + R[2][1] * tz);
  const czWorld = -(R[0][2] * tx + R[1][2] * ty + R[2][2] * tz);
  const positionWorld: VdtVec3 = [cxWorld, cyWorld, czWorld];
  const positionThree = worldCoordsToThreeVector(cxWorld, cyWorld, czWorld);

  // 카메라 기준 축 방향 벡터 (World -> Three.js)
  const rightThree = worldDirToThreeVector(R[0][0], R[0][1], R[0][2]);
  const upThree = worldDirToThreeVector(-R[1][0], -R[1][1], -R[1][2]);
  const forwardThree = worldDirToThreeVector(R[2][0], R[2][1], R[2][2]);

  // OpenGL/Three.js 카메라 공간은 OpenCV 카메라 공간에서 Y, Z 부호를 뒤집은 S = diag(1, -1, -1)
  const rRows = rowsFromMatrix3(rThreeToCv);
  const threeViewMatrix = new THREE.Matrix4().set(
    rRows[0][0],
    rRows[0][1],
    rRows[0][2],
    tx,
    -rRows[1][0],
    -rRows[1][1],
    -rRows[1][2],
    -ty,
    -rRows[2][0],
    -rRows[2][1],
    -rRows[2][2],
    -tz,
    0,
    0,
    0,
    1,
  );
  const threeMatrixWorld = threeViewMatrix.clone().invert();

  const [w, h] = cam.imageSize;
  const threeProjectionMatrix = buildOpenGlProjectionMatrix(cam.K, w, h, nearM, farM);
  const fy = cam.K[1][1];
  const vfovDeg = THREE.MathUtils.radToDeg(2.0 * Math.atan((h * 0.5) / fy));

  const normalizedIntrinsics = new THREE.Vector4(
    cam.K[0][0] / w,
    cam.K[1][1] / h,
    cam.K[0][2] / w,
    cam.K[1][2] / h,
  );

  const gain = cam.colorGainSrgb ?? [1, 1, 1];
  const colorGainSrgb = new THREE.Vector3(gain[0], gain[1], gain[2]);

  return {
    cameraId: cam.cameraId,
    imageUrl: cam.imageUrl,
    imageSize: cam.imageSize,
    rThreeToCv,
    tThreeToCv,
    normalizedIntrinsics,
    positionWorld,
    positionThree,
    forwardThree,
    upThree,
    rightThree,
    threeViewMatrix,
    threeMatrixWorld,
    threeProjectionMatrix,
    vfovDeg,
    colorGainSrgb,
    poseSource: cam.poseSource ?? 'CALIBRATION',
  };
}

/**
 * 정본 World 좌표계의 사각형 꼭짓점 4개와 법선을 `worldCoordinates.ts` 를 통해 Three.js 공간으로 변환한다.
 */
export function convertVdtQuadToThree(
  cornersWorld: VdtQuadCornersWorld,
  normalWorld: VdtVec3,
): {
  cornersThree: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  normalThree: THREE.Vector3;
} {
  const c0 = worldCoordsToThreeVector(cornersWorld[0][0], cornersWorld[0][1], cornersWorld[0][2]);
  const c1 = worldCoordsToThreeVector(cornersWorld[1][0], cornersWorld[1][1], cornersWorld[1][2]);
  const c2 = worldCoordsToThreeVector(cornersWorld[2][0], cornersWorld[2][1], cornersWorld[2][2]);
  const c3 = worldCoordsToThreeVector(cornersWorld[3][0], cornersWorld[3][1], cornersWorld[3][2]);
  const normalThree = worldDirToThreeVector(normalWorld[0], normalWorld[1], normalWorld[2]);
  return { cornersThree: [c0, c1, c2, c3], normalThree };
}

/**
 * 정본 World 좌표계 기준 자유 시점(`VdtFreeViewInput`)을 `worldCoordinates.ts` 를 통해 Three.js 카메라 포즈로 변환한다.
 */
export function convertVdtFreeViewToThree(
  view: VdtFreeViewInput,
  aspect = 16 / 9,
): {
  positionThree: THREE.Vector3;
  targetThree: THREE.Vector3;
  upThree: THREE.Vector3;
  vfovDeg: number;
} {
  const positionThree = worldCoordsToThreeVector(
    view.positionWorld[0],
    view.positionWorld[1],
    view.positionWorld[2],
  );
  const targetThree = worldCoordsToThreeVector(
    view.targetWorld[0],
    view.targetWorld[1],
    view.targetWorld[2],
  );
  const fwd = targetThree.clone().sub(positionThree).normalize();
  // 시선이 Three.js Y축(World Z축)에 거의 평행한 top 시점은 World +Y (Three -Z)를 up 벡터로 사용
  const upThree =
    Math.abs(fwd.y) > 0.95 ? worldDirToThreeVector(0, 1, 0) : worldDirToThreeVector(0, 0, 1);
  const hfovRad = THREE.MathUtils.degToRad(view.hfovDeg);
  const vfovDeg = THREE.MathUtils.radToDeg(2.0 * Math.atan(Math.tan(hfovRad * 0.5) / aspect));
  return { positionThree, targetThree, upThree, vfovDeg };
}

// ---------------------------------------------------------------------------
// 순수 CPU 참조 함수 (셰이더 내 가중치 계산 및 4차 카메라 간 외톨이 제거와 1:1 대응)
// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(edge1 - edge0, 1e-9), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

function srgbChannelToLinear(c: number): number {
  const v = clamp(c, 0.0, 1.0);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function srgbToOklab(srgb: VdtVec3): [number, number, number] {
  const r = srgbChannelToLinear(srgb[0]);
  const g = srgbChannelToLinear(srgb[1]);
  const b = srgbChannelToLinear(srgb[2]);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(Math.max(l, 0.0));
  const m_ = Math.cbrt(Math.max(m, 0.0));
  const s_ = Math.cbrt(Math.max(s, 0.0));

  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function vec3Dist(a: VdtVec3, b: VdtVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export interface EvaluateCameraWeightParams {
  cam: VdtCameraThree;
  /** Three.js 공간 투영 대상 위치 P */
  pointThree: VdtVec3;
  /** Three.js 공간 표면 단위법선 N */
  normalThree: VdtVec3;
  /** Three.js 공간 표면 -> 뷰어 카메라 시선 단위벡터 */
  viewDirThree: VdtVec3;
  /** 5-tap 깊이 그림자 맵 샘플값 (m): [center, +dx, -dx, +dy, -dy] */
  shadowDepths5TapM: readonly [number, number, number, number, number];
  hasBaseMap: boolean;
  isIndicatorPlane: boolean;
  indicatorKind?: 0 | 1;
  indicatorDepthMatch?: boolean;
  unobsDepthMatch?: boolean;
  farM?: number;
}

export interface EvaluateCameraWeightResult {
  weight: number;
  geomW: number;
  wView: number;
  uv: [number, number];
  zCv: number;
}

/**
 * 셰이더의 `evaluateCameraWeight` 와 동일한 순수 함수.
 */
export function evaluateCameraWeightCpu(
  params: EvaluateCameraWeightParams,
): EvaluateCameraWeightResult {
  const {
    cam,
    pointThree: P,
    normalThree: N,
    viewDirThree: viewDir,
    shadowDepths5TapM,
    hasBaseMap,
    isIndicatorPlane,
    indicatorKind = 0,
    indicatorDepthMatch = true,
    unobsDepthMatch = true,
    farM = 25.0,
  } = params;

  const pVec = new THREE.Vector3(P[0], P[1], P[2]).applyMatrix3(cam.rThreeToCv).add(cam.tThreeToCv);
  const zCv = pVec.z;
  if (zCv <= 0.2 || zCv >= farM - 0.5) {
    return { weight: 0, geomW: 0, wView: 0, uv: [0, 0], zCv };
  }

  const intr = cam.normalizedIntrinsics;
  const uImg = intr.x * (pVec.x / zCv) + intr.z;
  const vImg = intr.y * (pVec.y / zCv) + intr.w;

  const margin = 0.005;
  if (uImg <= margin || uImg >= 1.0 - margin || vImg <= margin || vImg >= 1.0 - margin) {
    return { weight: 0, geomW: 0, wView: 0, uv: [0, 0], zCv };
  }

  const uv: [number, number] = [uImg, 1.0 - vImg];

  let effNx = N[0];
  let effNy = N[1];
  let effNz = N[2];
  const isFloor =
    P[1] < 0.18 ||
    (P[1] < 0.3 && Math.abs(N[1]) > 0.4) ||
    (isIndicatorPlane && indicatorKind === 0);

  if (isFloor) {
    const sign = effNy < 0 ? -1 : 1;
    const upNx = effNx * sign;
    const upNy = effNy * sign;
    const upNz = effNz * sign;
    const mx = upNx * 0.08;
    const my = upNy * 0.08 + 0.92;
    const mz = upNz * 0.08;
    const len = Math.hypot(mx, my, mz) || 1.0;
    effNx = mx / len;
    effNy = my / len;
    effNz = mz / len;
  }

  const toCamX = cam.positionThree.x - P[0];
  const toCamY = cam.positionThree.y - P[1];
  const toCamZ = cam.positionThree.z - P[2];
  const dist = Math.hypot(toCamX, toCamY, toCamZ);
  if (dist <= 1e-6) {
    return { weight: 0, geomW: 0, wView: 0, uv, zCv };
  }
  const tcX = toCamX / dist;
  const tcY = toCamY / dist;
  const tcZ = toCamZ / dist;

  const cosNorm = effNx * tcX + effNy * tcY + effNz * tcZ;
  const minCosNorm = isFloor ? 0.08 : hasBaseMap || isIndicatorPlane ? 0.15 : 0.45;
  if (cosNorm <= minCosNorm) {
    return { weight: 0, geomW: 0, wView: 0, uv, zCv };
  }
  const wNorm = smoothstep(minCosNorm, minCosNorm + 0.2, cosNorm) * Math.pow(cosNorm, 1.3);

  const [d0, d1, d2, d3, d4] = shadowDepths5TapM;
  const minSignedDiff = Math.min(zCv - d0, zCv - d1, zCv - d2, zCv - d3, zCv - d4);
  const dMin = Math.min(d0, d1, d2, d3, d4);

  let wDepth: number;
  const useStrict5cmGate =
    (isIndicatorPlane && indicatorDepthMatch) ||
    (!isIndicatorPlane && !hasBaseMap && unobsDepthMatch);

  if (useStrict5cmGate) {
    const tol = 0.05;
    const hasMapGeom =
      d0 < farM - 0.5 && d1 < farM - 0.5 && d2 < farM - 0.5 && d3 < farM - 0.5 && d4 < farM - 0.5;
    const centerAbsDiff = Math.abs(zCv - d0);
    const neighborTol = !isIndicatorPlane && isFloor ? 0.09 : tol;
    const maxNeighborDiff = Math.max(
      Math.abs(zCv - d1),
      Math.abs(zCv - d2),
      Math.abs(zCv - d3),
      Math.abs(zCv - d4),
    );
    if (!hasMapGeom || centerAbsDiff > tol || maxNeighborDiff > neighborTol) {
      return { weight: 0, geomW: 0, wView: 0, uv, zCv };
    }
    wDepth = 1.0 - smoothstep(tol * 0.5, tol, centerAbsDiff);
  } else {
    const slopeScale = 1.0 / Math.max(cosNorm, 0.2);
    const tolOccl = isIndicatorPlane
      ? isFloor
        ? Math.max(0.45, 0.065 * zCv * slopeScale)
        : Math.max(0.22, 0.04 * zCv * slopeScale)
      : isFloor
        ? Math.max(0.25, 0.045 * zCv * slopeScale)
        : hasBaseMap
          ? Math.max(0.085, 0.024 * zCv * slopeScale)
          : Math.max(0.045, 0.012 * zCv * slopeScale);
    if (minSignedDiff > tolOccl) {
      return { weight: 0, geomW: 0, wView: 0, uv, zCv };
    }

    const tolCliff = isIndicatorPlane
      ? isFloor
        ? Math.max(0.55, 0.08 * zCv * slopeScale)
        : Math.max(0.32, 0.055 * zCv * slopeScale)
      : isFloor
        ? Math.max(0.36, 0.062 * zCv * slopeScale)
        : Math.max(0.2, 0.045 * zCv * slopeScale);
    const cliffDiff = zCv - dMin;
    if (cliffDiff > tolCliff) {
      return { weight: 0, geomW: 0, wView: 0, uv, zCv };
    }

    wDepth =
      (1.0 - smoothstep(tolOccl * 0.55, tolOccl, Math.max(0.0, minSignedDiff))) *
      (1.0 - smoothstep(tolCliff * 0.65, tolCliff, Math.max(0.0, cliffDiff)));
  }

  const edgeDist = Math.min(uImg, 1.0 - uImg, vImg, 1.0 - vImg);
  const wBorder = smoothstep(margin, 0.09, edgeDist);

  const cosAngle = clamp(viewDir[0] * tcX + viewDir[1] * tcY + viewDir[2] * tcZ, -1.0, 1.0);
  const wView = Math.exp(8.5 * (cosAngle - 1.0)) / Math.max(1.0 - cosAngle, 0.001) + 0.005;
  const wDist = 1.0 / (1.0 + 0.05 * dist * dist);

  const geomW = wDepth * wNorm * wBorder * wDist;
  const weight = geomW * wView;
  return { weight, geomW, wView, uv, zCv };
}

export interface CandidateCameraSample {
  weight: number;
  geomW: number;
  wView: number;
  colorSrgb: VdtVec3;
  gainSrgb?: VdtVec3;
}

export interface ResolveVdtOutliersParams {
  candidates: readonly [
    CandidateCameraSample,
    CandidateCameraSample,
    CandidateCameraSample,
    CandidateCameraSample,
  ];
  rawOrigColorSrgb: VdtVec3;
  floorObsColorSrgb: VdtVec3;
  isFloorTarget: boolean;
  hasBaseMap: boolean;
  isIndicatorPlane?: boolean;
  outlierRemoval?: boolean;
  colorSigma?: number;
  topK?: 2 | 3;
}

export interface ResolveVdtOutliersResult {
  normalizedWeights: [number, number, number, number];
  survivingWeights: [number, number, number, number];
  blendedColorSrgb: [number, number, number];
  finalColorSrgb: [number, number, number];
  confidence: number;
}

/**
 * 셰이더의 4차 지시 카메라 간 사진 일치(Oklab 메도이드 외톨이 제거) 및 상위 K대 블렌딩과 동일한 순수 함수.
 */
export function resolveVdtOutliersAndBlendCpu(
  params: ResolveVdtOutliersParams,
): ResolveVdtOutliersResult {
  const {
    candidates,
    rawOrigColorSrgb,
    floorObsColorSrgb,
    isFloorTarget,
    hasBaseMap,
    isIndicatorPlane = false,
    outlierRemoval = true,
    colorSigma = 0.056,
    topK = 3,
  } = params;

  const w: [number, number, number, number] = [
    candidates[0].weight,
    candidates[1].weight,
    candidates[2].weight,
    candidates[3].weight,
  ];
  const geomW: [number, number, number, number] = [
    candidates[0].geomW,
    candidates[1].geomW,
    candidates[2].geomW,
    candidates[3].geomW,
  ];
  const wView: [number, number, number, number] = [
    candidates[0].wView,
    candidates[1].wView,
    candidates[2].wView,
    candidates[3].wView,
  ];
  const valid: [boolean, boolean, boolean, boolean] = [
    geomW[0] > 0.005,
    geomW[1] > 0.005,
    geomW[2] > 0.005,
    geomW[3] > 0.005,
  ];

  for (let i = 0; i < 4; i++) {
    if (!valid[i]) {
      w[i] = 0;
      geomW[i] = 0;
      wView[i] = 0;
    }
  }

  const rawSw0 = Math.max(w[0], w[1], w[2], w[3]);
  let maxSurvivingA = 1.0;
  let origColor: [number, number, number] = [
    rawOrigColorSrgb[0],
    rawOrigColorSrgb[1],
    rawOrigColorSrgb[2],
  ];

  if (outlierRemoval) {
    const nCand = (valid[0] ? 1 : 0) + (valid[1] ? 1 : 0) + (valid[2] ? 1 : 0) + (valid[3] ? 1 : 0);
    const labs: [VdtVec3, VdtVec3, VdtVec3, VdtVec3] = [
      valid[0] ? srgbToOklab(candidates[0].colorSrgb) : [0, 0, 0],
      valid[1] ? srgbToOklab(candidates[1].colorSrgb) : [0, 0, 0],
      valid[2] ? srgbToOklab(candidates[2].colorSrgb) : [0, 0, 0],
      valid[3] ? srgbToOklab(candidates[3].colorSrgb) : [0, 0, 0],
    ];

    const floorObsLab = srgbToOklab(floorObsColorSrgb);
    const bakedLab = srgbToOklab(rawOrigColorSrgb);
    let thirdVoteLab: VdtVec3 = hasBaseMap ? bakedLab : floorObsLab;

    if (isFloorTarget && !isIndicatorPlane && hasBaseMap) {
      const maxCandL = Math.max(
        valid[0] ? labs[0][0] : 0,
        valid[1] ? labs[1][0] : 0,
        valid[2] ? labs[2][0] : 0,
        valid[3] ? labs[3][0] : 0,
      );
      const darkContam =
        smoothstep(0.03, 0.07, floorObsLab[0] - bakedLab[0]) *
        smoothstep(0.025, 0.065, maxCandL - bakedLab[0]);
      const tMix = darkContam * 0.9;
      thirdVoteLab = [
        bakedLab[0] * (1 - tMix) + floorObsLab[0] * tMix,
        bakedLab[1] * (1 - tMix) + floorObsLab[1] * tMix,
        bakedLab[2] * (1 - tMix) + floorObsLab[2] * tMix,
      ];
    }

    const sigmaEff = isFloorTarget ? colorSigma : colorSigma * 2.25;
    const db = [
      valid[0] ? vec3Dist(labs[0], thirdVoteLab) : 0,
      valid[1] ? vec3Dist(labs[1], thirdVoteLab) : 0,
      valid[2] ? vec3Dist(labs[2], thirdVoteLab) : 0,
      valid[3] ? vec3Dist(labs[3], thirdVoteLab) : 0,
    ];

    if (nCand >= 3 || nCand === 2) {
      const d = (i: number, j: number) => (valid[i] && valid[j] ? vec3Dist(labs[i], labs[j]) : 0);
      const tieW = nCand >= 3 ? (isFloorTarget ? 0.65 : 0.1) : 1.0;

      let bestSum = 999.0;
      let refLab: VdtVec3 = labs[0];
      for (let i = 0; i < 4; i++) {
        if (!valid[i]) continue;
        const domBias = nCand === 2 && !isFloorTarget && w[i] >= rawSw0 * 0.99 ? -0.15 : 0.0;
        const sumI = d(i, 0) + d(i, 1) + d(i, 2) + d(i, 3) + tieW * db[i]! + domBias;
        if (sumI < bestSum) {
          bestSum = sumI;
          refLab = labs[i]!;
        }
      }

      for (let i = 0; i < 4; i++) {
        if (!valid[i]) continue;
        const dn = vec3Dist(labs[i]!, refLab) / sigmaEff;
        const g = isFloorTarget ? 1.0 - smoothstep(1.05, 1.55, dn) : 1.0 - smoothstep(1.8, 2.8, dn);
        const a = Math.exp(-dn * dn) * g * g;
        w[i] = isFloorTarget
          ? geomW[i]! * (0.25 * (1 - a) + (wView[i]! + 0.25) * a) * a
          : w[i]! * a;
      }
      maxSurvivingA = 1.0;
    } else if (nCand === 1 && hasBaseMap && !isIndicatorPlane && isFloorTarget) {
      maxSurvivingA = 0.0;
      const singleSigma = colorSigma * 1.2;
      for (let i = 0; i < 4; i++) {
        if (!valid[i]) continue;
        const gain = candidates[i]!.gainSrgb ?? [1, 1, 1];
        const corrRaw: VdtVec3 = [
          clamp(rawOrigColorSrgb[0] * gain[0], 0, 1),
          clamp(rawOrigColorSrgb[1] * gain[1], 0, 1),
          clamp(rawOrigColorSrgb[2] * gain[2], 0, 1),
        ];
        const refI = srgbToOklab(corrRaw);
        const darkW = smoothstep(0.03, 0.075, floorObsLab[0] - refI[0]) * 0.88;
        const trimmedRef: VdtVec3 = [
          refI[0] * (1 - darkW) + floorObsLab[0] * darkW,
          refI[1] * (1 - darkW) + floorObsLab[1] * darkW,
          refI[2] * (1 - darkW) + floorObsLab[2] * darkW,
        ];
        const dn = vec3Dist(labs[i]!, trimmedRef) / singleSigma;
        const a = Math.exp(-dn * dn) * (1.0 - smoothstep(1.25, 1.85, dn));
        w[i] = w[i]! * a;
        maxSurvivingA = a;
        if (maxSurvivingA < 0.99) {
          const lumB = 0.2126 * corrRaw[0] + 0.7152 * corrRaw[1] + 0.0722 * corrRaw[2];
          const darkB = (1.0 - smoothstep(0.18, 0.36, lumB)) * 0.88;
          origColor = [
            corrRaw[0] * (1 - darkB) + floorObsColorSrgb[0] * 0.88 * darkB,
            corrRaw[1] * (1 - darkB) + floorObsColorSrgb[1] * 0.88 * darkB,
            corrRaw[2] * (1 - darkB) + floorObsColorSrgb[2] * 0.88 * darkB,
          ];
        }
      }
    }
  }

  const sorted = [...w].sort((a, b) => b - a);
  const sw0 = sorted[0]!;
  const kThreshold = topK <= 2 ? sorted[2]! : sorted[3]!;
  const threshold = Math.max(kThreshold, sw0 * 0.14);

  let tw0 = Math.max(0, w[0] - threshold);
  let tw1 = Math.max(0, w[1] - threshold);
  let tw2 = Math.max(0, w[2] - threshold);
  let tw3 = Math.max(0, w[3] - threshold);
  let sumW = tw0 + tw1 + tw2 + tw3;

  if (sumW <= 1e-6) {
    tw0 = w[0];
    tw1 = w[1];
    tw2 = w[2];
    tw3 = w[3];
    sumW = tw0 + tw1 + tw2 + tw3;
  }

  if (sumW <= 1e-6) {
    return {
      normalizedWeights: [0, 0, 0, 0],
      survivingWeights: w,
      blendedColorSrgb: origColor,
      finalColorSrgb: origColor,
      confidence: 0,
    };
  }

  const nw: [number, number, number, number] = [tw0 / sumW, tw1 / sumW, tw2 / sumW, tw3 / sumW];
  const c0 = candidates[0].colorSrgb;
  const c1 = candidates[1].colorSrgb;
  const c2 = candidates[2].colorSrgb;
  const c3 = candidates[3].colorSrgb;

  const vdtColor: [number, number, number] = [
    nw[0] * c0[0] + nw[1] * c1[0] + nw[2] * c2[0] + nw[3] * c3[0],
    nw[0] * c0[1] + nw[1] * c1[1] + nw[2] * c2[1] + nw[3] * c3[1],
    nw[0] * c0[2] + nw[1] * c1[2] + nw[2] * c2[2] + nw[3] * c3[2],
  ];

  const rawConfidence = clamp(rawSw0 * 25.0, 0.0, 1.0);
  const confidence =
    outlierRemoval && !isIndicatorPlane
      ? rawConfidence * clamp(maxSurvivingA * 2.0, 0.0, 1.0)
      : clamp(sw0 * 25.0, 0.0, 1.0);

  const finalColorSrgb: [number, number, number] = [
    origColor[0] * (1 - confidence) + vdtColor[0] * confidence,
    origColor[1] * (1 - confidence) + vdtColor[1] * confidence,
    origColor[2] * (1 - confidence) + vdtColor[2] * confidence,
  ];

  return {
    normalizedWeights: nw,
    survivingWeights: w,
    blendedColorSrgb: vdtColor,
    finalColorSrgb,
    confidence,
  };
}
