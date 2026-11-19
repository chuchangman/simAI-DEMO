import { LabelSprite } from '@/features/viewer3d/LabelSprite';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh, MeshBasicMaterial } from 'three';

const HIGHLIGHT_COLOR = '#34d399';
const noRaycast = () => null;

/** 펄스 한 번의 길이(s). 느리면 눈에 안 띄고 빠르면 어지러워 1 s 로 둔다 */
const PULSE_S = 1;

/**
 * 사람 강조(-509): 발밑 고리 두 겹이 퍼져 나가며 사라지고, 위에 큰 이름표를 둔다. 부모 그룹(발 위치)에 붙는다.
 * 선택·클릭을 받지 않고(raycast 없음) 깊이와 상관없이 보인다. 애니메이션은 useFrame 의 객체 값 변경뿐이라 다시 그리지 않는다.
 */
export function PersonHighlight({ text, labelY }: { text: string; labelY: number }) {
  return (
    <>
      <PulseRing offset={0} />
      <PulseRing offset={0.5} />
      <LabelSprite text={text} y={labelY} height={0.4} color={HIGHLIGHT_COLOR} />
    </>
  );
}

function PulseRing({ offset }: { offset: number }) {
  const mesh = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime / PULSE_S + offset) % 1;
    const scale = 0.6 + t * 1.6;
    mesh.current?.scale.set(scale, scale, 1);
    if (material.current) material.current.opacity = 0.9 * (1 - t);
  });
  return (
    <mesh
      ref={mesh}
      rotation-x={-Math.PI / 2}
      position-y={0.03}
      raycast={noRaycast}
      renderOrder={20}
    >
      <ringGeometry args={[0.45, 0.6, 48]} />
      <meshBasicMaterial
        ref={material}
        color={HIGHLIGHT_COLOR}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
