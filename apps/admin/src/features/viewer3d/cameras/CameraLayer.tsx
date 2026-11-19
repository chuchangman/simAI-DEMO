import {
  CAMERA_FRUSTUM_LENGTH_M,
  cameraFrustumDimensions,
  cameraMarkerTransform,
  type CalibratedCameraPose,
} from '@/features/viewer3d/cameras/cameraMarkers';
import { useSpatialData } from '@/features/viewer3d/data/SpatialDataProvider';
import { BoxEditContext } from '@/features/viewer3d/editing/BoxEditGizmo';
import type { EditStore } from '@/features/viewer3d/editing/editSession.store';
import { EditStoreContext } from '@/features/viewer3d/editing/EditStoreContext';
import { LabelSprite } from '@/features/viewer3d/LabelSprite';
import { cssHex } from '@/features/viewer3d/palette';
import { useScenePalette } from '@/features/viewer3d/sceneTheme';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import { useCameraNames } from '@/hooks/useCameraNames';
import { Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import { useStore } from 'zustand';

/** 끌기와 클릭을 가르는 이동 거리(px). Selectable 과 같은 기준을 쓴다. */
const CLICK_MAX_DRAG_PX = 2;

const noRaycast = () => null;
const noopSubscribe = () => () => {};

function useInSessionEdit(editStore: EditStore | null): boolean {
  return useSyncExternalStore(editStore ? editStore.subscribe : noopSubscribe, () =>
    editStore
      ? editStore.getState().session !== null || editStore.getState().objectSession !== null
      : false,
  );
}

export const CameraClickContext = createContext<((cameraId: string) => void) | undefined>(
  undefined,
);

/**
 * 관제 3D 에 보정된 카메라 마커(본체·렌즈 + 카메라 ID 이름표 + 약 1.5 m 시야 절두체)를 그린다(S15P31A101-522).
 * - 구역·작업면 편집 중이거나 LIVE 모드가 아니면 숨긴다.
 * - 사람이 선택되면 그 사람 트랙의 cameras 에 포함된 카메라 마커를 강조 표시한다.
 * - 마커를 클릭하면 호스트가 넘긴 onCameraClick(cameraId) 을 불러 떠 있는 CCTV 창을 연다.
 * - 카메라 시점 보기(-590) 중인 카메라의 마커는 숨긴다.
 */
export function CameraLayer() {
  const viewerStore = useViewerStore();
  const editStore = useContext(EditStoreContext);
  const boxEditBinding = useContext(BoxEditContext);
  const mode = useStore(viewerStore, (s) => s.mode);
  const cameraPoses = useStore(viewerStore, (s) => s.cameraPoses);
  // 카메라 시점 보기(-590)로 옮기는 중이거나 맞아 있는 카메라의 마커는 숨긴다(그 자리에 서면 본체·렌즈가 시야를 가린다).
  const viewingCameraId = useStore(viewerStore, (s) => s.cameraViewId);
  const selectedPersonId = useStore(viewerStore, (s) =>
    s.selected?.type === 'person' ? s.selected.id : null,
  );
  const label = useCameraNames(cameraPoses.map((pose) => pose.cameraId));
  const inSessionEdit = useInSessionEdit(editStore);
  const inBoxEdit = Boolean(boxEditBinding?.boxEdit);

  // 선택된 사람의 관측 카메라 목록만 원시 문자열로 구독한다(1 Hz health 나 무관한 10 Hz world 에 다시 그리지 않는다).
  const activeCamerasKey = useSpatialData((s) => {
    if (!selectedPersonId || !s.world) return '';
    const track = s.world.tracks.find((t) => t.worldId === selectedPersonId);
    return track && track.cameras.length > 0 ? [...track.cameras].sort().join('\n') : '';
  });

  const highlightedIds = useMemo(
    () => new Set(activeCamerasKey ? activeCamerasKey.split('\n') : []),
    [activeCamerasKey],
  );

  if (mode !== 'LIVE' || inSessionEdit || inBoxEdit || cameraPoses.length === 0) {
    return null;
  }

  return (
    <group name="camera-layer">
      {cameraPoses
        .filter((pose) => pose.cameraId !== viewingCameraId)
        .map((pose) => (
          <CameraMarker
            key={pose.cameraId}
            pose={pose}
            label={label(pose.cameraId)}
            highlighted={highlightedIds.has(pose.cameraId)}
          />
        ))}
    </group>
  );
}

function CameraMarker({
  pose,
  highlighted,
  label,
}: {
  pose: CalibratedCameraPose;
  highlighted: boolean;
  label: string;
}) {
  const onCameraClick = useContext(CameraClickContext);
  const palette = useScenePalette();
  const transform = useMemo(() => cameraMarkerTransform(pose), [pose]);
  const frustum = useMemo(
    () => cameraFrustumDimensions(pose.hfovRad, CAMERA_FRUSTUM_LENGTH_M),
    [pose.hfovRad],
  );

  const frustumGeometry = useMemo(() => {
    const [c0, c1, c2, c3] = frustum.corners;
    // 원점(0, 0, 0)에서 시작하는 사각뿔 4개 측면 삼각형
    const vertices = new Float32Array([
      0,
      0,
      0,
      c0[0],
      c0[1],
      c0[2],
      c1[0],
      c1[1],
      c1[2],
      0,
      0,
      0,
      c1[0],
      c1[1],
      c1[2],
      c2[0],
      c2[1],
      c2[2],
      0,
      0,
      0,
      c2[0],
      c2[1],
      c2[2],
      c3[0],
      c3[1],
      c3[2],
      0,
      0,
      0,
      c3[0],
      c3[1],
      c3[2],
      c0[0],
      c0[1],
      c0[2],
    ]);
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(vertices, 3));
    geom.computeVertexNormals();
    return geom;
  }, [frustum]);

  useEffect(() => () => frustumGeometry.dispose(), [frustumGeometry]);

  const frustumEdges = useMemo(() => {
    const [c0, c1, c2, c3] = frustum.corners;
    const origin: [number, number, number] = [0, 0, 0];
    return [
      [origin, [c0[0], c0[1], c0[2]] as [number, number, number]],
      [origin, [c1[0], c1[1], c1[2]] as [number, number, number]],
      [origin, [c2[0], c2[1], c2[2]] as [number, number, number]],
      [origin, [c3[0], c3[1], c3[2]] as [number, number, number]],
      [
        [c0[0], c0[1], c0[2]] as [number, number, number],
        [c1[0], c1[1], c1[2]] as [number, number, number],
        [c2[0], c2[1], c2[2]] as [number, number, number],
        [c3[0], c3[1], c3[2]] as [number, number, number],
        [c0[0], c0[1], c0[2]] as [number, number, number],
      ],
    ];
  }, [frustum]);

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (event.delta > CLICK_MAX_DRAG_PX) return;
      event.stopPropagation();
      onCameraClick?.(pose.cameraId);
    },
    [onCameraClick, pose.cameraId],
  );

  const bodyHex = highlighted ? palette.zone.color : palette.person.body;
  const lensHex = highlighted ? palette.person.selected : palette.person.joint;
  const frustumHex = highlighted ? palette.zone.color : palette.person.selected;
  const labelColor = highlighted ? cssHex(palette.zone.color) : palette.label.observed;

  return (
    <group
      name={`camera-marker:${pose.cameraId}`}
      position={transform.position}
      userData={{ cameraId: pose.cameraId, highlighted }}
    >
      <LabelSprite text={label} y={0.28} height={0.22} color={labelColor} />
      <group name={`camera-rig:${pose.cameraId}`} quaternion={transform.quaternion}>
        {/* 카메라 본체 및 렌즈(클릭 시 CCTV 떠 있는 창을 연다). */}
        <mesh name={`camera-body:${pose.cameraId}`} position={[0, 0, -0.04]} onClick={handleClick}>
          <boxGeometry args={[0.22, 0.14, 0.26]} />
          <meshStandardMaterial color={bodyHex} roughness={0.45} metalness={0.2} />
        </mesh>
        <mesh
          name={`camera-lens:${pose.cameraId}`}
          position={[0, 0, 0.12]}
          rotation={[Math.PI / 2, 0, 0]}
          onClick={handleClick}
        >
          <cylinderGeometry args={[0.055, 0.068, 0.09, 14]} />
          <meshStandardMaterial color={lensHex} roughness={0.35} metalness={0.3} />
        </mesh>
        {/* 작은 카메라 아이콘을 쉽게 누를 수 있게 하는 투명 히트 구체. */}
        <mesh name={`camera-hit:${pose.cameraId}`} onClick={handleClick}>
          <sphereGeometry args={[0.25, 10, 10]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* 길이 약 1.5 m 의 옅은 시야 절두체(뒤의 사람·구역 클릭을 가리지 않게 raycast 는 끈다). */}
        <mesh
          name={`camera-frustum:${pose.cameraId}`}
          geometry={frustumGeometry}
          raycast={noRaycast}
        >
          <meshBasicMaterial
            color={frustumHex}
            transparent
            opacity={highlighted ? 0.2 : 0.07}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
        {frustumEdges.map((points, index) => (
          <Line
            key={index}
            points={points}
            color={frustumHex}
            transparent
            opacity={highlighted ? 0.85 : 0.32}
            lineWidth={highlighted ? 2 : 1}
            raycast={noRaycast}
          />
        ))}
      </group>
    </group>
  );
}
