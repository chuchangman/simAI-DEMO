import { createSpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import { scenarioWorld } from '@/features/viewer3d/dev-harness/scenarios';
import { prepareSceneRoot, SceneBackground } from '@/features/viewer3d/scene/SceneBackground';
import { readCurrentScene, type ViewerSceneInput } from '@/features/viewer3d/scene/sceneContract';
import {
  createSceneStore,
  DEFAULT_VDT_OPTIONS,
  SceneLoaderContext,
  SceneStoreContext,
  SceneVdtTextureLoaderContext,
  type SceneAssetLoader,
  type SceneVdtTextureLoader,
} from '@/features/viewer3d/scene/sceneStore';
import {
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
import {
  bakeVdtShadowMaps,
  collectVdtMeshes,
  computeOpenBoundaryDistances,
  computeWeldedSmoothNormals,
  mountVdtOnSceneRoot,
} from '@/features/viewer3d/scene/vdtShader';
import type { VdtCameraInput, VdtMatrix3, VdtVec3 } from '@/features/viewer3d/scene/vdtTypes';
import { createViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { worldPoint, worldToThree } from '@/features/viewer3d/worldCoordinates';
import { createRoot, extend } from '@react-three/fiber';
import { act, createElement, StrictMode } from 'react';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

// 12차 보정(cam_A) 정본 World -> OpenCV Camera 회전·이동 및 내부 파라미터 픽스처 (실제 네트워크 연결 없는 .invalid URL)
const CAM_A_WORLD_R: VdtMatrix3 = [
  [-0.68452315, 0.72894132, -0.00851999],
  [0.24497942, 0.24075126, 0.93905586],
  [0.68660553, 0.64087003, -0.3436662],
];
const CAM_A_WORLD_T: VdtVec3 = [-0.30549093, -3.41391754, 1.88346767];
const CAM_A_K: VdtMatrix3 = [
  [1059.354736, 0, 1024],
  [0, 1058.786621, 576],
  [0, 0, 1],
];

const SAMPLE_CAM_A: VdtCameraInput = {
  cameraId: 'cam_A',
  imageUrl: 'https://assets.invalid/vdt/cam_A.jpg',
  imageSize: [2048, 1152],
  K: CAM_A_K,
  R: CAM_A_WORLD_R,
  t: CAM_A_WORLD_T,
  colorGainSrgb: [1.0121, 1.0085, 1.0033],
};

const SAMPLE_VDT_RAW = {
  format_version: '1.0.0',
  coordinate_system: 'WORLD',
  extrinsics_convention: 'OPENCV_WORLD_TO_CAMERA',
  color_sigma_oklab: 0.056,
  near_m: 0.1,
  far_m: 25.0,
  cameras: [
    {
      camera_id: 'cam_A',
      image_url: 'https://assets.invalid/vdt/cam_A.jpg',
      image_size: [2048, 1152],
      K: CAM_A_K,
      R: CAM_A_WORLD_R,
      t: CAM_A_WORLD_T,
      color_gain_srgb: [1.0121, 1.0085, 1.0033],
    },
  ],
  floor_plane: {
    z_world_m: -0.015,
    normal_world: [0, 0, 1],
    corners_world: [
      [0.0882, -0.1757, -0.015],
      [8.2571, -0.1795, -0.015],
      [8.2611, 8.9531, -0.015],
      [0.0683, 8.9569, -0.015],
    ],
    observed_median_srgb: [0.4095, 0.4404, 0.489],
    calm_indicator_srgb: [0.3603, 0.3876, 0.4303],
  },
  wall_planes: [
    {
      wall_id: 'wall_0',
      normal_world: [0.999998, 0.002195, 0.0],
      t_world_xy: [-0.002195, 0.999998],
      d_world_m: 0.0706,
      d_render_world_m: 0.0526,
      corners_world: [
        [0.0522, 0.1948, -0.015],
        [0.0329, 8.9531, -0.015],
        [0.0329, 8.9531, 2.785],
        [0.0522, 0.1948, 2.785],
      ],
      observed_median_srgb: [0.6542, 0.6054, 0.3475],
      calm_indicator_srgb: [0.5561, 0.5146, 0.2954],
    },
  ],
  free_views: {
    obl2: {
      position_world: [4.0, 4.0, 3.6],
      target_world: [8.2, 1.0, 0.4],
      hfov_deg: 80.0,
    },
    top: {
      position_world: [4.1, 4.2, 9.5],
      target_world: [4.1, 4.15, 0.0],
      hfov_deg: 70.0,
    },
  },
};

describe('VDT 순수 함수: 입력 검증 및 좌표/행렬 변환 (worldCoordinates 경유)', () => {
  it('운영 계약 형식(WORLD 좌표계)의 vdt 메타와 실험 산출물(GLTF_Y_UP 좌표계)을 정확히 검증·정규화한다', () => {
    const cfg = readSceneVdtConfig(SAMPLE_VDT_RAW);
    expect(cfg).not.toBeNull();
    expect(cfg!.cameras).toHaveLength(1);
    expect(cfg!.cameras[0]!.cameraId).toBe('cam_A');
    expect(cfg!.floorPlane?.zWorldM).toBe(-0.015);
    expect(cfg!.wallPlanes).toHaveLength(1);
    expect(cfg!.freeViews?.obl2?.positionWorld).toEqual([4.0, 4.0, 3.6]);

    // -527 실험 cameras.json 은 R 이 R_glb2cv = R_w2c * G^T 로 저장되어 있다.
    // parseExperimentVdtDocs 가 WORLD_TO_THREE_MATRIX(G)를 곱해 정본 World R_w2c 로 복원하는지 확인한다.
    const camAGlbR: VdtMatrix3 = [
      [-0.68452315, -0.00851999, -0.72894132],
      [0.24497942, 0.93905586, -0.24075126],
      [0.68660553, -0.3436662, -0.64087003],
    ];
    const expCfg = parseExperimentVdtDocs(
      {
        coordinate_convention: 'GLTF_Y_UP (x_glb=x_world, y_glb=z_world, z_glb=-y_world)',
        cameras: [
          {
            camera_id: 'cam_A',
            image: 'images/cam_A.jpg',
            image_size: [2048, 1152],
            K: CAM_A_K,
            R: camAGlbR,
            t: CAM_A_WORLD_T,
            near: 0.1,
            far: 25.0,
          },
        ],
      },
      {
        floor_plane: SAMPLE_VDT_RAW.floor_plane,
        wall_planes: SAMPLE_VDT_RAW.wall_planes,
      },
      'https://assets.invalid/vdt',
    );
    expect(expCfg).not.toBeNull();
    expect(expCfg!.cameras[0]!.imageUrl).toBe('https://assets.invalid/vdt/images/cam_A.jpg');
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        expect(expCfg!.cameras[0]!.R[r]![c]!).toBeCloseTo(CAM_A_WORLD_R[r]![c]!, 6);
      }
    }

    // 잘못된 입력 거부
    expect(readSceneVdtConfig(null)).toBeNull();
    expect(readSceneVdtConfig({ cameras: [] })).toBeNull();
    expect(
      readSceneVdtConfig({
        cameras: [{ ...SAMPLE_VDT_RAW.cameras[0], image_size: [0, 1152] }],
      }),
    ).toBeNull();
    expect(
      readSceneVdtConfig({
        cameras: [
          {
            ...SAMPLE_VDT_RAW.cameras[0],
            K: [
              [0, 0, 500],
              [0, 500, 500],
              [0, 0, 1],
            ],
          },
        ],
      }),
    ).toBeNull();

    // readCurrentScene 통합 검증 (정상 vdt 포함 vs javascript: 악성 URL 거부)
    const validScene = readCurrentScene({
      scene_version: 'scene-vdt-1',
      state: 'COMMITTED',
      default: false,
      calibration_version: 'cal-12',
      committed_at_ms: 1700000000000,
      gltf_url: 'https://assets.invalid/scene.glb',
      gltf_expires_at_ms: 1700000300000,
      vdt: SAMPLE_VDT_RAW,
    });
    expect(validScene.ok).toBe(true);
    if (validScene.ok) {
      expect(validScene.scene.vdt?.cameras[0]?.cameraId).toBe('cam_A');
    }

    const maliciousScene = readCurrentScene({
      scene_version: 'scene-vdt-bad',
      state: 'COMMITTED',
      default: false,
      calibration_version: 'cal-12',
      committed_at_ms: 1700000000000,
      gltf_url: 'https://assets.invalid/scene.glb',
      gltf_expires_at_ms: 1700000300000,
      vdt: {
        ...SAMPLE_VDT_RAW,
        cameras: [{ ...SAMPLE_VDT_RAW.cameras[0], image_url: 'javascript:alert(1)' }],
      },
    });
    expect(maliciousScene).toEqual({ ok: false, reason: 'vdt 형식이 틀렸다' });
  });

  it('convertVdtCameraToThree 가 worldCoordinates.ts 만 사용해 World R·t 를 Three.js 공간 행렬로 정확히 변환한다', () => {
    const camThree = convertVdtCameraToThree(SAMPLE_CAM_A, 0.1, 25.0);

    // 12차 cam_A 정본 카메라 중심 위치: World (0.620309, 3.271264, -2.559472) -> Three (0.620309, -2.559472, -3.271264)
    // wait: C_world = -R^T * t 검증:
    // -( (-0.68452315)*(-0.30549093) + (0.24497942)*(-3.41391754) + (0.68660553)*(1.88346767) ) = -0.665976
    const expectedWorldPos = worldToThree(
      worldPoint(camThree.positionWorld[0], camThree.positionWorld[1], camThree.positionWorld[2]),
    );
    expect(camThree.positionThree.x).toBeCloseTo(expectedWorldPos[0], 6);
    expect(camThree.positionThree.y).toBeCloseTo(expectedWorldPos[1], 6);
    expect(camThree.positionThree.z).toBeCloseTo(expectedWorldPos[2], 6);

    // 임의의 World 점 P_world = (4.2, 5.1, 0.8) 에 대해:
    // 원본 식 p_cv_direct = R_w2c * P_world + t_w2c 와
    // Three 변환 점 P_three = worldToThree(P_world) 에 대한 p_cv_three = rThreeToCv * P_three + tThreeToCv 가 완전히 일치해야 한다.
    const pWorld: VdtVec3 = [4.2, 5.1, 0.8];
    const pCvDirect = [
      CAM_A_WORLD_R[0][0] * pWorld[0] +
        CAM_A_WORLD_R[0][1] * pWorld[1] +
        CAM_A_WORLD_R[0][2] * pWorld[2] +
        CAM_A_WORLD_T[0],
      CAM_A_WORLD_R[1][0] * pWorld[0] +
        CAM_A_WORLD_R[1][1] * pWorld[1] +
        CAM_A_WORLD_R[1][2] * pWorld[2] +
        CAM_A_WORLD_T[1],
      CAM_A_WORLD_R[2][0] * pWorld[0] +
        CAM_A_WORLD_R[2][1] * pWorld[1] +
        CAM_A_WORLD_R[2][2] * pWorld[2] +
        CAM_A_WORLD_T[2],
    ];

    const pThreeTuple = worldToThree(worldPoint(pWorld[0], pWorld[1], pWorld[2]));
    const pThree = new THREE.Vector3(...pThreeTuple);
    const pCvFromThree = pThree.clone().applyMatrix3(camThree.rThreeToCv).add(camThree.tThreeToCv);

    expect(pCvFromThree.x).toBeCloseTo(pCvDirect[0]!, 6);
    expect(pCvFromThree.y).toBeCloseTo(pCvDirect[1]!, 6);
    expect(pCvFromThree.z).toBeCloseTo(pCvDirect[2]!, 6);

    // OpenGL viewMatrix * matrixWorld == Identity 확인
    const prod = new THREE.Matrix4().multiplyMatrices(
      camThree.threeViewMatrix,
      camThree.threeMatrixWorld,
    );
    const identity = new THREE.Matrix4();
    for (let i = 0; i < 16; i++) {
      expect(prod.elements[i]!).toBeCloseTo(identity.elements[i]!, 6);
    }

    // 투영 행렬 NDC 일관성 확인
    const proj = buildOpenGlProjectionMatrix(CAM_A_K, 2048, 1152, 0.1, 25.0);
    const pGl = new THREE.Vector4(
      pCvFromThree.x,
      -pCvFromThree.y,
      -pCvFromThree.z,
      1.0,
    ).applyMatrix4(proj);
    const ndcX = pGl.x / pGl.w;
    const ndcY = pGl.y / pGl.w;
    const uNorm =
      camThree.normalizedIntrinsics.x * (pCvFromThree.x / pCvFromThree.z) +
      camThree.normalizedIntrinsics.z;
    const vNorm =
      camThree.normalizedIntrinsics.y * (pCvFromThree.y / pCvFromThree.z) +
      camThree.normalizedIntrinsics.w;
    expect(ndcX).toBeCloseTo(2 * uNorm - 1, 6);
    expect(ndcY).toBeCloseTo(1 - 2 * vNorm, 6);
  });

  it('convertVdtQuadToThree 와 convertVdtFreeViewToThree 가 바닥·벽 평면 및 자유 시점을 Three.js 좌표로 변환한다', () => {
    const cfg = readSceneVdtConfig(SAMPLE_VDT_RAW)!;
    const floorThree = convertVdtQuadToThree(
      cfg.floorPlane!.cornersWorld,
      cfg.floorPlane!.normalWorld,
    );
    // World Z = -0.015m 바닥은 Three Y = -0.015m, 법선 World (0,0,1) 은 Three (0,1,0)
    expect(floorThree.normalThree.toArray()).toEqual([0, 1, 0]);
    expect(floorThree.cornersThree[0].y).toBeCloseTo(-0.015, 6);
    expect(floorThree.cornersThree[0].z).toBeCloseTo(-cfg.floorPlane!.cornersWorld[0][1], 6);

    const obl2 = convertVdtFreeViewToThree(cfg.freeViews!.obl2!);
    expect(obl2.positionThree.toArray()).toEqual([4.0, 3.6, -4.0]);
    expect(obl2.upThree.toArray()).toEqual([0, 1, 0]);

    const top = convertVdtFreeViewToThree(cfg.freeViews!.top!);
    expect(top.positionThree.toArray()).toEqual([4.1, 9.5, -4.2]);
    // 수직 하향 시점(top)은 up 벡터가 World +Y = Three (0, 0, -1)
    expect(top.upThree.toArray()).toEqual([0, 0, -1]);
  });
});

describe('VDT 순수 함수: 카메라 가중치 계산 및 5cm 깊이 일치 게이트·4차 외톨이 제거', () => {
  it('가시 영역 안의 정합된 표면에는 양수 가중치를 부여하고, 표시 층/미관측 면의 5cm 깊이 불일치(전경 가구 비침)는 0으로 차단한다', () => {
    const camThree = convertVdtCameraToThree(SAMPLE_CAM_A, 0.1, 25.0);
    // cam_A 시야 중앙 근처 바닥 점: 카메라 정면으로 4.0m 떨어진 점
    const targetThree = camThree.positionThree.clone().addScaledVector(camThree.forwardThree, 4.0);
    const pointThree: VdtVec3 = [targetThree.x, 0.0, targetThree.z];
    const normalThree: VdtVec3 = [0, 1, 0];
    const toViewer = camThree.positionThree
      .clone()
      .sub(new THREE.Vector3(...pointThree))
      .normalize();
    const viewDirThree: VdtVec3 = [toViewer.x, toViewer.y, toViewer.z];

    // 먼저 실제 zCv 계산
    const probe = evaluateCameraWeightCpu({
      cam: camThree,
      pointThree,
      normalThree,
      viewDirThree,
      shadowDepths5TapM: [4.0, 4.0, 4.0, 4.0, 4.0],
      hasBaseMap: true,
      isIndicatorPlane: false,
    });
    const trueZ = probe.zCv;
    expect(trueZ).toBeGreaterThan(1.0);

    // 1) 관측 면 + 깊이 정확히 일치 -> 높은 가중치
    const matched = evaluateCameraWeightCpu({
      cam: camThree,
      pointThree,
      normalThree,
      viewDirThree,
      shadowDepths5TapM: [trueZ, trueZ, trueZ, trueZ, trueZ],
      hasBaseMap: true,
      isIndicatorPlane: false,
    });
    expect(matched.weight).toBeGreaterThan(0.1);
    expect(matched.geomW).toBeGreaterThan(0.1);

    // 2) 바닥 표시 층(isIndicatorPlane = true)에서 전경 탁자(trueZ - 0.55m)가 가로막거나 그림자 맵이 비어(25.0m) 있을 때 -> 0으로 차단!
    const blockedByTableOnIndicator = evaluateCameraWeightCpu({
      cam: camThree,
      pointThree,
      normalThree,
      viewDirThree,
      shadowDepths5TapM: [trueZ - 0.55, trueZ - 0.55, trueZ - 0.55, trueZ - 0.55, trueZ - 0.55],
      hasBaseMap: false,
      isIndicatorPlane: true,
      indicatorKind: 0,
      indicatorDepthMatch: true,
    });
    expect(blockedByTableOnIndicator.weight).toBe(0);

    const emptyHoleOnIndicator = evaluateCameraWeightCpu({
      cam: camThree,
      pointThree,
      normalThree,
      viewDirThree,
      shadowDepths5TapM: [25.0, 25.0, 25.0, 25.0, 25.0],
      hasBaseMap: false,
      isIndicatorPlane: true,
      indicatorKind: 0,
      indicatorDepthMatch: true,
    });
    expect(emptyHoleOnIndicator.weight).toBe(0);

    // 3) 바닥 표시 층이라도 실제 TSDF 바닥 깊이가 5cm 이내(trueZ - 0.015m)로 일치하면 투영 허용!
    const matchedOnIndicator = evaluateCameraWeightCpu({
      cam: camThree,
      pointThree,
      normalThree,
      viewDirThree,
      shadowDepths5TapM: [
        trueZ - 0.015,
        trueZ - 0.015,
        trueZ - 0.015,
        trueZ - 0.015,
        trueZ - 0.015,
      ],
      hasBaseMap: false,
      isIndicatorPlane: true,
      indicatorKind: 0,
      indicatorDepthMatch: true,
    });
    expect(matchedOnIndicator.weight).toBeGreaterThan(0.05);
  });

  it('4차 외톨이 제거(resolveVdtOutliersAndBlendCpu)가 3대 메도이드 및 2대+구운텍스처 투표로 어두운 다리 잔상 카메라를 제거한다', () => {
    const carpetSrgb: VdtVec3 = [0.42, 0.45, 0.49];
    const carpetSrgb2: VdtVec3 = [0.41, 0.44, 0.48];
    const darkLegOutlierSrgb: VdtVec3 = [0.06, 0.07, 0.08]; // 검은 스툴 다리 잔상

    // 1) 3대 후보: cam_0(시점 가중치 매우 높음=2.5, 하지만 검은 다리 잔상) vs cam_1, cam_2(정상 카펫 톤)
    const res3 = resolveVdtOutliersAndBlendCpu({
      candidates: [
        { weight: 2.5, geomW: 0.5, wView: 5.0, colorSrgb: darkLegOutlierSrgb },
        { weight: 0.4, geomW: 0.4, wView: 1.0, colorSrgb: carpetSrgb },
        { weight: 0.35, geomW: 0.35, wView: 1.0, colorSrgb: carpetSrgb2 },
        { weight: 0, geomW: 0, wView: 0, colorSrgb: [0, 0, 0] },
      ],
      rawOrigColorSrgb: carpetSrgb,
      floorObsColorSrgb: carpetSrgb,
      isFloorTarget: true,
      hasBaseMap: true,
      outlierRemoval: true,
      colorSigma: 0.056,
    });
    // 외톨이인 cam_0 의 정규화 가중치는 0 이어야 하고, 최종 블렌딩 색은 밝은 카펫 톤이어야 한다.
    expect(res3.normalizedWeights[0]).toBeCloseTo(0, 5);
    expect(res3.normalizedWeights[1] + res3.normalizedWeights[2]).toBeCloseTo(1.0, 5);
    expect(res3.finalColorSrgb[0]).toBeGreaterThan(0.38);

    // 2) 2대 후보: cam_0(검은 다리 잔상) vs cam_1(정상 카펫) + 구운 텍스처(thirdVoteLab = 카펫)
    const res2 = resolveVdtOutliersAndBlendCpu({
      candidates: [
        { weight: 1.8, geomW: 0.45, wView: 4.0, colorSrgb: darkLegOutlierSrgb },
        { weight: 0.4, geomW: 0.4, wView: 1.0, colorSrgb: carpetSrgb },
        { weight: 0, geomW: 0, wView: 0, colorSrgb: [0, 0, 0] },
        { weight: 0, geomW: 0, wView: 0, colorSrgb: [0, 0, 0] },
      ],
      rawOrigColorSrgb: carpetSrgb2,
      floorObsColorSrgb: carpetSrgb,
      isFloorTarget: true,
      hasBaseMap: true,
      outlierRemoval: true,
      colorSigma: 0.056,
    });
    expect(res2.normalizedWeights[0]).toBeCloseTo(0, 5);
    expect(res2.normalizedWeights[1]).toBeCloseTo(1.0, 5);
    expect(res2.finalColorSrgb[1]).toBeGreaterThan(0.4);

    // Oklab 무채색 검정/흰색 경계 확인
    expect(srgbToOklab([0, 0, 0])).toEqual([0, 0, 0]);
    const whiteLab = srgbToOklab([1, 1, 1]);
    expect(whiteLab[0]).toBeCloseTo(1.0, 3);
  });

  it('열린 구멍 경계 거리(computeOpenBoundaryDistances)와 용접 법선(computeWeldedSmoothNormals)을 정확히 계산한다', () => {
    // 두 삼각형으로 이루어진 정사각형(내부 공유 간선 1개, 외곽 열린 간선 4개)과 안쪽 중심 정점 4분할 구조 생성
    const geom = new THREE.PlaneGeometry(1, 1, 2, 2);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
    computeWeldedSmoothNormals([mesh]);
    const stats = computeOpenBoundaryDistances([mesh]);

    expect(stats.openEdges).toBe(8); // 2x2 격자 외곽 테두리 간선 8개
    expect(stats.boundaryVertices).toBe(8);
    const attr = geom.getAttribute('aBoundaryDist');
    expect(attr).toBeDefined();

    // 정중앙 정점(0, 0, 0)은 외곽 테두리로부터 0.5m 떨어져 있으므로 상한 0.12m 로 캡핑되어야 한다.
    const pos = geom.getAttribute('position');
    let centerDist = -1;
    let cornerDist = -1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      if (Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4) centerDist = attr.getX(i);
      if (Math.abs(x - 0.5) < 1e-4 && Math.abs(y - 0.5) < 1e-4) cornerDist = attr.getX(i);
    }
    expect(cornerDist).toBe(0);
    expect(centerDist).toBeCloseTo(0.12, 4);
    geom.dispose();
  });
});

