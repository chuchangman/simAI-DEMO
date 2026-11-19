import * as THREE from 'three';
import { convertVdtQuadToThree } from './vdtMath';
import type { SceneVdtConfig, VdtCameraThree, VdtRenderMode, ViewerVdtOptions } from './vdtTypes';

const CAM_VIS_COLORS = [
  new THREE.Vector3(0.937, 0.267, 0.267), // cam_A: Red (#ef4444)
  new THREE.Vector3(0.133, 0.773, 0.369), // cam_B: Green (#22c55e)
  new THREE.Vector3(0.231, 0.51, 0.965), // cam_C: Blue (#3b82f6)
  new THREE.Vector3(0.961, 0.62, 0.043), // cam_D: Amber (#f59e0b)
];

const noRaycast = () => {};

export const vdtBgVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`;

export const vdtBgFragmentShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec3 bottomCol = vec3(0.118, 0.153, 0.208); // #1e2735
    vec3 midCol    = vec3(0.157, 0.204, 0.271); // #283445
    vec3 topCol    = vec3(0.094, 0.125, 0.173); // #18202c
    vec3 c = (vUv.y < 0.48)
      ? mix(bottomCol, midCol, smoothstep(0.0, 0.48, vUv.y))
      : mix(midCol, topCol, smoothstep(0.48, 1.0, vUv.y));
    gl_FragColor = vec4(c, 1.0);
  }
`;

export const vdtDepthVertexShader = /* glsl */ `
  varying float vDepthCv;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 viewPos = viewMatrix * worldPos;
    vDepthCv = -viewPos.z;
    gl_Position = projectionMatrix * viewPos;
  }
`;

export const vdtDepthFragmentShader = /* glsl */ `
  #include <packing>
  uniform float uFar;
  varying float vDepthCv;
  void main() {
    float normDepth = clamp(vDepthCv / uFar, 0.0, 1.0);
    gl_FragColor = packDepthToRGBA(normDepth);
  }
`;

