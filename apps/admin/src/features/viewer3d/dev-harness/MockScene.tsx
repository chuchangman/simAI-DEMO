import {
  CAMERAS,
  fixtureBox,
  fixtureFeet,
  OBJECTS,
  PEOPLE,
  ZONES,
} from '@/features/viewer3d/dev-harness/mockUi';
import { Selectable } from '@/features/viewer3d/Selectable';
import type { ViewerTarget } from '@/features/viewer3d/types';
import { worldPoint, worldToThree } from '@/features/viewer3d/worldCoordinates';
import { DEMO_ROOM, FLOOR_ROTATION_X } from '@/features/viewer3d/WorldScene';
import { Edges } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { Vector3 } from 'three';

export interface SceneColors {
  person: string;
  personSelected: string;
  critical: string;
  caution: string;
  object: string;
  camera: string;
}

interface MockSceneProps {
  colors: SceneColors;
  selected: ViewerTarget | null;
  /**
   * 입력 없음(source=off)일 때만 예전 고정 작업자·구역·작업면을 그린다.
   * 입력이 있으면 사람은 PersonLayer, 구역은 ZoneLayer, 작업면은 WorkSurfaceLayer 가 Provider 데이터로 그린다(둘을 함께 그리지 않는다).
   */
  legacy: boolean;
}

const isSelected = (selected: ViewerTarget | null, type: ViewerTarget['type'], id: string) =>
  selected?.type === type && selected.id === id;

// 레거시 구역 부피는 클릭을 받지 않게 해 안에 있는 사람을 가리지 않는다. 구역 선택은 바닥 면으로 한다.
const noRaycast = () => null;

// 구역 바닥 면은 World 바닥보다 1cm 위에 그려 겹쳐 깜박이지 않게 한다(표시용 높이).
const ZONE_FLOOR_LIFT = 0.01;

interface OrbitLike {
  target: Vector3;
  update: () => void;
}

// DEMO 교실 가운데 바닥을 -Y 쪽 위에서 내려다본다. 패널 사이에 들어오게 중심을 0.8m 앞(-Y)으로 당긴다. 모두 World 좌표다.
const VIEW_TARGET = worldToThree(worldPoint(DEMO_ROOM.sizeX / 2, DEMO_ROOM.sizeY / 2 - 0.8, 0));
const VIEW_CAMERA = worldToThree(worldPoint(DEMO_ROOM.sizeX / 2, DEMO_ROOM.sizeY / 2 - 12, 12.5));

/**
 * 목업에서만 처음 한 번 교실 전체가 패널 사이에 보이도록 시점을 잡는다.
 * 메뉴·오버레이를 바꿔도 다시 잡지 않는다. Viewer 기본 시점은 바꾸지 않는다.
 */
function InitialView() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const applied = useRef(false);
  useEffect(() => {
    if (!controls || applied.current) return;
    applied.current = true;
    camera.position.fromArray(VIEW_CAMERA);
    controls.target.fromArray(VIEW_TARGET);
    controls.update();
  }, [camera, controls]);
  return null;
}

/**
 * 목업용 교실 장면. 바닥·벽은 Viewer 의 WorldScene 이 그리고, 여기서는 예시 객체만 World 좌표로 얹는다.
 * 기존 Viewer 의 Canvas·카메라·선택 위에 Selectable 로만 얹는다.
 */
export function MockScene({ colors, selected, legacy }: MockSceneProps) {
  return (
    <>
      <InitialView />

      {CAMERAS.map((camera) => (
        <mesh
          key={camera.id}
          position={worldToThree(worldPoint(camera.x, camera.y, camera.z))}
          raycast={noRaycast}
        >
          <boxGeometry args={[0.25, 0.18, 0.35]} />
          <meshStandardMaterial color={colors.camera} />
        </mesh>
      ))}

      {legacy &&
        ZONES.map((zone) => {
          const on = isSelected(selected, 'zone', zone.id);
          const color = zone.tone === 'critical' ? colors.critical : colors.caution;
          const box = fixtureBox(zone);
          return (
            <Selectable key={zone.id} target={{ type: 'zone', id: zone.id }}>
              <mesh
                rotation-x={FLOOR_ROTATION_X}
                position={worldToThree(worldPoint(zone.x, zone.y, ZONE_FLOOR_LIFT))}
              >
                <planeGeometry args={[zone.sizeX, zone.sizeY]} />
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={on ? 0.45 : 0.22}
                  depthWrite={false}
                />
              </mesh>
              <mesh position={box.position} raycast={noRaycast}>
                <boxGeometry args={box.size} />
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={on ? 0.16 : 0.07}
                  depthWrite={false}
                />
                <Edges color={color} />
              </mesh>
            </Selectable>
          );
        })}

      {legacy &&
        OBJECTS.map((object) => {
          const box = fixtureBox(object);
          return (
            <Selectable key={object.id} target={{ type: 'object', id: object.id }}>
              <mesh position={box.position}>
                <boxGeometry args={box.size} />
                <meshStandardMaterial
                  color={
                    isSelected(selected, 'object', object.id)
                      ? colors.personSelected
                      : colors.object
                  }
                />
              </mesh>
            </Selectable>
          );
        })}

      {legacy &&
        PEOPLE.map((person) => (
          <Selectable key={person.id} target={{ type: 'person', id: person.id }}>
            {/* 발 위치에 두고, 몸통은 Three 위쪽(+Y)으로 세운다. */}
            <group position={fixtureFeet(person)}>
              <mesh position-y={0.85}>
                <capsuleGeometry args={[0.24, 1.1, 6, 12]} />
                <meshStandardMaterial
                  color={
                    isSelected(selected, 'person', person.id)
                      ? colors.personSelected
                      : colors.person
                  }
                />
              </mesh>
            </group>
          </Selectable>
        ))}
    </>
  );
}
