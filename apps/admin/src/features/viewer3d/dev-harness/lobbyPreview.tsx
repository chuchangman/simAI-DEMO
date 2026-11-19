import {
  convertVdtCameraToThree,
  convertVdtFreeViewToThree,
  parseExperimentVdtDocs,
} from '@/features/viewer3d/scene/vdtMath';
import type { SceneVdtConfig } from '@/features/viewer3d/scene/vdtTypes';
import { worldPoint, worldToThree } from '@/features/viewer3d/worldCoordinates';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PerspectiveCamera } from 'three';

// 실측 로비 재구성 프리뷰(-59 개발 검수) 및 시점 의존 텍스처(-534 VDT) 개발 하네스 헬퍼.
// 로컬 자산은 node_modules/.cache/spatial-dev 아래에 두어 Git 저장소에 대용량 파일이 커밋되지 않게 한다.

export const DEV_LOBBY_GLB_URL = '/node_modules/.cache/spatial-dev/lobby-preview.glb';
export const DEV_LOBBY_META_URL = '/node_modules/.cache/spatial-dev/lobby-preview.json';

export const DEV_VDT_BASE_URL = '/node_modules/.cache/spatial-dev/vdt';
export const DEV_VDT_GLB_URL = `${DEV_VDT_BASE_URL}/current-scene-textured.glb`;
export const DEV_VDT_CAMERAS_URL = `${DEV_VDT_BASE_URL}/cameras.json`;
export const DEV_VDT_WALLS_URL = `${DEV_VDT_BASE_URL}/walls.json`;

export interface DevCameraPose {
  /** World 위치(m). */
  position: [number, number, number];
  /** 보는 방향 단위 벡터(World). */
  forward: [number, number, number];
  /** 세로 화각(도). */
  fovYDeg: number;
}

/** ?camPose=cam_A 처럼 고른 카메라. 없으면 null. */
export function readCamPose(search: string): string | null {
  const v = new URLSearchParams(search).get('camPose');
  return v && /^[A-Za-z0-9_-]{1,32}$/.test(v) ? v : null;
}

/** ?vdt=on|1|true 여부(기본 false). */
export function readVdtParam(search: string): boolean {
  const v = new URLSearchParams(search).get('vdt')?.toLowerCase();
  return v === 'on' || v === '1' || v === 'true';
}

export function withVdtParam(href: string, enabled: boolean): string {
  const url = new URL(href);
  if (enabled) url.searchParams.set('vdt', 'on');
  else url.searchParams.delete('vdt');
  return url.toString();
}

/** ?vdtView=obl2|obl3|top|obl1|cam_A~D 시점 파라미터. */
export function readVdtViewParam(search: string): string | null {
  const v = new URLSearchParams(search).get('vdtView');
  return v && /^[A-Za-z0-9_-]{1,32}$/.test(v) ? v : null;
}

export function withVdtViewParam(href: string, viewKey: string | null): string {
  const url = new URL(href);
  if (viewKey) url.searchParams.set('vdtView', viewKey);
  else url.searchParams.delete('vdtView');
  return url.toString();
}

