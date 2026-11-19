import type { SkeletonFigure } from '@/features/viewer3d/people/skeletonPose';
import { useFrame } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';
import type { Group } from 'three';

const noRaycast = () => null;

/** 경고 표식 색. 장면 색표와 따로 두는 보호구 색이다(-531). */
const WARNING_COLOR = '#e5484d';
/** 골격 머리 구 위로 띄우는 거리(m). 머리 구 반지름보다 조금 위다. */
const ABOVE_HEAD_M = 0.07;
/** 표식 가운데를 그 위로 더 띄우는 높이(m)와 크기(m). */
const MARK_RISE_M = 0.22;
const MARK_RADIUS_M = 0.07;

interface PpeWarningMarkProps {
  /** 골격 막대 사람의 표본별 골격. 있으면 머리 위를 따르고, 없으면 fallbackY 에 둔다. */
  figure?: RefObject<{ figure: SkeletonFigure | null }>;
  /** 골격 머리가 없을 때 표식을 두는 높이(캡슐 머리 위, 높이 모름 기둥 위). */
  fallbackY: number;
}

/**
 * 안전모나 조끼가 미착용일 때 머리 위에 보이는 빨간 경고 표식(명세 13.3, S15P31A101-531). 장비가 몇 개 미착용이든 하나다.
 * 경보가 아니며(경보는 R9·R11 이벤트) 클릭을 받지 않는다. 호스트가 같은 World ID·identity_revision·만료·연결을 따진 상태만 받는다.
 */
export function PpeWarningMark({ figure, fallbackY }: PpeWarningMarkProps) {
  const group = useRef<Group>(null);

  useFrame(() => {
    const target = group.current;
    if (!target || !figure) return;
    const head = figure.current.figure?.anchors.head;
    if (head) target.position.set(head[0], head[1] + ABOVE_HEAD_M, head[2]);
    else target.position.set(0, fallbackY, 0);
  });

  return (
    <group ref={group} name="ppe-warning-mark" position-y={fallbackY}>
      <mesh position-y={MARK_RISE_M} raycast={noRaycast}>
        <octahedronGeometry args={[MARK_RADIUS_M]} />
        <meshBasicMaterial color={WARNING_COLOR} />
      </mesh>
    </group>
  );
}