export const vdtVertexShader = /* glsl */ `
  #ifdef USE_VERTEX_COLOR
    attribute vec3 color;
    varying vec3 vColor;
  #endif
  #ifdef USE_BOUNDARY_DIST
    attribute float aBoundaryDist;
    varying float vBoundaryDist;
  #else
    varying float vBoundaryDist;
  #endif
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    #ifdef USE_VERTEX_COLOR
      vColor = color;
    #endif
    #ifdef USE_BOUNDARY_DIST
      vBoundaryDist = aBoundaryDist;
    #else
      vBoundaryDist = 1.0;
    #endif
    #ifdef USE_UV_ATTR
      vUv = uv;
    #else
      vUv = vec2(0.0);
    #endif
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const vdtFragmentShader = /* glsl */ `
  #include <packing>

  uniform int uRenderMode;          // 0: Original, 1: VDT, 2: Weight Vis, 3: Solid Diagnostic (#b8c4d0)
  uniform int uHasBaseMap;          // 1: 텍스처 아틀라스 있음
  uniform int uHasVertexColor;      // 1: COLOR_0 정점색 있음 (unobserved_neutral)
  uniform int uIsEstimatedPlane;    // 1: 12차 GLB 내 기존 estimated_floor_plane
  uniform int uIsIndicatorPlane;    // 1: 미관측 표시 층 (바닥 또는 벽 평면)
  uniform int uIndicatorKind;       // 0: 바닥 표시 층, 1: 벽 표시 층
  uniform int uProjectUnobserved;   // 1: 미관측 TSDF 면에도 투영 허용 (기본 0)
  uniform int uColorCorrection;     // 1: 카메라별 노출/색 보정 적용
  uniform int uUseBgTone;           // 1: 배경 슬레이트 톤 + 완만한 거리 안개
  uniform int uShowFloorLayer;      // 1: 바닥 표시 층 켜짐
  uniform int uShowWallLayer;       // 1: 벽 표시 층 켜짐
  uniform int uEdgeFeather;         // 1: 메시 구멍 경계 부드럽게 섞기
  uniform int uIndicatorDepthMatch; // 1: 표시 층 깊이 일치(5cm 이내 + 형상 존재)일 때만 사진 투영
  uniform int uUnobsDepthMatch;     // 1: 미관측 TSDF 면 투영 시에도 깊이 5cm 일치 게이트 적용
  uniform int uOutlierRemoval;      // 1: 카메라 간 사진 일치(외톨이 제거)
  uniform float uColorSigma;        // 카메라 간 Oklab 색 거리 σ (기본 0.056)
  uniform int uFeatherPass;         // 0: 단일 패스
  uniform int uTopK;                // 2 또는 3 (상위 K대 카메라 블렌딩)
  uniform float uVdtStrength;       // 0..1: 원래 구운 색과 VDT 결과를 섞는 비율(카메라 시점 보기 페이드, -590)
  uniform float uFar;
  uniform vec2 uShadowTexelSize;

  uniform sampler2D uBaseMap;
  uniform vec3 uBaseFactorLinear;

  uniform vec3 uIndicatorCalmColor;
  uniform vec3 uIndicatorObsColor;
  uniform vec2 uWallTangentWorldXY;
  uniform vec3 uFloorCalmColorShared;

  uniform sampler2D uCamTex0;
  uniform sampler2D uCamTex1;
  uniform sampler2D uCamTex2;
  uniform sampler2D uCamTex3;

  uniform sampler2D uCamDepth0;
  uniform sampler2D uCamDepth1;
  uniform sampler2D uCamDepth2;
  uniform sampler2D uCamDepth3;

  uniform mat3 uCamR[4];
  uniform vec3 uCamT[4];
  uniform vec4 uCamIntr[4];
  uniform vec3 uCamPos[4];
  uniform vec3 uCamGain[4];
  uniform vec3 uCamVisColor[4];

  #ifdef USE_VERTEX_COLOR
    varying vec3 vColor;
  #endif
  varying float vBoundaryDist;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  vec3 linearToSrgb(vec3 lin) {
    vec3 c = clamp(lin, 0.0, 1.0);
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), c));
  }

  vec3 srgbToLinear(vec3 srgb) {
    vec3 c = clamp(srgb, 0.0, 1.0);
    vec3 lo = c / 12.92;
    vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
    return mix(lo, hi, step(vec3(0.04045), c));
  }

  vec3 srgbToOklab(vec3 srgb) {
    vec3 lin = srgbToLinear(srgb);
    float l = 0.4122214708 * lin.r + 0.5363325363 * lin.g + 0.0514459929 * lin.b;
    float m = 0.2119034982 * lin.r + 0.6806995451 * lin.g + 0.1073969566 * lin.b;
    float s = 0.0883024619 * lin.r + 0.2817188376 * lin.g + 0.6299787005 * lin.b;
    float l_ = pow(max(l, 0.0), 1.0 / 3.0);
    float m_ = pow(max(m, 0.0), 1.0 / 3.0);
    float s_ = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3(
      0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    );
  }

  vec3 trimDarkRef(vec3 refLab, vec3 floorObsLab) {
    float darkW = smoothstep(0.030, 0.075, floorObsLab.x - refLab.x);
    return mix(refLab, floorObsLab, darkW * 0.88);
  }

  vec3 getOriginalBaseColor(vec3 N) {
    vec3 outCol;
    if (uHasBaseMap == 1) {
      outCol = texture2D(uBaseMap, vUv).rgb;
    } else {
      vec3 lin = uBaseFactorLinear;
      #ifdef USE_VERTEX_COLOR
        if (uHasVertexColor == 1) {
          lin *= vColor;
        }
      #endif
      vec3 srgb = linearToSrgb(lin);
      if (uIsEstimatedPlane == 0) {
        vec3 lightDir = normalize(vec3(0.35, 0.88, 0.32));
        // 5차(uOutlierRemoval == 1, uRenderMode == 1): 미관측 정점색(vColor) 삼각형이 인접 텍스처 면 대비
        // 어둡거나 각져 조각나 보이지 않도록 과도한 법선 음영(0.78~1.0)을 완화하고 평균 카메라 노출 게인을 맞춘다.
        if (uRenderMode == 1 && uOutlierRemoval == 1) {
          float shade = 0.95 + 0.05 * abs(dot(N, lightDir));
          srgb *= shade;
          if (uColorCorrection == 1) {
            vec3 avgGain = 0.25 * (uCamGain[0] + uCamGain[1] + uCamGain[2] + uCamGain[3]);
            srgb = clamp(srgb * avgGain, 0.0, 1.0);
          }
        } else {
          float shade = 0.78 + 0.22 * abs(dot(N, lightDir));
          srgb *= shade;
        }
      }
      outCol = srgb;
    }
    return outCol;
  }

  vec3 evalCalmGridColor(vec2 coordMeters, vec3 baseTone, float viewDist) {
    vec2 fw = max(fwidth(coordMeters), vec2(1e-4));
    vec2 dist1m = abs(fract(coordMeters - 0.5) - 0.5) / fw;
    float line1m = 1.0 - smoothstep(0.0, 1.35, min(dist1m.x, dist1m.y));

    vec2 distHalf = abs(fract(coordMeters * 2.0 - 0.5) - 0.5) / (fw * 2.0);
    float lineHalf = 1.0 - smoothstep(0.0, 1.25, min(distHalf.x, distHalf.y));

    float fade = 1.0 - smoothstep(5.0, 18.0, viewDist);
    vec3 gridCol = baseTone + vec3(0.075) * line1m * fade + vec3(0.025) * lineHalf * fade * 0.6;
    return clamp(gridCol, 0.0, 1.0);
  }

  float readShadowDepth(int idx, vec2 uv) {
    vec4 rgba;
    if (idx == 0) rgba = texture2D(uCamDepth0, uv);
    else if (idx == 1) rgba = texture2D(uCamDepth1, uv);
    else if (idx == 2) rgba = texture2D(uCamDepth2, uv);
    else rgba = texture2D(uCamDepth3, uv);
    return unpackRGBAToDepth(rgba) * uFar;
  }

  vec3 readCamPhoto(int idx, vec2 uv) {
    vec3 c;
    if (idx == 0) c = texture2D(uCamTex0, uv).rgb;
    else if (idx == 1) c = texture2D(uCamTex1, uv).rgb;
    else if (idx == 2) c = texture2D(uCamTex2, uv).rgb;
    else c = texture2D(uCamTex3, uv).rgb;
    if (uColorCorrection == 1) {
      c = clamp(c * uCamGain[idx], 0.0, 1.0);
    }
    return c;
  }

  // 5차: 카펫 직조 미세 결이나 텍셀 노이즈로 인해 픽셀마다 선택 카메라/가중치가 흔들리지 않도록
  // 색 거리(Oklab) 판정 전용으로만 사용하는 5-tap 공간 저역통과(low-pass) 샘플러 (실제 렌더링 색 c0..c3 는 선명한 원본 유지)
  vec3 readCamPhotoLowPass(int idx, vec2 uv) {
    vec2 stepUv = vec2(3.0 / 2048.0, 3.0 / 1152.0);
    vec3 c = readCamPhoto(idx, uv) * 0.36;
    c += readCamPhoto(idx, uv + vec2(stepUv.x, 0.0)) * 0.16;
    c += readCamPhoto(idx, uv - vec2(stepUv.x, 0.0)) * 0.16;
    c += readCamPhoto(idx, uv + vec2(0.0, stepUv.y)) * 0.16;
    c += readCamPhoto(idx, uv - vec2(0.0, stepUv.y)) * 0.16;
    return c;
  }

  float evaluateCameraWeight(
    int idx,
    vec3 P,
    vec3 N,
    vec3 viewDir,
    out vec2 outUv,
    out float outGeomW,
    out float outWView
  ) {
    outUv = vec2(0.0);
    outGeomW = 0.0;
    outWView = 0.0;

    vec3 pCv = uCamR[idx] * P + uCamT[idx];
    float zCv = pCv.z;
    if (zCv <= 0.20 || zCv >= uFar - 0.5) {
      return 0.0;
    }

    vec4 intr = uCamIntr[idx];
    float uImg = intr.x * (pCv.x / zCv) + intr.z;
    float vImg = intr.y * (pCv.y / zCv) + intr.w;

    float margin = 0.005;
    if (uImg <= margin || uImg >= 1.0 - margin || vImg <= margin || vImg >= 1.0 - margin) {
      return 0.0;
    }

    vec2 uv = vec2(uImg, 1.0 - vImg);
    outUv = uv;

    vec3 effN = N;
    bool isFloor = (P.y < 0.18) || (P.y < 0.30 && abs(N.y) > 0.40) || (uIsIndicatorPlane == 1 && uIndicatorKind == 0);
    if (isFloor) {
      vec3 upN = (effN.y < 0.0) ? -effN : effN;
      effN = normalize(mix(upN, vec3(0.0, 1.0, 0.0), 0.92));
    }

    vec3 toCam = normalize(uCamPos[idx] - P);
    float cosNorm = dot(effN, toCam);
    float minCosNorm = isFloor
      ? 0.08
      : ((uHasBaseMap == 1 || uIsIndicatorPlane == 1) ? 0.15 : ((uOutlierRemoval == 1) ? 0.20 : 0.45));
    if (cosNorm <= minCosNorm) {
      return 0.0;
    }
    float wNorm = smoothstep(minCosNorm, minCosNorm + 0.20, cosNorm) * pow(cosNorm, 1.3);

    vec2 dx = vec2(uShadowTexelSize.x * 1.2, 0.0);
    vec2 dy = vec2(0.0, uShadowTexelSize.y * 1.2);
    float d0 = readShadowDepth(idx, uv);
    float d1 = readShadowDepth(idx, uv + dx);
    float d2 = readShadowDepth(idx, uv - dx);
    float d3 = readShadowDepth(idx, uv + dy);
    float d4 = readShadowDepth(idx, uv - dy);

    float minSignedDiff = min(zCv - d0, min(min(zCv - d1, zCv - d2), min(zCv - d3, zCv - d4)));
    float dMin = min(d0, min(min(d1, d2), min(d3, d4)));

    float wDepth = 1.0;
    bool useStrict5cmGate =
      (uIsIndicatorPlane == 1 && uIndicatorDepthMatch == 1) ||
      (uIsIndicatorPlane == 0 && uHasBaseMap == 0 && uUnobsDepthMatch == 1 && (uOutlierRemoval != 1 || !isFloor));

    if (useStrict5cmGate) {
      // 3차 지시 #1 & 4차 지시 #1 & 5차 보완:
      // 바닥·벽 표시 층(uIsIndicatorPlane == 1) 또는 미관측 TSDF 면(uHasBaseMap == 0)에 사진을 비출 때는
      // 그 카메라의 깊이 그림자 맵에 맵 형상이 있고(d < uFar - 0.5), 깊이가 5cm(0.05m) 안으로 일치할 때만 비춘다.
      const float INDICATOR_DEPTH_MATCH_TOL = 0.05;
      bool hasMapGeom = (d0 < uFar - 0.5) && (d1 < uFar - 0.5) && (d2 < uFar - 0.5) && (d3 < uFar - 0.5) && (d4 < uFar - 0.5);
      if (uOutlierRemoval == 1 && uIsIndicatorPlane == 0 && uHasBaseMap == 0) {
        // 5차 비바닥 미관측 면: 이웃 탭(d1..d4)이 모서리 밖 배경 구멍에 걸려 검은 테두리가 생기지 않도록
        // 중심 탭(d0)의 표면 수직 깊이 오차(5.5cm)만 검사하여 obl2 의 가려진 공중 조각만 차단하고 가구·창틀 경계는 매끄럽게 잇는다.
        float perpScale = max(cosNorm, 0.22);
        float centerPerpDiff = abs(zCv - d0) * perpScale;
        if ((d0 >= uFar - 0.5) || centerPerpDiff > 0.055) {
          return 0.0;
        }
        wDepth = 1.0 - smoothstep(0.025, 0.055, centerPerpDiff);
      } else {
        float centerAbsDiff = abs(zCv - d0);
        float neighborTol = (uIsIndicatorPlane == 0 && isFloor) ? 0.09 : INDICATOR_DEPTH_MATCH_TOL;
        float maxNeighborDiff = max(max(abs(zCv - d1), abs(zCv - d2)), max(abs(zCv - d3), abs(zCv - d4)));
        if (!hasMapGeom || centerAbsDiff > INDICATOR_DEPTH_MATCH_TOL || maxNeighborDiff > neighborTol) {
          return 0.0;
        }
        wDepth = 1.0 - smoothstep(INDICATOR_DEPTH_MATCH_TOL * 0.5, INDICATOR_DEPTH_MATCH_TOL, centerAbsDiff);
      }
    } else {
      // 5차에서 바닥(isFloor)은 uHasBaseMap == 0 과 uHasBaseMap == 1 이 3차와 완전히 동일한 깊이 검사를 수행해
      // 두 메시 경계나 TSDF 구멍 외곽에서 가중치 단차(줄무늬·조각)가 절대 발생하지 않게 한다.
      float slopeScale = 1.0 / max(cosNorm, 0.20);
      float tolOccl = (uIsIndicatorPlane == 1)
        ? (isFloor ? max(0.45, 0.065 * zCv * slopeScale) : max(0.22, 0.040 * zCv * slopeScale))
        : (isFloor
            ? max(0.25, 0.045 * zCv * slopeScale)
            : ((uHasBaseMap == 1 || uOutlierRemoval == 1)
                ? max(0.085, 0.024 * zCv * slopeScale)
                : max(0.045, 0.012 * zCv * slopeScale)));
      if (minSignedDiff > tolOccl) {
        return 0.0;
      }

      float tolCliff = (uIsIndicatorPlane == 1)
        ? (isFloor ? max(0.55, 0.080 * zCv * slopeScale) : max(0.32, 0.055 * zCv * slopeScale))
        : (isFloor
            ? max(0.36, 0.062 * zCv * slopeScale)
            : max(0.20, 0.045 * zCv * slopeScale));
      float cliffDiff = zCv - dMin;
      if (cliffDiff > tolCliff) {
        return 0.0;
      }

      wDepth = (1.0 - smoothstep(tolOccl * 0.55, tolOccl, max(0.0, minSignedDiff))) *
               (1.0 - smoothstep(tolCliff * 0.65, tolCliff, max(0.0, cliffDiff)));
    }

    float edgeDist = min(min(uImg, 1.0 - uImg), min(vImg, 1.0 - vImg));
    float wBorder = smoothstep(margin, 0.09, edgeDist);

    float cosAngle = clamp(dot(viewDir, toCam), -1.0, 1.0);
    float wView = exp(8.5 * (cosAngle - 1.0)) / max(1.0 - cosAngle, 0.001) + 0.001;

    float dist = length(uCamPos[idx] - P);
    float wDist = 1.0 / (1.0 + 0.05 * dist * dist);

    outGeomW = wDepth * wNorm * wBorder * wDist;
    outWView = wView;
    return outGeomW * wView;
  }

  vec3 applySceneFog(vec3 col, float viewDist) {
    if (uUseBgTone == 0 || uRenderMode != 1) return col;
    vec3 fogColor = vec3(0.145, 0.190, 0.255); // #253041
    float fogFactor = smoothstep(8.0, 25.0, viewDist) * 0.38;
    return mix(col, fogColor, fogFactor);
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 toViewer = cameraPosition - vWorldPos;
    float viewDist = length(toViewer);
    vec3 viewDir = toViewer / max(viewDist, 1e-6);

    if (uIsIndicatorPlane == 1) {
      if (dot(N, viewDir) <= 0.02) {
        discard;
      }
    }

    if (uRenderMode == 3) {
      if (uIsIndicatorPlane == 1 || uIsEstimatedPlane == 1) {
        discard;
      }
      vec3 diagBase = vec3(0.7216, 0.7686, 0.8157); // #b8c4d0
      vec3 lightDir1 = normalize(vec3(0.38, 0.86, 0.33));
      vec3 lightDir2 = normalize(vec3(-0.45, 0.55, -0.70));
      float ndl = 0.65 * abs(dot(N, lightDir1)) + 0.35 * abs(dot(N, lightDir2));
      float shade = 0.80 + 0.24 * ndl;
      gl_FragColor = vec4(diagBase * shade, 1.0);
      return;
    }

    vec2 worldXY = vec2(vWorldPos.x, -vWorldPos.z);
    vec2 gridCoord = (uIndicatorKind == 0)
      ? worldXY
      : vec2(dot(worldXY, uWallTangentWorldXY), vWorldPos.y);
    vec3 indicatorBaseColor = evalCalmGridColor(gridCoord, uIndicatorCalmColor, viewDist);
    vec3 floorGridAtPos = evalCalmGridColor(worldXY, uFloorCalmColorShared, viewDist);

    vec3 rawOrigColor = (uIsIndicatorPlane == 1) ? indicatorBaseColor : getOriginalBaseColor(N);
    vec3 origColor = rawOrigColor;
    bool isMeshFloor = (uIsIndicatorPlane == 0) && ((vWorldPos.y < 0.18) || (vWorldPos.y < 0.30 && abs(N.y) > 0.40));
    const float FEATHER_COLOR_BAND = 0.11;

    bool earlyReturnUnobs = (uIsIndicatorPlane == 0 && uHasBaseMap == 0 && uProjectUnobserved == 0 && uOutlierRemoval != 1);
    if (uRenderMode == 0 || uIsEstimatedPlane == 1 || earlyReturnUnobs) {
      if (uRenderMode == 2) {
        float luma = dot(origColor, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor = vec4(vec3(luma * 0.35 + 0.08), 1.0);
      } else if (uRenderMode == 1 && uIsEstimatedPlane == 0 && uHasBaseMap == 0) {
        vec3 colOut = origColor;
        if (isMeshFloor) {
          float lum = dot(colOut, vec3(0.2126, 0.7152, 0.0722));
          float darkW = 1.0 - smoothstep(0.18, 0.37, lum);
          colOut = mix(colOut, uIndicatorObsColor * 0.88, darkW * 0.90);
        }
        gl_FragColor = vec4(mix(rawOrigColor, applySceneFog(colOut, viewDist), uVdtStrength), 1.0);
      } else {
        gl_FragColor = vec4(origColor, 1.0);
      }
      return;
    }

    // 걸레받이·하단 수직 벽면(y >= 7.5cm 또는 abs(N.y) <= 0.55)은 제외하고 실제 수평 카펫 바닥만 바닥 기준색으로 보정
    bool isTrueHorizontalFloor = (uIsIndicatorPlane == 0) && (vWorldPos.y < 0.075) && (abs(N.y) > 0.55);
    if (uIsIndicatorPlane == 0 && uEdgeFeather == 1 && uHasBaseMap == 0) {
      if (uOutlierRemoval == 1) {
        if (isTrueHorizontalFloor) {
          vec3 avgGain = (uColorCorrection == 1)
            ? (0.25 * (uCamGain[0] + uCamGain[1] + uCamGain[2] + uCamGain[3]))
            : vec3(1.0);
          vec3 brightFloorRef = clamp(uIndicatorObsColor * avgGain, 0.0, 1.0);
          origColor = brightFloorRef;
          if (uShowFloorLayer == 1 && vBoundaryDist < FEATHER_COLOR_BAND) {
            float tHole = 1.0 - smoothstep(0.0, FEATHER_COLOR_BAND, vBoundaryDist);
            origColor = mix(origColor, floorGridAtPos, tHole * 0.90);
          }
        } else if (uUseBgTone == 1) {
          // 정점색(vColor)에 아틀라스 검은 여백(0,0,0)이 섞여 들어간 모서리가 검은 테두리로 보이지 않도록 중성 회청 톤으로 보정
          float lum = dot(origColor, vec3(0.2126, 0.7152, 0.0722));
          float blackLift = 1.0 - smoothstep(0.05, 0.32, lum);
          origColor = mix(origColor, vec3(0.38, 0.41, 0.46), max(0.35, blackLift * 0.92));
        }
      } else {
        if (isMeshFloor && uShowFloorLayer == 1) {
          origColor = mix(origColor, floorGridAtPos, 0.90);
        } else if (uUseBgTone == 1) {
          origColor = mix(origColor, vec3(0.28, 0.31, 0.36), 0.45);
        }
      }
    }

    vec3 projPos = vWorldPos;
    if (uIsIndicatorPlane == 1) {
      projPos = (uIndicatorKind == 0)
        ? (vWorldPos + vec3(0.0, 0.061, 0.0))
        : (vWorldPos + N * 0.018);
    }

    vec2 uv0, uv1, uv2, uv3;
    float geomW0, geomW1, geomW2, geomW3;
    float wView0, wView1, wView2, wView3;
    float w0 = evaluateCameraWeight(0, projPos, N, viewDir, uv0, geomW0, wView0);
    float w1 = evaluateCameraWeight(1, projPos, N, viewDir, uv1, geomW1, wView1);
    float w2 = evaluateCameraWeight(2, projPos, N, viewDir, uv2, geomW2, wView2);
    float w3 = evaluateCameraWeight(3, projPos, N, viewDir, uv3, geomW3, wView3);

    float rawSw0 = max(max(w0, w1), max(w2, w3));
    float unobsConsensusGate = 1.0;

    bool v0 = (geomW0 > 0.002);
    bool v1 = (geomW1 > 0.002);
    bool v2 = (geomW2 > 0.002);
    bool v3 = (geomW3 > 0.002);
    if (!v0) { w0 = 0.0; geomW0 = 0.0; wView0 = 0.0; }
    if (!v1) { w1 = 0.0; geomW1 = 0.0; wView1 = 0.0; }
    if (!v2) { w2 = 0.0; geomW2 = 0.0; wView2 = 0.0; }
    if (!v3) { w3 = 0.0; geomW3 = 0.0; wView3 = 0.0; }

    vec3 c0 = v0 ? readCamPhoto(0, uv0) : vec3(0.0);
    vec3 c1 = v1 ? readCamPhoto(1, uv1) : vec3(0.0);
    vec3 c2 = v2 ? readCamPhoto(2, uv2) : vec3(0.0);
    vec3 c3 = v3 ? readCamPhoto(3, uv3) : vec3(0.0);

    // -----------------------------------------------------------------------
    // 5차 (uOutlierRemoval == 1):
    // - 완화된 σ (바닥 0.095, 비바닥 0.22) + 인라이어 불감대(deadzone 0.042 / 0.065)
    // - 외톨이를 버릴 때 가중치를 0 으로 끊지 않고 최소 바닥값(0.08) 위로 부드럽게 감쇠하며,
    //   시점 가중치(wView)를 비선형 왜곡하지 않아 후보 수가 1대로 줄어도 가중치가 튀지 않게 함
    // - 5-tap 공간 저역통과(readCamPhotoLowPass) 색상과 연속 소프트 메도이드(soft-medoid) 가중 평균으로
    //   기준(refLab)을 구해 픽셀마다 선택 카메라가 바뀌어 생기는 얼룩을 원천 제거
    // -----------------------------------------------------------------------
    if (uOutlierRemoval == 1) {
      float p0 = smoothstep(0.002, 0.025, geomW0);
      float p1 = smoothstep(0.002, 0.025, geomW1);
      float p2 = smoothstep(0.002, 0.025, geomW2);
      float p3 = smoothstep(0.002, 0.025, geomW3);

      vec3 lab0 = v0 ? srgbToOklab(readCamPhotoLowPass(0, uv0)) : vec3(0.0);
      vec3 lab1 = v1 ? srgbToOklab(readCamPhotoLowPass(1, uv1)) : vec3(0.0);
      vec3 lab2 = v2 ? srgbToOklab(readCamPhotoLowPass(2, uv2)) : vec3(0.0);
      vec3 lab3 = v3 ? srgbToOklab(readCamPhotoLowPass(3, uv3)) : vec3(0.0);

      // 수평 바닥 면(걸레받이·하단 벽면 제외: y < 7.5cm & 법선 상향)만 카펫 합의 대상으로 지정
      bool isFloorTarget = isTrueHorizontalFloor || (uIsIndicatorPlane == 1 && uIndicatorKind == 0);

      // 후보 카메라들의 기하 가중 평균 노출 게인
      float gSum = geomW0 + geomW1 + geomW2 + geomW3;
      vec3 avgGain = (uColorCorrection == 1)
        ? ((gSum > 1e-4)
            ? ((geomW0 * uCamGain[0] + geomW1 * uCamGain[1] + geomW2 * uCamGain[2] + geomW3 * uCamGain[3]) / gSum)
            : (0.25 * (uCamGain[0] + uCamGain[1] + uCamGain[2] + uCamGain[3])))
        : vec3(1.0);

      vec3 floorObsGainRgb = clamp(uIndicatorObsColor * avgGain, 0.0, 1.0);
      vec3 floorObsLab = srgbToOklab(floorObsGainRgb);

      vec3 corrOrigRgb = (uHasBaseMap == 1)
        ? clamp(rawOrigColor * avgGain, 0.0, 1.0)
        : origColor;

      // 바닥 면에서는 uHasBaseMap == 0 과 uHasBaseMap == 1 의 구분 없이 동일한 공간 연속 카펫 기준색(floorObsGainRgb)을
      // 사전 분포(priorRgb)로 사용하여, 두 메시 경계나 UV 아틀라스 차트 경계에서 색상/가중치 단차가 전혀 생기지 않게 한다.
      vec3 priorRgb = isFloorTarget ? floorObsGainRgb : corrOrigRgb;
      vec3 thirdVoteLab = isFloorTarget ? floorObsLab : srgbToOklab(priorRgb);

      // 비바닥(벽·액자·간판)의 구운 텍스처 UV 미세 오차 허용을 위한 5-tap 최소 거리
      vec2 baseUvStep = (uHasBaseMap == 1 && !isFloorTarget) ? clamp(fwidth(vUv) * 2.2, vec2(0.0005), vec2(0.006)) : vec2(0.0);
      vec3 thirdLabxp = (uHasBaseMap == 1 && !isFloorTarget) ? srgbToOklab(clamp(texture2D(uBaseMap, vUv + vec2(baseUvStep.x, 0.0)).rgb * avgGain, 0.0, 1.0)) : thirdVoteLab;
      vec3 thirdLabxm = (uHasBaseMap == 1 && !isFloorTarget) ? srgbToOklab(clamp(texture2D(uBaseMap, vUv - vec2(baseUvStep.x, 0.0)).rgb * avgGain, 0.0, 1.0)) : thirdVoteLab;
      vec3 thirdLabyp = (uHasBaseMap == 1 && !isFloorTarget) ? srgbToOklab(clamp(texture2D(uBaseMap, vUv + vec2(0.0, baseUvStep.y)).rgb * avgGain, 0.0, 1.0)) : thirdVoteLab;
      vec3 thirdLabym = (uHasBaseMap == 1 && !isFloorTarget) ? srgbToOklab(clamp(texture2D(uBaseMap, vUv - vec2(0.0, baseUvStep.y)).rgb * avgGain, 0.0, 1.0)) : thirdVoteLab;

      float db0 = v0 ? min(length(lab0 - thirdVoteLab), min(min(length(lab0 - thirdLabxp), length(lab0 - thirdLabxm)), min(length(lab0 - thirdLabyp), length(lab0 - thirdLabym)))) : 0.0;
      float db1 = v1 ? min(length(lab1 - thirdVoteLab), min(min(length(lab1 - thirdLabxp), length(lab1 - thirdLabxm)), min(length(lab1 - thirdLabyp), length(lab1 - thirdLabym)))) : 0.0;
      float db2 = v2 ? min(length(lab2 - thirdVoteLab), min(min(length(lab2 - thirdLabxp), length(lab2 - thirdLabxm)), min(length(lab2 - thirdLabyp), length(lab2 - thirdLabym)))) : 0.0;
      float db3 = v3 ? min(length(lab3 - thirdVoteLab), min(min(length(lab3 - thirdLabxp), length(lab3 - thirdLabxm)), min(length(lab3 - thirdLabyp), length(lab3 - thirdLabym)))) : 0.0;

      // 바닥에서 검은 스툴/탁자 다리 잔상(강한 암부: L 이 카펫 기준보다 0.055 이상 어두움)과
      // 고채도 전경 오투영(빨간 전선·청록색 스툴 좌석: 채도 차이가 0.038 이상)에만 연속 소프트 페널티 부여
      float carpetPen0 = 0.0, carpetPen1 = 0.0, carpetPen2 = 0.0, carpetPen3 = 0.0;
      if (isFloorTarget) {
        carpetPen0 = max(0.0, (thirdVoteLab.x - 0.055) - lab0.x) * 2.10 +
                     max(0.0, length(lab0.yz - thirdVoteLab.yz) - 0.038) * 2.40;
        carpetPen1 = max(0.0, (thirdVoteLab.x - 0.055) - lab1.x) * 2.10 +
                     max(0.0, length(lab1.yz - thirdVoteLab.yz) - 0.038) * 2.40;
        carpetPen2 = max(0.0, (thirdVoteLab.x - 0.055) - lab2.x) * 2.10 +
                     max(0.0, length(lab2.yz - thirdVoteLab.yz) - 0.038) * 2.40;
        carpetPen3 = max(0.0, (thirdVoteLab.x - 0.055) - lab3.x) * 2.10 +
                     max(0.0, length(lab3.yz - thirdVoteLab.yz) - 0.038) * 2.40;
        db0 += carpetPen0;
        db1 += carpetPen1;
        db2 += carpetPen2;
        db3 += carpetPen3;
      }

      float d01 = (v0 && v1) ? length(lab0 - lab1) : 0.0;
      float d02 = (v0 && v2) ? length(lab0 - lab2) : 0.0;
      float d03 = (v0 && v3) ? length(lab0 - lab3) : 0.0;
      float d12 = (v1 && v2) ? length(lab1 - lab2) : 0.0;
      float d13 = (v1 && v3) ? length(lab1 - lab3) : 0.0;
      float d23 = (v2 && v3) ? length(lab2 - lab3) : 0.0;

      // 이산 분기(if sum1 < bestSum) 없이 모든 후보 수(4, 3, 2, 1대)에서 연속적으로 작동하는 소프트 메도이드 합의(refLab)
      float tieW = isFloorTarget ? 0.65 : 0.25;
      float s0 = v0 ? ((p1 * d01 + p2 * d02 + p3 * d03 + tieW * db0) / (p1 + p2 + p3 + tieW)) : 10.0;
      float s1 = v1 ? ((p0 * d01 + p2 * d12 + p3 * d13 + tieW * db1) / (p0 + p2 + p3 + tieW)) : 10.0;
      float s2 = v2 ? ((p0 * d02 + p1 * d12 + p3 * d23 + tieW * db2) / (p0 + p1 + p3 + tieW)) : 10.0;
      float s3 = v3 ? ((p0 * d03 + p1 * d13 + p2 * d23 + tieW * db3) / (p0 + p1 + p2 + tieW)) : 10.0;

      float temp = isFloorTarget ? 0.080 : 0.135;
      float m0 = p0 * exp(-s0 / temp);
      float m1 = p1 * exp(-s1 / temp);
      float m2 = p2 * exp(-s2 / temp);
      float m3 = p3 * exp(-s3 / temp);
      float priorM = isFloorTarget ? 0.060 : 0.020;

      vec3 refLab = (m0 * lab0 + m1 * lab1 + m2 * lab2 + m3 * lab3 + priorM * thirdVoteLab) /
                    max(m0 + m1 + m2 + m3 + priorM, 1e-5);

      // 5차 완화된 σ (바닥 0.095, 비바닥 0.22) 및 인라이어 불감대(deadzone)
      float sigma5 = isFloorTarget ? 0.095 : 0.220;
      float deadzone = isFloorTarget ? 0.042 : 0.065;
      float minWeightFactor = 0.08;

      float dist0 = v0 ? (length(lab0 - refLab) + carpetPen0 * 0.75) : 0.0;
      float dist1 = v1 ? (length(lab1 - refLab) + carpetPen1 * 0.75) : 0.0;
      float dist2 = v2 ? (length(lab2 - refLab) + carpetPen2 * 0.75) : 0.0;
      float dist3 = v3 ? (length(lab3 - refLab) + carpetPen3 * 0.75) : 0.0;

      float dn0 = max(0.0, dist0 - deadzone) / sigma5;
      float dn1 = max(0.0, dist1 - deadzone) / sigma5;
      float dn2 = max(0.0, dist2 - deadzone) / sigma5;
      float dn3 = max(0.0, dist3 - deadzone) / sigma5;

      float a0 = v0 ? mix(minWeightFactor, 1.0, exp(-dn0 * dn0)) : 0.0;
      float a1 = v1 ? mix(minWeightFactor, 1.0, exp(-dn1 * dn1)) : 0.0;
      float a2 = v2 ? mix(minWeightFactor, 1.0, exp(-dn2 * dn2)) : 0.0;
      float a3 = v3 ? mix(minWeightFactor, 1.0, exp(-dn3 * dn3)) : 0.0;

      w0 *= a0;
      w1 *= a1;
      w2 *= a2;
      w3 *= a3;

      if (isFloorTarget) {
        float cw0 = m0 * a0 * a0;
        float cw1 = m1 * a1 * a1;
        float cw2 = m2 * a2 * a2;
        float cw3 = m3 * a3 * a3;
        float cwPrior = 0.008;
        vec3 consensusRgb = (cw0 * c0 + cw1 * c1 + cw2 * c2 + cw3 * c3 + cwPrior * priorRgb) /
                            max(cw0 + cw1 + cw2 + cw3 + cwPrior, 1e-5);
        c0 = mix(consensusRgb, c0, smoothstep(0.12, 0.70, a0));
        c1 = mix(consensusRgb, c1, smoothstep(0.12, 0.70, a1));
        c2 = mix(consensusRgb, c2, smoothstep(0.12, 0.70, a2));
        c3 = mix(consensusRgb, c3, smoothstep(0.12, 0.70, a3));
        origColor = consensusRgb;
      }

      if (uIsIndicatorPlane == 0 && uHasBaseMap == 0 && uProjectUnobserved == 0 && !isMeshFloor) {
        float sumInlierGeomW = geomW0 * a0 + geomW1 * a1 + geomW2 * a2 + geomW3 * a3;
        unobsConsensusGate = smoothstep(0.018, 0.075, sumInlierGeomW);
      }
    }

    float sw0 = w0, sw1 = w1, sw2 = w2, sw3 = w3;
    float tmp;
    if (sw0 < sw1) { tmp = sw0; sw0 = sw1; sw1 = tmp; }
    if (sw2 < sw3) { tmp = sw2; sw2 = sw3; sw3 = tmp; }
    if (sw0 < sw2) { tmp = sw0; sw0 = sw2; sw2 = tmp; }
    if (sw1 < sw3) { tmp = sw1; sw1 = sw3; sw3 = tmp; }
    if (sw1 < sw2) { tmp = sw1; sw1 = sw2; sw2 = tmp; }

    float kThreshold = (uTopK <= 2) ? sw2 : sw3;
    float threshold = max(kThreshold, sw0 * 0.14);
    float tw0 = max(0.0, w0 - threshold);
    float tw1 = max(0.0, w1 - threshold);
    float tw2 = max(0.0, w2 - threshold);
    float tw3 = max(0.0, w3 - threshold);

    float sumW = tw0 + tw1 + tw2 + tw3;
    if (sumW <= 1e-6) {
      tw0 = w0; tw1 = w1; tw2 = w2; tw3 = w3;
      sumW = tw0 + tw1 + tw2 + tw3;
    }

    if (sumW <= 1e-6) {
      if (uRenderMode == 2) {
        float luma = dot(origColor, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor = vec4(vec3(luma * 0.35 + 0.08), 1.0);
      } else {
        vec3 fallbackCol = origColor;
        if (uIsIndicatorPlane == 0 && uEdgeFeather == 1 && vBoundaryDist < FEATHER_COLOR_BAND) {
          float tCol = smoothstep(0.0, FEATHER_COLOR_BAND, vBoundaryDist);
          if (isMeshFloor && uShowFloorLayer == 1) {
            fallbackCol = mix(floorGridAtPos, fallbackCol, tCol);
          } else {
            fallbackCol = mix(vec3(0.157, 0.204, 0.271), fallbackCol, tCol);
          }
        }
        gl_FragColor = vec4(mix(rawOrigColor, applySceneFog(fallbackCol, viewDist), uVdtStrength), 1.0);
      }
      return;
    }

    float nw0 = tw0 / sumW;
    float nw1 = tw1 / sumW;
    float nw2 = tw2 / sumW;
    float nw3 = tw3 / sumW;

    if (uRenderMode == 2) {
      vec3 weightCol = nw0 * uCamVisColor[0] + nw1 * uCamVisColor[1] + nw2 * uCamVisColor[2] + nw3 * uCamVisColor[3];
      float luma = dot(origColor, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(mix(weightCol, vec3(luma), 0.22), 1.0);
      return;
    }

    vec3 vdtColor = nw0 * c0 + nw1 * c1 + nw2 * c2 + nw3 * c3;
    float rawConfidence = clamp(rawSw0 * 25.0, 0.0, 1.0);
    float confidence;
    if (uOutlierRemoval == 1 && uIsIndicatorPlane == 0) {
      confidence = rawConfidence * unobsConsensusGate;
    } else {
      confidence = clamp(sw0 * 25.0, 0.0, 1.0);
    }

    vec3 finalColor = mix(origColor, vdtColor, confidence);

    if (uIsIndicatorPlane == 0 && uEdgeFeather == 1 && vBoundaryDist < FEATHER_COLOR_BAND) {
      float tFeather = smoothstep(0.0, FEATHER_COLOR_BAND, vBoundaryDist);
      vec3 edgeTarget = finalColor;
      if (isMeshFloor) {
        edgeTarget = (uShowFloorLayer == 1)
          ? ((uIndicatorDepthMatch == 1) ? mix(floorGridAtPos, finalColor, 0.15) : mix(floorGridAtPos, vdtColor, confidence))
          : vec3(0.157, 0.204, 0.271);
      } else if (vWorldPos.y > 2.15 || (uShowWallLayer == 0 && vWorldPos.y > 0.30)) {
        edgeTarget = mix(vec3(0.157, 0.204, 0.271), finalColor, 0.30);
      } else {
        edgeTarget = mix(origColor, finalColor, 0.50);
      }
      finalColor = mix(edgeTarget, finalColor, tFeather);
    }

    finalColor = applySceneFog(finalColor, viewDist);
    gl_FragColor = vec4(mix(rawOrigColor, finalColor, uVdtStrength), 1.0);
  }
`;

/**
 * UV 아틀라스 경계에서 분리된 정점들을 6cm 격자로 묶어 거시적 표면 법선을 구하고 원래 정점 법선과 섞는다.
 */
export function computeWeldedSmoothNormals(meshes: readonly THREE.Mesh[]): void {
  const gridSum = new Map<string, [number, number, number]>();
  const cell = 0.06;

  for (const node of meshes) {
    if (!node.geometry.attributes.normal) {
      node.geometry.computeVertexNormals();
    }
    const pos = node.geometry.attributes.position;
    const norm = node.geometry.attributes.normal;
    if (!pos || !norm) continue;
    for (let i = 0; i < pos.count; i++) {
      const kx = Math.round(pos.getX(i) / cell);
      const ky = Math.round(pos.getY(i) / cell);
      const kz = Math.round(pos.getZ(i) / cell);
      const key = `${kx},${ky},${kz}`;
      let acc = gridSum.get(key);
      if (!acc) {
        acc = [0, 0, 0];
        gridSum.set(key, acc);
      }
      acc[0] += norm.getX(i);
      acc[1] += norm.getY(i);
      acc[2] += norm.getZ(i);
    }
  }

  for (const node of meshes) {
    const pos = node.geometry.attributes.position;
    const norm = node.geometry.attributes.normal;
    if (!pos || !norm) continue;
    for (let i = 0; i < pos.count; i++) {
      const kx = Math.round(pos.getX(i) / cell);
      const ky = Math.round(pos.getY(i) / cell);
      const kz = Math.round(pos.getZ(i) / cell);
      const acc = gridSum.get(`${kx},${ky},${kz}`);
      if (acc) {
        const len = Math.hypot(acc[0], acc[1], acc[2]);
        if (len > 1e-6) {
          const sx = acc[0] / len;
          const sy = acc[1] / len;
          const sz = acc[2] / len;
          const ox = norm.getX(i);
          const oy = norm.getY(i);
          const oz = norm.getZ(i);
          const mx = ox * 0.3 + sx * 0.7;
          const my = oy * 0.3 + sy * 0.7;
          const mz = oz * 0.3 + sz * 0.7;
          const mlen = Math.hypot(mx, my, mz) || 1.0;
          norm.setXYZ(i, mx / mlen, my / mlen, mz / mlen);
        }
      }
    }
    norm.needsUpdate = true;
  }
}

/**
 * 1mm 공간 해시 용접 기준 공유 삼각형이 1개인 열린 경계 모서리까지의 거리 `aBoundaryDist`(최대 0.12m)를 계산해 바인딩한다.
 */
export function computeOpenBoundaryDistances(meshes: readonly THREE.Mesh[]): {
  openEdges: number;
  boundaryVertices: number;
} {
  const weldMap = new Map<string, number>();
  const weldedCoords: [number, number, number][] = [];

  function getWeldedId(x: number, y: number, z: number): number {
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
    let id = weldMap.get(key);
    if (id === undefined) {
      id = weldedCoords.length;
      weldMap.set(key, id);
      weldedCoords.push([x, y, z]);
    }
    return id;
  }

  const edgeCounts = new Map<string, number>();
  const meshVertexWeldedIds: Int32Array[] = [];

  for (const node of meshes) {
    const pos = node.geometry.attributes.position;
    if (!pos) {
      meshVertexWeldedIds.push(new Int32Array(0));
      continue;
    }
    const vIds = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      vIds[i] = getWeldedId(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    meshVertexWeldedIds.push(vIds);

    const idxAttr = node.geometry.index;
    const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(pos.count / 3);
    for (let t = 0; t < triCount; t++) {
      const i0 = idxAttr ? idxAttr.getX(t * 3) : t * 3;
      const i1 = idxAttr ? idxAttr.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idxAttr ? idxAttr.getX(t * 3 + 2) : t * 3 + 2;
      const w0 = vIds[i0]!;
      const w1 = vIds[i1]!;
      const w2 = vIds[i2]!;
      if (w0 === w1 || w1 === w2 || w2 === w0) continue;

      const edges = [
        w0 < w1 ? `${w0}_${w1}` : `${w1}_${w0}`,
        w1 < w2 ? `${w1}_${w2}` : `${w2}_${w1}`,
        w2 < w0 ? `${w2}_${w0}` : `${w0}_${w2}`,
      ];
      for (const ek of edges) {
        edgeCounts.set(ek, (edgeCounts.get(ek) ?? 0) + 1);
      }
    }
  }

  const samplePts: [number, number, number][] = [];
  const isBoundaryVertex = new Uint8Array(weldedCoords.length);
  let openEdgeCount = 0;

  for (const [ek, cnt] of edgeCounts.entries()) {
    if (cnt !== 1) continue;
    openEdgeCount++;
    const sep = ek.indexOf('_');
    const a = Number.parseInt(ek.slice(0, sep), 10);
    const b = Number.parseInt(ek.slice(sep + 1), 10);
    const pa = weldedCoords[a]!;
    const pb = weldedCoords[b]!;
    if (!isBoundaryVertex[a]) {
      isBoundaryVertex[a] = 1;
      samplePts.push(pa);
    }
    if (!isBoundaryVertex[b]) {
      isBoundaryVertex[b] = 1;
      samplePts.push(pb);
    }
    samplePts.push([(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5]);
  }

  const cell = 0.08;
  const buckets = new Map<string, [number, number, number][]>();
  for (const p of samplePts) {
    const bx = Math.floor(p[0] / cell);
    const by = Math.floor(p[1] / cell);
    const bz = Math.floor(p[2] / cell);
    const bKey = `${bx},${by},${bz}`;
    let list = buckets.get(bKey);
    if (!list) {
      list = [];
      buckets.set(bKey, list);
    }
    list.push(p);
  }

  const maxDist = 0.12;
  const maxDistSq = maxDist * maxDist;
  const weldedDist = new Float32Array(weldedCoords.length);

  for (let w = 0; w < weldedCoords.length; w++) {
    if (isBoundaryVertex[w]) {
      weldedDist[w] = 0.0;
      continue;
    }
    const p = weldedCoords[w]!;
    const bx0 = Math.floor(p[0] / cell);
    const by0 = Math.floor(p[1] / cell);
    const bz0 = Math.floor(p[2] / cell);
    let bestSq = maxDistSq;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = buckets.get(`${bx0 + dx},${by0 + dy},${bz0 + dz}`);
          if (!list) continue;
          for (const q of list) {
            const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
            if (d2 < bestSq) bestSq = d2;
          }
        }
      }
    }
    weldedDist[w] = Math.sqrt(bestSq);
  }

  for (let mIdx = 0; mIdx < meshes.length; mIdx++) {
    const node = meshes[mIdx]!;
    const pos = node.geometry.attributes.position;
    if (!pos) continue;
    const vIds = meshVertexWeldedIds[mIdx]!;
    const distArr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      distArr[i] = weldedDist[vIds[i]!]!;
    }
    node.geometry.setAttribute('aBoundaryDist', new THREE.BufferAttribute(distArr, 1));
  }

  let bVertCount = 0;
  for (let i = 0; i < isBoundaryVertex.length; i++) {
    bVertCount += isBoundaryVertex[i]!;
  }
  return { openEdges: openEdgeCount, boundaryVertices: bVertCount };
}

function loadSingleTextureNoColorSpace(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.NoColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

export async function loadVdtCameraTextures(urls: readonly string[]): Promise<THREE.Texture[]> {
  return Promise.all(urls.map((u) => loadSingleTextureNoColorSpace(u)));
}

export interface BakedShadowMaps {
  renderTargets: THREE.WebGLRenderTarget[];
  shadowTexelSize: THREE.Vector2;
  dispose(): void;
}

/**
 * 4대 카메라 시점의 정적 깊이 그림자 맵을 1회 렌더링한다.
 * 장면과 카메라가 정적이므로 장면 GLB 또는 카메라 파라미터·해상도가 바뀔 때만 호출한다.
 */
export function bakeVdtShadowMaps(
  gl: THREE.WebGLRenderer,
  shadowMeshes: readonly THREE.Mesh[],
  camerasThree: readonly VdtCameraThree[],
  shadowLongSide = 1536,
  farM = 25.0,
): BakedShadowMaps {
  const firstCam = camerasThree[0];
  const aspect = firstCam ? firstCam.imageSize[1] / Math.max(1, firstCam.imageSize[0]) : 9 / 16;
  const w = Math.max(64, Math.round(shadowLongSide));
  const h = Math.max(64, Math.round(w * aspect));
  const shadowTexelSize = new THREE.Vector2(1.0 / w, 1.0 / h);

  const depthMat = new THREE.ShaderMaterial({
    vertexShader: vdtDepthVertexShader,
    fragmentShader: vdtDepthFragmentShader,
    uniforms: { uFar: { value: farM } },
    side: THREE.DoubleSide,
  });

  const shadowScene = new THREE.Scene();
  shadowScene.background = new THREE.Color(0xffffff);
  for (const srcMesh of shadowMeshes) {
    srcMesh.updateWorldMatrix(true, false);
    const m = new THREE.Mesh(srcMesh.geometry, depthMat);
    m.matrixAutoUpdate = false;
    m.matrix.copy(srcMesh.matrixWorld);
    m.matrixWorld.copy(srcMesh.matrixWorld);
    shadowScene.add(m);
  }

  const canRenderToTarget =
    typeof gl.getRenderTarget === 'function' &&
    typeof gl.setRenderTarget === 'function' &&
    typeof gl.getScissorTest === 'function' &&
    typeof gl.getClearColor === 'function';

  const prevTarget = canRenderToTarget ? gl.getRenderTarget() : null;
  const prevScissorTest = canRenderToTarget ? gl.getScissorTest() : false;
  const prevClearColor = canRenderToTarget
    ? gl.getClearColor(new THREE.Color())
    : new THREE.Color();
  const prevClearAlpha = canRenderToTarget ? gl.getClearAlpha() : 1;
  const prevAutoClear = gl.autoClear;

  if (canRenderToTarget) {
    gl.setScissorTest(false);
    gl.autoClear = false;
  }

  const renderTargets: THREE.WebGLRenderTarget[] = [];
  for (let i = 0; i < 4; i++) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    rt.texture.generateMipmaps = false;

    const camThree = camerasThree[i] ?? camerasThree[0];
    if (camThree && canRenderToTarget) {
      const camRig = new THREE.Camera();
      camRig.matrixAutoUpdate = false;
      camRig.matrixWorld.copy(camThree.threeMatrixWorld);
      camRig.matrixWorldInverse.copy(camThree.threeViewMatrix);
      camRig.projectionMatrix.copy(camThree.threeProjectionMatrix);
      camRig.projectionMatrixInverse.copy(camThree.threeProjectionMatrix).invert();

      gl.setRenderTarget(rt);
      gl.setClearColor(0xffffff, 1.0);
      gl.clear(true, true, false);
      gl.render(shadowScene, camRig);
    }
    renderTargets.push(rt);
  }

  if (canRenderToTarget) {
    gl.setRenderTarget(prevTarget);
    gl.setScissorTest(prevScissorTest);
    gl.setClearColor(prevClearColor, prevClearAlpha);
    gl.autoClear = prevAutoClear;
  }
  depthMat.dispose();

  return {
    renderTargets,
    shadowTexelSize,
    dispose() {
      for (const rt of renderTargets) {
        rt.dispose();
      }
    },
  };
}

function createQuadGeometryFromThreeCorners(
  cornersThree: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
  normalThree: THREE.Vector3,
): THREE.BufferGeometry {
  const [c0, c1, c2, c3] = cornersThree;
  const positions = new Float32Array([
    c0.x,
    c0.y,
    c0.z,
    c1.x,
    c1.y,
    c1.z,
    c2.x,
    c2.y,
    c2.z,
    c3.x,
    c3.y,
    c3.z,
  ]);
  const normals = new Float32Array([
    normalThree.x,
    normalThree.y,
    normalThree.z,
    normalThree.x,
    normalThree.y,
    normalThree.z,
    normalThree.x,
    normalThree.y,
    normalThree.z,
    normalThree.x,
    normalThree.y,
    normalThree.z,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex([0, 1, 2, 0, 2, 3]);
  return geom;
}

function renderModeToInt(mode: VdtRenderMode | undefined): number {
  switch (mode) {
    case 'original':
      return 0;
    case 'weights':
      return 2;
    case 'diagnostic':
      return 3;
    case 'vdt':
    default:
      return 1;
  }
}

export function collectVdtMeshes(root: THREE.Object3D): {
  allMeshes: THREE.Mesh[];
  shadowMeshes: THREE.Mesh[];
  estimatedFloorNode: THREE.Mesh | null;
} {
  const allMeshes: THREE.Mesh[] = [];
  const shadowMeshes: THREE.Mesh[] = [];
  let estimatedFloorNode: THREE.Mesh | null = null;

  root.updateWorldMatrix(true, true);
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const origMat = Array.isArray(node.material) ? node.material[0] : node.material;
    const isEstimated =
      node.name === 'estimated_floor_plane' ||
      (origMat && typeof origMat.name === 'string' && origMat.name === 'estimated_floor_plane');
    if (isEstimated) {
      estimatedFloorNode = node;
    } else {
      shadowMeshes.push(node);
    }
    allMeshes.push(node);
  });

  return { allMeshes, shadowMeshes, estimatedFloorNode };
}

export interface MountedVdtScene {
  indicatorGroup: THREE.Group;
  updateOptions(options: ViewerVdtOptions): void;
  /** 원래 구운 색과 VDT 결과를 섞는 비율(0..1, -590 페이드). 1 이면 VDT 그대로다. */
  setStrength(strength: number): void;
  updateShadowMaps(baked: BakedShadowMaps): void;
  dispose(): void;
}

/**
 * 장면 GLB 루트(`root`)에 VDT 셰이더 재질과 바닥·벽 미관측 표시 층을 장착하고,
 * 해제(`dispose()`) 시 원래 `MeshBasicMaterial` / `MeshStandardMaterial` 상태로 완전히 복원한다.
 */
export function mountVdtOnSceneRoot(params: {
  root: THREE.Object3D;
  vdtConfig: SceneVdtConfig;
  camerasThree: readonly VdtCameraThree[];
  cameraTextures: readonly THREE.Texture[];
  bakedShadows: BakedShadowMaps;
  options: ViewerVdtOptions;
  /** 처음 섞는 비율(0..1, 기본 1). 카메라 시점 보기는 0 에서 서서히 올린다(-590). */
  strength?: number;
}): MountedVdtScene {
  const { root, vdtConfig, camerasThree, cameraTextures, bakedShadows, options } = params;
  const { allMeshes, shadowMeshes, estimatedFloorNode } = collectVdtMeshes(root);

  if (!root.userData.__vdtGeomPrepared) {
    computeWeldedSmoothNormals(shadowMeshes);
    computeOpenBoundaryDistances(shadowMeshes);
    root.userData.__vdtGeomPrepared = true;
  }

  const dummyTex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  dummyTex.colorSpace = THREE.NoColorSpace;
  dummyTex.needsUpdate = true;

  const camR = [new THREE.Matrix3(), new THREE.Matrix3(), new THREE.Matrix3(), new THREE.Matrix3()];
  const camT = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const camIntr = [
    new THREE.Vector4(),
    new THREE.Vector4(),
    new THREE.Vector4(),
    new THREE.Vector4(),
  ];
  const camPos = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  const camGain = [
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(1, 1, 1),
  ];

  for (let i = 0; i < 4; i++) {
    const c = camerasThree[i];
    if (!c) continue;
    camR[i]!.copy(c.rThreeToCv);
    camT[i]!.copy(c.tThreeToCv);
    camIntr[i]!.copy(c.normalizedIntrinsics);
    camPos[i]!.copy(c.positionThree);
    camGain[i]!.copy(c.colorGainSrgb);
  }

  const fp = vdtConfig.floorPlane;
  const floorCalm = fp?.calmIndicatorSrgb ?? [0.36, 0.38, 0.43];
  const floorObs = fp?.observedMedianSrgb ?? [0.41, 0.44, 0.49];
  const calmFloorVec = new THREE.Vector3(
    floorCalm[0] * 0.96,
    floorCalm[1] * 0.96,
    floorCalm[2] * 0.96,
  );
  const obsFloorVec = new THREE.Vector3(floorObs[0], floorObs[1], floorObs[2]);

  const sharedUniforms = {
    uRenderMode: { value: renderModeToInt(options.renderMode) },
    uProjectUnobserved: { value: options.projectUnobserved ? 1 : 0 },
    uColorCorrection: { value: options.colorCorrection === false ? 0 : 1 },
    uUseBgTone: { value: options.bgTone === false ? 0 : 1 },
    uShowFloorLayer: { value: options.floorLayer === false ? 0 : 1 },
    uShowWallLayer: { value: options.wallLayer === false ? 0 : 1 },
    uEdgeFeather: { value: options.edgeFeather === false ? 0 : 1 },
    uIndicatorDepthMatch: { value: 1 },
    uUnobsDepthMatch: { value: 1 },
    uOutlierRemoval: { value: options.outlierRemoval === false ? 0 : 1 },
    uColorSigma: { value: vdtConfig.colorSigmaOklab },
    uFeatherPass: { value: 0 },
    uTopK: { value: options.topK ?? 3 },
    uVdtStrength: { value: Math.min(Math.max(params.strength ?? 1, 0), 1) },
    uFar: { value: vdtConfig.farM },
    uShadowTexelSize: { value: bakedShadows.shadowTexelSize.clone() },
    uFloorCalmColorShared: { value: calmFloorVec.clone() },
    uCamTex0: { value: cameraTextures[0] ?? dummyTex },
    uCamTex1: { value: cameraTextures[1] ?? dummyTex },
    uCamTex2: { value: cameraTextures[2] ?? dummyTex },
    uCamTex3: { value: cameraTextures[3] ?? dummyTex },
    uCamDepth0: { value: bakedShadows.renderTargets[0]?.texture ?? dummyTex },
    uCamDepth1: { value: bakedShadows.renderTargets[1]?.texture ?? dummyTex },
    uCamDepth2: { value: bakedShadows.renderTargets[2]?.texture ?? dummyTex },
    uCamDepth3: { value: bakedShadows.renderTargets[3]?.texture ?? dummyTex },
    uCamR: { value: camR },
    uCamT: { value: camT },
    uCamIntr: { value: camIntr },
    uCamPos: { value: camPos },
    uCamGain: { value: camGain },
    uCamVisColor: { value: CAM_VIS_COLORS },
  };

  const createdMaterials: THREE.Material[] = [];
  const createdGeometries: THREE.BufferGeometry[] = [];
  const savedMeshStates: {
    mesh: THREE.Mesh;
    material: THREE.Material | THREE.Material[];
    renderOrder: number;
    visible: boolean;
    baseMap: THREE.Texture | null;
    baseMapColorSpace: THREE.ColorSpace;
  }[] = [];

  for (const mesh of allMeshes) {
    const origMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const baseMap =
      origMat && 'map' in origMat && origMat.map instanceof THREE.Texture ? origMat.map : null;
    const prevColorSpace = (
      baseMap ? baseMap.colorSpace : THREE.SRGBColorSpace
    ) as THREE.ColorSpace;
    savedMeshStates.push({
      mesh,
      material: mesh.material,
      renderOrder: mesh.renderOrder,
      visible: mesh.visible,
      baseMap,
      baseMapColorSpace: prevColorSpace,
    });

    if (baseMap) {
      baseMap.colorSpace = THREE.NoColorSpace;
      baseMap.needsUpdate = true;
    }

    const hasVertexColor = Boolean(mesh.geometry.attributes.color);
    const hasBoundaryDist = Boolean(mesh.geometry.attributes.aBoundaryDist);
    const isEstimatedPlane = mesh === estimatedFloorNode;
    const factorColor =
      origMat && 'color' in origMat && origMat.color instanceof THREE.Color
        ? origMat.color.clone()
        : new THREE.Color(1, 1, 1);

    const defines: Record<string, string> = {};
    if (hasVertexColor) defines.USE_VERTEX_COLOR = '';
    if (hasBoundaryDist) defines.USE_BOUNDARY_DIST = '';
    if (mesh.geometry.attributes.uv) defines.USE_UV_ATTR = '';

    const vdtMat = new THREE.ShaderMaterial({
      name: `vdt_${mesh.name}`,
      defines,
      vertexShader: vdtVertexShader,
      fragmentShader: vdtFragmentShader,
      side: THREE.DoubleSide,
      uniforms: {
        ...sharedUniforms,
        uHasBaseMap: { value: baseMap ? 1 : 0 },
        uHasVertexColor: { value: hasVertexColor ? 1 : 0 },
        uIsEstimatedPlane: { value: isEstimatedPlane ? 1 : 0 },
        uIsIndicatorPlane: { value: 0 },
        uIndicatorKind: { value: 0 },
        uIndicatorCalmColor: { value: calmFloorVec.clone() },
        uIndicatorObsColor: { value: obsFloorVec.clone() },
        uWallTangentWorldXY: { value: new THREE.Vector2(1.0, 0.0) },
        uBaseMap: { value: baseMap ?? dummyTex },
        uBaseFactorLinear: {
          value: new THREE.Vector3(factorColor.r, factorColor.g, factorColor.b),
        },
      },
    });
    createdMaterials.push(vdtMat);
    mesh.material = vdtMat;
    mesh.renderOrder = -10;
  }

  // 표시 층 그룹 구성 (배경 그라데이션 -> 바닥 표시 층 -> 벽 표시 층 -> clearDepth 훅 -> TSDF 본 메시)
  const indicatorGroup = new THREE.Group();
  indicatorGroup.name = 'vdt-indicator-layer';

  const bgGeom = new THREE.PlaneGeometry(2, 2);
  const bgMat = new THREE.ShaderMaterial({
    name: 'vdt_bg_gradient',
    vertexShader: vdtBgVertexShader,
    fragmentShader: vdtBgFragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  createdGeometries.push(bgGeom);
  createdMaterials.push(bgMat);
  const bgQuad = new THREE.Mesh(bgGeom, bgMat);
  bgQuad.name = 'vdt_bg_quad';
  bgQuad.frustumCulled = false;
  bgQuad.renderOrder = -30;
  bgQuad.raycast = noRaycast;
  indicatorGroup.add(bgQuad);

  let floorIndicatorMesh: THREE.Mesh | null = null;
  if (fp) {
    const { cornersThree, normalThree } = convertVdtQuadToThree(fp.cornersWorld, fp.normalWorld);
    const floorGeom = createQuadGeometryFromThreeCorners(cornersThree, normalThree);
    const floorMat = new THREE.ShaderMaterial({
      name: 'vdt_floor_indicator',
      defines: { USE_UV_ATTR: '' },
      vertexShader: vdtVertexShader,
      fragmentShader: vdtFragmentShader,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
      uniforms: {
        ...sharedUniforms,
        uHasBaseMap: { value: 0 },
        uHasVertexColor: { value: 0 },
        uIsEstimatedPlane: { value: 0 },
        uIsIndicatorPlane: { value: 1 },
        uIndicatorKind: { value: 0 },
        uIndicatorCalmColor: { value: calmFloorVec.clone() },
        uIndicatorObsColor: { value: obsFloorVec.clone() },
        uWallTangentWorldXY: { value: new THREE.Vector2(1.0, 0.0) },
        uBaseMap: { value: dummyTex },
        uBaseFactorLinear: { value: calmFloorVec.clone() },
      },
    });
    createdGeometries.push(floorGeom);
    createdMaterials.push(floorMat);
    floorIndicatorMesh = new THREE.Mesh(floorGeom, floorMat);
    floorIndicatorMesh.name = 'vdt_floor_indicator_plane';
    floorIndicatorMesh.renderOrder = -20;
    floorIndicatorMesh.raycast = noRaycast;
    indicatorGroup.add(floorIndicatorMesh);
  }

  const wallIndicatorGroup = new THREE.Group();
  wallIndicatorGroup.name = 'vdt_wall_indicator_group';
  for (const wp of vdtConfig.wallPlanes) {
    const wCalm = wp.calmIndicatorSrgb;
    const wObs = wp.observedMedianSrgb;
    const calmWallVec = new THREE.Vector3(wCalm[0] * 0.92, wCalm[1] * 0.92, wCalm[2] * 0.92);
    const { cornersThree, normalThree } = convertVdtQuadToThree(wp.cornersWorld, wp.normalWorld);
    const wGeom = createQuadGeometryFromThreeCorners(cornersThree, normalThree);
    const wMat = new THREE.ShaderMaterial({
      name: `vdt_${wp.wallId}_indicator`,
      defines: { USE_UV_ATTR: '' },
      vertexShader: vdtVertexShader,
      fragmentShader: vdtFragmentShader,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
      uniforms: {
        ...sharedUniforms,
        uHasBaseMap: { value: 0 },
        uHasVertexColor: { value: 0 },
        uIsEstimatedPlane: { value: 0 },
        uIsIndicatorPlane: { value: 1 },
        uIndicatorKind: { value: 1 },
        uIndicatorCalmColor: { value: calmWallVec },
        uIndicatorObsColor: { value: new THREE.Vector3(wObs[0], wObs[1], wObs[2]) },
        uWallTangentWorldXY: { value: new THREE.Vector2(wp.tWorldXy[0], wp.tWorldXy[1]) },
        uBaseMap: { value: dummyTex },
        uBaseFactorLinear: { value: calmWallVec.clone() },
      },
    });
    createdGeometries.push(wGeom);
    createdMaterials.push(wMat);
    const wMesh = new THREE.Mesh(wGeom, wMat);
    wMesh.name = `vdt_${wp.wallId}`;
    wMesh.renderOrder = -19;
    wMesh.raycast = noRaycast;
    wallIndicatorGroup.add(wMesh);
  }
  indicatorGroup.add(wallIndicatorGroup);

  // 바닥·벽 표시 층(-20, -19) 직후, TSDF 본 메시(-10) 직전에 깊이 버퍼만 비우는 헬퍼 메시.
  // 이로써 오목한 창문 등 TSDF 본 메시가 표시 층에 절대 가려지지 않고,
  // TSDF 본 메시가 기록한 깊이로 PersonLayer·ZoneLayer·GroundShadowLayer 가 정확히 깊이 테스트된다.
  const clearDepthGeom = new THREE.PlaneGeometry(0.001, 0.001);
  const clearDepthMat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
  });
  createdGeometries.push(clearDepthGeom);
  createdMaterials.push(clearDepthMat);
  const clearDepthMesh = new THREE.Mesh(clearDepthGeom, clearDepthMat);
  clearDepthMesh.name = 'vdt_clear_depth_hook';
  clearDepthMesh.frustumCulled = false;
  clearDepthMesh.renderOrder = -15;
  clearDepthMesh.raycast = noRaycast;
  clearDepthMesh.onBeforeRender = (renderer) => {
    renderer.clearDepth();
  };
  indicatorGroup.add(clearDepthMesh);

  function applyVisibilityAndUniforms(opts: ViewerVdtOptions) {
    const modeInt = renderModeToInt(opts.renderMode);
    const showFloor = opts.floorLayer !== false;
    const showWall = opts.wallLayer !== false;
    const useBg = opts.bgTone !== false;

    sharedUniforms.uRenderMode.value = modeInt;
    sharedUniforms.uProjectUnobserved.value = opts.projectUnobserved ? 1 : 0;
    sharedUniforms.uColorCorrection.value = opts.colorCorrection === false ? 0 : 1;
    sharedUniforms.uUseBgTone.value = useBg ? 1 : 0;
    sharedUniforms.uShowFloorLayer.value = showFloor ? 1 : 0;
    sharedUniforms.uShowWallLayer.value = showWall ? 1 : 0;
    sharedUniforms.uEdgeFeather.value = opts.edgeFeather === false ? 0 : 1;
    sharedUniforms.uOutlierRemoval.value = opts.outlierRemoval === false ? 0 : 1;
    sharedUniforms.uTopK.value = opts.topK ?? 3;

    if (estimatedFloorNode) {
      estimatedFloorNode.visible = modeInt === 0;
    }
    bgQuad.visible = modeInt === 1 && useBg;
    if (floorIndicatorMesh) {
      floorIndicatorMesh.visible = modeInt === 1 && showFloor;
    }
    wallIndicatorGroup.visible = modeInt === 1 && showWall;
    clearDepthMesh.visible = modeInt === 1 && (showFloor || showWall || useBg);
  }

  applyVisibilityAndUniforms(options);

  return {
    indicatorGroup,
    updateOptions(nextOpts) {
      applyVisibilityAndUniforms(nextOpts);
    },
    setStrength(strength) {
      sharedUniforms.uVdtStrength.value = Math.min(Math.max(strength, 0), 1);
    },
    updateShadowMaps(nextBaked) {
      sharedUniforms.uShadowTexelSize.value.copy(nextBaked.shadowTexelSize);
      sharedUniforms.uCamDepth0.value = nextBaked.renderTargets[0]?.texture ?? dummyTex;
      sharedUniforms.uCamDepth1.value = nextBaked.renderTargets[1]?.texture ?? dummyTex;
      sharedUniforms.uCamDepth2.value = nextBaked.renderTargets[2]?.texture ?? dummyTex;
      sharedUniforms.uCamDepth3.value = nextBaked.renderTargets[3]?.texture ?? dummyTex;
    },
    dispose() {
      for (const saved of savedMeshStates) {
        saved.mesh.material = saved.material;
        saved.mesh.renderOrder = saved.renderOrder;
        saved.mesh.visible = saved.visible;
        if (saved.baseMap) {
          saved.baseMap.colorSpace = saved.baseMapColorSpace;
          saved.baseMap.needsUpdate = true;
        }
      }
      for (const m of createdMaterials) {
        m.dispose();
      }
      for (const g of createdGeometries) {
        g.dispose();
      }
      dummyTex.dispose();
    },
  };
}