/** 메타 JSON 의 cameras[camId]. 없거나 형식이 틀리면 null. */
export function useDevCameraPose(camId: string | null): DevCameraPose | null {
  const [pose, setPose] = useState<DevCameraPose | null>(null);
  useEffect(() => {
    if (!camId) return;
    let alive = true;
    void fetch(DEV_LOBBY_META_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((meta: { cameras?: Record<string, DevCameraPose> } | null) => {
        const p = meta?.cameras?.[camId];
        if (alive && p && p.position.length === 3 && p.forward.length === 3) setPose(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [camId]);
  return camId ? pose : null;
}

/** 12차 VDT 실험 데이터(`cameras.json` + `walls.json`)를 읽어 정본 World 기준 `SceneVdtConfig` 로 반환한다. */
export function useDevVdtConfig(active: boolean): SceneVdtConfig | null {
  const [config, setConfig] = useState<SceneVdtConfig | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const baseAbs = new URL(DEV_VDT_BASE_URL, window.location.href).href;
    Promise.all([
      fetch(DEV_VDT_CAMERAS_URL).then((r) => (r.ok ? r.json() : null)),
      fetch(DEV_VDT_WALLS_URL)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([camDoc, wallDoc]) => {
        if (!alive || !camDoc) return;
        const parsed = parseExperimentVdtDocs(camDoc, wallDoc, baseAbs);
        if (parsed) setConfig(parsed);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [active]);
  return active ? config : null;
}

interface OrbitLike {
  target: { set(x: number, y: number, z: number): void };
  enableDamping?: boolean;
  update(): void;
}

const COMPARE_NEAR_M = 0.8;

/** Canvas 안에서 카메라를 그 자세로 옮긴다(회전 중심은 보는 방향 3 m 앞). 한 번만 적용하고 이후 조작은 자유다. */
export function DevCameraPoseApplier({ pose }: { pose: DevCameraPose | null }) {
  const get = useThree((s) => s.get);
  const ready = useThree((s) => s.controls !== null);
  useEffect(() => {
    const controls = get().controls as unknown as OrbitLike | null;
    if (!pose || !ready || !controls) return;
    const camera = get().camera as PerspectiveCamera;
    const [x, y, z] = pose.position;
    const [fx, fy, fz] = pose.forward;
    const p = worldToThree(worldPoint(x, y, z));
    const t = worldToThree(worldPoint(x + 3 * fx, y + 3 * fy, z + 3 * fz));
    camera.position.set(p[0], p[1], p[2]);
    camera.fov = pose.fovYDeg;
    camera.near = COMPARE_NEAR_M;
    camera.updateProjectionMatrix();
    controls.target.set(t[0], t[1], t[2]);
    controls.update();
  }, [pose, ready, get]);
  return null;
}

export interface ViewerVdtHarnessGlobal {
  applyView(viewKey: string): boolean;
  setVdtEnabled(enabled: boolean): void;
  isSceneLoaded(): boolean;
  isVdtMounted(): boolean;
  getFps(): number;
  measureFps(
    frames?: number,
  ): Promise<{ rafFps: number; meanFrameDeltaMs: number; p95FrameDeltaMs: number }>;
}

declare global {
  interface Window {
    __viewerVdtHarness?: ViewerVdtHarnessGlobal;
  }
}

/**
 * -527 실험 페이지와 동일한 시점(`obl1`, `obl2`, `obl3`, `top`, `cam_A`~`cam_D`)으로 Viewer 카메라를 이동시키고,
 * 헤드리스 캡처 및 FPS 측정을 위한 `window.__viewerVdtHarness` 를 노출한다.
 */
export function DevVdtViewApplier({
  vdtConfig,
  viewKey,
  onChangeVdt,
  onChangeViewKey,
}: {
  vdtConfig: SceneVdtConfig | null;
  viewKey: string | null;
  onChangeVdt?: (enabled: boolean) => void;
  onChangeViewKey?: (viewKey: string) => void;
}) {
  const get = useThree((s) => s.get);
  const ready = useThree((s) => s.controls !== null);
  const fpsRef = useRef(60);
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef<number | null>(null);

  useFrame(() => {
    const now = performance.now();
    if (lastFpsTimeRef.current === null) {
      lastFpsTimeRef.current = now;
      return;
    }
    frameCountRef.current += 1;
    const elapsed = now - lastFpsTimeRef.current;
    if (elapsed >= 500) {
      fpsRef.current = Number(((frameCountRef.current * 1000) / elapsed).toFixed(1));
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }
  });

  const applyViewDirect = useCallback(
    (targetKey: string): boolean => {
      const state = get();
      const controls = state.controls as unknown as OrbitLike | null;
      if (!vdtConfig || !controls) return false;
      const camera = state.camera as PerspectiveCamera;
      const prevDamping = controls.enableDamping;
      controls.enableDamping = false;

      const camInput = vdtConfig.cameras.find((c) => c.cameraId === targetKey);
      if (camInput) {
        const camThree = convertVdtCameraToThree(camInput, vdtConfig.nearM, vdtConfig.farM);
        const lookTarget = camThree.positionThree
          .clone()
          .addScaledVector(camThree.forwardThree, 4.5);
        camera.fov = camThree.vfovDeg;
        camera.near = vdtConfig.nearM;
        camera.up.copy(camThree.upThree);
        camera.position.copy(camThree.positionThree);
        controls.target.set(lookTarget.x, lookTarget.y, lookTarget.z);
        camera.updateProjectionMatrix();
        controls.update();
        controls.enableDamping = prevDamping;
        return true;
      }

      const freeInput = vdtConfig.freeViews?.[targetKey];
      if (freeInput) {
        const aspect = state.size.width / Math.max(1, state.size.height);
        const freeThree = convertVdtFreeViewToThree(freeInput, aspect);
        camera.fov = freeThree.vfovDeg;
        camera.near = vdtConfig.nearM;
        camera.up.copy(freeThree.upThree);
        camera.position.copy(freeThree.positionThree);
        controls.target.set(
          freeThree.targetThree.x,
          freeThree.targetThree.y,
          freeThree.targetThree.z,
        );
        camera.updateProjectionMatrix();
        controls.update();
        controls.enableDamping = prevDamping;
        return true;
      }

      controls.enableDamping = prevDamping;
      return false;
    },
    [get, vdtConfig],
  );

  useEffect(() => {
    if (!viewKey || !ready || !vdtConfig) return;
    applyViewDirect(viewKey);
  }, [viewKey, ready, vdtConfig, applyViewDirect]);

  useEffect(() => {
    window.__viewerVdtHarness = {
      applyView: (k: string) => {
        onChangeViewKey?.(k);
        return applyViewDirect(k);
      },
      setVdtEnabled: (enabled: boolean) => {
        onChangeVdt?.(enabled);
      },
      isSceneLoaded: () => Boolean(get().scene.getObjectByName('scene-background-layer')),
      isVdtMounted: () => Boolean(get().scene.getObjectByName('vdt-indicator-layer')),
      getFps: () => fpsRef.current,
      measureFps: (frames = 60) =>
        new Promise((resolve) => {
          const deltas: number[] = [];
          let last = performance.now();
          const start = last;
          let count = 0;
          function tick(now: number) {
            deltas.push(now - last);
            last = now;
            count += 1;
            if (count >= frames) {
              const totalMs = now - start;
              const rafFps = Number(((frames * 1000) / Math.max(totalMs, 1)).toFixed(1));
              deltas.sort((a, b) => a - b);
              const meanFrameDeltaMs = Number(
                (deltas.reduce((s, x) => s + x, 0) / deltas.length).toFixed(2),
              );
              const p95FrameDeltaMs = Number(
                deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * 0.95))]!.toFixed(2),
              );
              resolve({ rafFps, meanFrameDeltaMs, p95FrameDeltaMs });
            } else {
              requestAnimationFrame(tick);
            }
          }
          requestAnimationFrame((t0) => {
            last = t0;
            requestAnimationFrame(tick);
          });
        }),
    };
    return () => {
      delete window.__viewerVdtHarness;
    };
  }, [applyViewDirect, get, onChangeVdt, onChangeViewKey]);

  return null;
}