describe('SceneBackground VDT 기능 플래그(기본 끔) 보존 및 마운트/해제 복원', () => {
  it('VDT 플래그가 기본값(false)일 때는 vdt 메타가 있어도 기존 MeshBasicMaterial 경로를 그대로 유지한다', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const data = createSpatialDataStore();
    data.getState().reset('mock:normal:1');
    const message = scenarioWorld('normal', 0, 1_760_342_400_000) as {
      payload: Record<string, unknown>;
    };
    data.getState().ingest(message, 1_760_342_400_020);

    const sceneStore = createSceneStore();
    // 기본값은 enabled: false 여야 한다.
    expect(sceneStore.getState().vdtOptions.enabled).toBe(false);
    expect(DEFAULT_VDT_OPTIONS.enabled).toBe(false);
    expect(DEFAULT_VDT_OPTIONS.projectUnobserved).toBe(false);
    expect(DEFAULT_VDT_OPTIONS.outlierRemoval).toBe(true);

    const rootGroup = new THREE.Group();
    const tex = new THREE.DataTexture(new Uint8Array([200, 180, 160, 255]), 1, 1);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.1, 4),
      new THREE.MeshStandardMaterial({ map: tex }),
    );
    mesh.position.set(2, -0.05, -2);
    rootGroup.add(mesh);

    const loader: SceneAssetLoader = vi.fn().mockResolvedValue(rootGroup);
    const vdtTexLoader: SceneVdtTextureLoader = vi.fn().mockResolvedValue([]);

    const canvas = document.createElement('canvas');
    const r3fRoot = createRoot(canvas);
    await r3fRoot.configure({
      gl: {
        render: () => {},
        setPixelRatio: () => {},
        setSize: () => {},
        dispose: () => {},
        forceContextLoss: () => {},
        domElement: canvas,
        shadowMap: { enabled: false, type: 0, needsUpdate: false },
        xr: {
          enabled: false,
          isPresenting: false,
          addEventListener: () => {},
          removeEventListener: () => {},
          setAnimationLoop: () => {},
        },
        renderLists: { dispose: () => {} },
        outputColorSpace: '',
        toneMapping: 0,
      } as never,
      size: { width: 800, height: 600, top: 0, left: 0 },
      frameloop: 'never',
    });

    await act(async () =>
      r3fRoot.render(
        createElement(
          StrictMode,
          null,
          createElement(
            SpatialDataContext,
            { value: data },
            createElement(
              ViewerStoreContext,
              { value: createViewerStore() },
              createElement(
                SceneStoreContext,
                { value: sceneStore },
                createElement(
                  SceneLoaderContext,
                  { value: loader },
                  createElement(
                    SceneVdtTextureLoaderContext,
                    { value: vdtTexLoader },
                    createElement(SceneBackground),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    const inputWithVdt: ViewerSceneInput = {
      ok: true,
      raw: {
        scene_version: 'scene-demo-1',
        state: 'COMMITTED',
        default: false,
        calibration_version: 'cal-demo',
        committed_at_ms: 1_760_342_400_000,
        quality: null,
        gltf_url: 'https://assets.invalid/scene-demo-1.glb',
        gltf_expires_at_ms: Date.now() + 300_000,
        vdt: SAMPLE_VDT_RAW,
      },
    };

    await act(async () => sceneStore.getState().setInput(inputWithVdt));

    // VDT 플래그가 꺼져 있으므로 VDT 카메라 텍스처 로더는 호출되지 않고, 재질은 기존 MeshBasicMaterial 그대로다.
    expect(vdtTexLoader).not.toHaveBeenCalled();
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);

    await act(async () => r3fRoot.unmount());
    vi.restoreAllMocks();
  });

  it('mountVdtOnSceneRoot 장착 시 ShaderMaterial 과 표시 층을 구성하고 dispose 시 원래 MeshBasicMaterial 로 완벽히 복원한다', () => {
    const rootGroup = new THREE.Group();
    const baseTex = new THREE.DataTexture(new Uint8Array([200, 180, 160, 255]), 1, 1);
    const tsdfMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshStandardMaterial({ map: baseTex, name: 'textured_0000' }),
    );
    tsdfMesh.name = 'textured_0000';
    const estFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshStandardMaterial({ name: 'estimated_floor_plane' }),
    );
    estFloor.name = 'estimated_floor_plane';
    rootGroup.add(tsdfMesh, estFloor);

    prepareSceneRoot(rootGroup);
    const origMat = tsdfMesh.material;
    expect(origMat).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(baseTex.colorSpace).toBe(THREE.SRGBColorSpace);

    const vdtConfig = readSceneVdtConfig(SAMPLE_VDT_RAW)!;
    const camerasThree = vdtConfig.cameras.map((c) => convertVdtCameraToThree(c));
    const { shadowMeshes } = collectVdtMeshes(rootGroup);
    expect(shadowMeshes).toEqual([tsdfMesh]);

    const fakeGl = { autoClear: true } as unknown as THREE.WebGLRenderer;
    const baked = bakeVdtShadowMaps(fakeGl, shadowMeshes, camerasThree, 1024, 25.0);
    const camTex = new THREE.DataTexture(new Uint8Array([100, 120, 140, 255]), 1, 1);

    const mounted = mountVdtOnSceneRoot({
      root: rootGroup,
      vdtConfig,
      camerasThree,
      cameraTextures: [camTex, camTex, camTex, camTex],
      bakedShadows: baked,
      options: { ...DEFAULT_VDT_OPTIONS, enabled: true },
    });

    // VDT 장착 후: TSDF 메시는 ShaderMaterial 로 바뀌고, 기존 estimated_floor_plane 은 숨겨지며, 표시 층이 생성된다.
    expect(tsdfMesh.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(tsdfMesh.renderOrder).toBe(-10);
    expect(estFloor.visible).toBe(false);
    expect(mounted.indicatorGroup.getObjectByName('vdt_floor_indicator_plane')).not.toBeNull();
    expect(mounted.indicatorGroup.getObjectByName('vdt_wall_0')).not.toBeNull();

    // dispose 후: 원래 MeshBasicMaterial 과 SRGBColorSpace 및 가시성이 100% 복원된다.
    mounted.dispose();
    baked.dispose();
    expect(tsdfMesh.material).toBe(origMat);
    expect(baseTex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(estFloor.visible).toBe(true);
  });

  it('map_cameras(MA_ALIGNED_SIM3)가 있으면 그 자세로 투영하고 없으면 기존 calibration 자세로 폴백하며 R·t 규약을 지킨다', async () => {
    // 1) R, t 방향 규약(World -> OpenCV 카메라: p_cam_cv = R * p_world + t, C_world = -R^T * t) 검증
    // 카메라가 World (1.0, 2.0, 1.5)에서 +X 방향을 정면(+Z_cv), -Y 방향을 우측(+X_cv), -Z 방향을 하방(+Y_cv)으로 볼 때:
    // R_w2c = [[0, -1, 0], [0, 0, -1], [1, 0, 0]]
    // t_w2c = -R_w2c * C_world = [2.0, 1.5, -1.0]
    const rW2c: VdtMatrix3 = [
      [0, -1, 0],
      [0, 0, -1],
      [1, 0, 0],
    ];
    const tW2c: VdtVec3 = [2.0, 1.5, -1.0];
    const mapCamerasRaw = {
      cam_A: {
        image_size: [2304, 1296],
        K: [
          [1152, 0, 1152],
          [0, 1152, 648],
          [0, 0, 1],
        ],
        R: rW2c,
        t: tW2c,
        pose_source: 'MA_ALIGNED_SIM3',
      },
    };

    const parsedMapCameras = readSceneMapCameras(mapCamerasRaw);
    expect(parsedMapCameras).not.toBeNull();

    const vdtWithTwoCamsRaw = {
      ...SAMPLE_VDT_RAW,
      cameras: [
        ...SAMPLE_VDT_RAW.cameras,
        {
          ...SAMPLE_VDT_RAW.cameras[0]!,
          camera_id: 'cam_B',
          image_url: 'https://assets.invalid/vdt/cam_B.jpg',
        },
      ],
    };

    // 2) map_cameras 가 없을 때(레거시 Scene): 기존 calibration 자세(SAMPLE_CAM_A)를 그대로 유지한다.
    const legacyVdt = readSceneVdtConfig(vdtWithTwoCamsRaw)!;
    const legacyCamThree = convertVdtCameraToThree(legacyVdt.cameras[0]!);
    expect(legacyCamThree.poseSource).toBe('CALIBRATION');
    expect(legacyCamThree.tThreeToCv.toArray()).toEqual(CAM_A_WORLD_T);

    // 3) map_cameras 가 있을 때: cam_A 는 MA_ALIGNED_SIM3 자세로 오버라이드되고, map_cameras 에 없는 카메라는 CALIBRATION 유지
    const directAppliedCams = applyMapCamerasToVdtCameras(legacyVdt.cameras, parsedMapCameras);
    expect(directAppliedCams[0]?.poseSource).toBe('MA_ALIGNED_SIM3');
    expect(directAppliedCams[1]?.poseSource).toBe('CALIBRATION');
    const appliedVdt = applyMapCamerasToVdtConfig(legacyVdt, parsedMapCameras);
    const maCamThree = convertVdtCameraToThree(appliedVdt.cameras[0]!);
    const otherCamThree = convertVdtCameraToThree(appliedVdt.cameras[1]!);
    expect(maCamThree.poseSource).toBe('MA_ALIGNED_SIM3');
    expect(otherCamThree.poseSource).toBe('CALIBRATION');
    expect(maCamThree.positionWorld[0]).toBeCloseTo(1.0, 6);
    expect(maCamThree.positionWorld[1]).toBeCloseTo(2.0, 6);
    expect(maCamThree.positionWorld[2]).toBeCloseTo(1.5, 6);

    // World 점 P_world = (5.0, 2.0, 1.5) (카메라 정면 4m 앞) -> OpenCV 카메라 좌표 p_cv = (0, 0, 4.0)
    // 정규화 투영 좌표 (uImg, vImg) = (0.5, 0.5) 정중앙이어야 한다.
    const [pxThree, pyThree, pzThree] = worldToThree(worldPoint(5.0, 2.0, 1.5));
    const pCv = new THREE.Vector3(pxThree, pyThree, pzThree)
      .applyMatrix3(maCamThree.rThreeToCv)
      .add(maCamThree.tThreeToCv);
    expect(pCv.x).toBeCloseTo(0.0, 6);
    expect(pCv.y).toBeCloseTo(0.0, 6);
    expect(pCv.z).toBeCloseTo(4.0, 6);

    // 4) readCurrentScene 에서 응답 최상위 map_cameras 가 vdt 카메라에 자동 반영되는지 확인
    const sceneRead = readCurrentScene({
      scene_version: 'scene-ma-1',
      state: 'COMMITTED',
      default: false,
      calibration_version: 'cal-demo',
      committed_at_ms: 1_760_342_400_000,
      quality: null,
      gltf_url: 'https://assets.invalid/scene-ma-1.glb',
      gltf_expires_at_ms: Date.now() + 300_000,
      map_cameras: mapCamerasRaw,
      vdt: vdtWithTwoCamsRaw,
    });
    expect(sceneRead.ok).toBe(true);
    if (sceneRead.ok) {
      expect(sceneRead.scene.mapCameras?.cam_A.poseSource).toBe('MA_ALIGNED_SIM3');
      expect(sceneRead.scene.vdt?.cameras[0]?.poseSource).toBe('MA_ALIGNED_SIM3');
      expect(sceneRead.scene.vdt?.cameras[0]?.t).toEqual(tW2c);
      expect(sceneRead.scene.vdt?.cameras[1]?.poseSource).toBe('CALIBRATION');
    }

    // 5) GLB extras.simai.map_cameras (Object3D.userData.simai.map_cameras) 폴백 및 SceneBackground 장착 검증
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const data = createSpatialDataStore();
    data.getState().reset('mock:normal:1');
    data
      .getState()
      .ingest(
        scenarioWorld('normal', 0, 1_760_342_400_000) as { payload: Record<string, unknown> },
        1_760_342_400_020,
      );

    const sceneStore = createSceneStore();
    sceneStore.getState().setVdtOptions({ enabled: true });

    const rootGroup = new THREE.Group();
    rootGroup.userData = { simai: { map_cameras: mapCamerasRaw } };
    expect(readSceneMapCamerasFromObject3D(rootGroup)?.cam_A.poseSource).toBe('MA_ALIGNED_SIM3');

    const tex = new THREE.DataTexture(new Uint8Array([200, 180, 160, 255]), 1, 1);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.1, 4),
      new THREE.MeshStandardMaterial({ map: tex }),
    );
    mesh.position.set(2, -0.05, -2);
    rootGroup.add(mesh);

    const camTex = new THREE.DataTexture(new Uint8Array([100, 120, 140, 255]), 1, 1);
    const loader: SceneAssetLoader = vi.fn().mockResolvedValue(rootGroup);
    const vdtTexLoader: SceneVdtTextureLoader = vi
      .fn()
      .mockResolvedValue([camTex, camTex, camTex, camTex]);

    const canvas = document.createElement('canvas');
    const r3fRoot = createRoot(canvas);
    await r3fRoot.configure({
      gl: {
        render: () => {},
        setPixelRatio: () => {},
        setSize: () => {},
        dispose: () => {},
        forceContextLoss: () => {},
        domElement: canvas,
        shadowMap: { enabled: false, type: 0, needsUpdate: false },
        xr: {
          enabled: false,
          isPresenting: false,
          addEventListener: () => {},
          removeEventListener: () => {},
          setAnimationLoop: () => {},
        },
        renderLists: { dispose: () => {} },
        outputColorSpace: '',
        toneMapping: 0,
      } as never,
      size: { width: 800, height: 600, top: 0, left: 0 },
      frameloop: 'never',
    });

    await act(async () =>
      r3fRoot.render(
        createElement(
          StrictMode,
          null,
          createElement(
            SpatialDataContext,
            { value: data },
            createElement(
              ViewerStoreContext,
              { value: createViewerStore() },
              createElement(
                SceneStoreContext,
                { value: sceneStore },
                createElement(
                  SceneLoaderContext,
                  { value: loader },
                  createElement(
                    SceneVdtTextureLoaderContext,
                    { value: vdtTexLoader },
                    createElement(SceneBackground),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    await act(async () =>
      sceneStore.getState().setInput({
        ok: true,
        raw: {
          scene_version: 'scene-demo-1',
          state: 'COMMITTED',
          default: false,
          calibration_version: 'cal-demo',
          committed_at_ms: 1_760_342_400_000,
          quality: null,
          gltf_url: 'https://assets.invalid/scene-demo-1.glb',
          gltf_expires_at_ms: Date.now() + 300_000,
          vdt: vdtWithTwoCamsRaw,
        },
      }),
    );

    expect(mesh.material).toBeInstanceOf(THREE.ShaderMaterial);
    const shaderMat = mesh.material as unknown as THREE.ShaderMaterial;
    const uCamT = shaderMat.uniforms.uCamT?.value as THREE.Vector3[];
    expect(uCamT[0]?.toArray()).toEqual(tW2c);
    expect(uCamT[1]?.toArray()).toEqual(CAM_A_WORLD_T);

    await act(async () => r3fRoot.unmount());
    vi.restoreAllMocks();
  });
});
