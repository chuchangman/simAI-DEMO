import { CameraRig } from '@/features/viewer3d/CameraRig';
import { CameraLayer } from '@/features/viewer3d/cameras/CameraLayer';
import { BoxEditGizmo } from '@/features/viewer3d/editing/BoxEditGizmo';
import { DraftOverlay } from '@/features/viewer3d/editing/DraftOverlay';
import { GizmoController } from '@/features/viewer3d/editing/GizmoController';
import { ObbGizmoController } from '@/features/viewer3d/editing/ObbGizmo';
import { GroundShadowLayer } from '@/features/viewer3d/GroundShadowLayer';
import { PersonLayer } from '@/features/viewer3d/people/PersonLayer';
import { PlannedLayer } from '@/features/viewer3d/planned/PlannedLayer';
import { PostProcessingLayer } from '@/features/viewer3d/PostProcessingLayer';
import { RiskScope } from '@/features/viewer3d/risk/RiskScope';
import { FloorCoverageLayer } from '@/features/viewer3d/scene/FloorCoverageLayer';
import { roomViewOf } from '@/features/viewer3d/scene/roomView';
import { SceneBackground } from '@/features/viewer3d/scene/SceneBackground';
import { SceneBase } from '@/features/viewer3d/SceneBase';
import { WorkSurfaceLayer } from '@/features/viewer3d/surfaces/WorkSurfaceLayer';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import { ZoneLayer } from '@/features/viewer3d/zones/ZoneLayer';
import { DEFAULT_ROOM_LIMIT } from '@/lib/roomLimit';
import { Canvas, useThree } from '@react-three/fiber';
import { memo, useCallback, useEffect, type ReactNode } from 'react';
import { NoToneMapping, SRGBColorSpace } from 'three';

// 처음 시점: 방 가운데를 앞·오른쪽 위에서 내려다본다. 스캔이 들어오면 CameraRig 가 스캔 범위 기준 시점으로 옮긴다.
const DEFAULT_VIEW = roomViewOf(DEFAULT_ROOM_LIMIT);

// 모듈 상수로 둬서 Canvas 가 다시 렌더돼도 카메라·렌더러 설정을 다시 적용하지 않는다.
const CAMERA = { position: DEFAULT_VIEW.home, fov: 50, near: 0.1, far: 500 };
// 사진 텍스처 배경 색이 톤매핑으로 틀어지지 않게 SRGB 출력·NoToneMapping 으로 맞춘다(-360).
export const VIEWER_GL_CONSTRAINTS = {
  antialias: true,
  alpha: true,
  outputColorSpace: SRGBColorSpace,
  toneMapping: NoToneMapping,
} as const;
const DPR: [number, number] = [1, 2];

/**
 * 렌더러 준비와 WebGL 컨텍스트 회수·복구를 상태로 알린다.
 * 준비는 컨텍스트가 살아 있는 채로 렌더러가 실제 프레임을 그린 뒤에만 알린다(복구 이벤트만으로 판단하지 않는다).
 */
function RendererStatus() {
  const store = useViewerStore();
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    const context = gl.getContext();
    const { markReady, markError } = store.getState();
    let frameRequest = 0;

    // three 는 컨텍스트를 잃은 동안 render() 를 건너뛰어 프레임 수가 늘지 않는다.
    const confirmRendered = () => {
      cancelAnimationFrame(frameRequest);
      const start = gl.info.render.frame;
      const check = () => {
        if (context.isContextLost()) return;
        if (gl.info.render.frame > start) markReady();
        else frameRequest = requestAnimationFrame(check);
      };
      frameRequest = requestAnimationFrame(check);
    };
    const handleLost = (event: Event) => {
      // 기본 동작을 막아야 브라우저가 컨텍스트를 돌려준다.
      event.preventDefault();
      cancelAnimationFrame(frameRequest);
      markError({ code: 'CONTEXT_LOST', message: 'WebGL 컨텍스트를 잃었다.' });
    };

    confirmRendered();
    canvas.addEventListener('webglcontextlost', handleLost);
    canvas.addEventListener('webglcontextrestored', confirmRendered);
    return () => {
      cancelAnimationFrame(frameRequest);
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', confirmRendered);
    };
  }, [store, gl]);

  return null;
}

interface ViewerCanvasProps {
  children?: ReactNode;
}

/** 뷰어의 단일 Canvas. 부모 크기를 따라가고, 입력은 Canvas 안에서만 받는다. */
export const ViewerCanvas = memo(function ViewerCanvas({ children }: ViewerCanvasProps) {
  const store = useViewerStore();
  // 빈 곳을 클릭하면 선택을 푼다. 끌어서 시점을 돌린 것은 클릭으로 치지 않는다.
  const handlePointerMissed = useCallback(() => {
    store.getState().clearSelection();
  }, [store]);

  return (
    <Canvas
      camera={CAMERA}
      gl={VIEWER_GL_CONSTRAINTS}
      dpr={DPR}
      flat
      onPointerMissed={handlePointerMissed}
    >
      <RendererStatus />
      <CameraRig />
      <SceneBase />
      {/* 정적 배경 Scene(-59). 같은 깊이 버퍼라 배경 뒤 사람은 가려진다. 클릭은 받지 않는다. */}
      <SceneBackground />
      {/* 바닥 감시 범위(-606). 호스트가 켜고 지금 보정에 맞을 때만 넘긴다. 클릭을 받지 않는다. */}
      <FloorCoverageLayer />
      {/* 접지 확인(VALID) 인원 발아래 접지 그림자(-360). people/ 와 분리된 별도 레이어다. */}
      <GroundShadowLayer />
      <RiskScope>
        <ZoneLayer />
        <PersonLayer />
      </RiskScope>
      {/* 등록 작업면(-188). 위험 강조 대상이 아니라 RiskScope 밖에 둔다. 작업면이 없으면 아무것도 그리지 않는다. */}
      <WorkSurfaceLayer />
      {/* 보정된 카메라 마커·시야 절두체(-522). 편집 중에는 숨기고, 클릭하면 CCTV 떠 있는 창을 연다. */}
      <CameraLayer />
      {/* PLANNED 가상 배치(-186). PLANNED 모드에서만 그린다. 위험 강조 밖이다(가상 객체는 판정 대상이 아니다). */}
      <PlannedLayer />
      {/* 편집 초안·손잡이는 위험 강조 밖에 둔다(위험은 원본 구역에만 붙는다). */}
      <GizmoController />
      <ObbGizmoController />
      <DraftOverlay />
      {/* 호스트가 쥔 상자 편집 조작기. 뷰어 안 편집 세션과 따로이고 위험 강조 밖이다. */}
      <BoxEditGizmo />
      <PostProcessingLayer />
      {children}
    </Canvas>
  );
});
