import { TbmPlan } from '@/features/tbm/TbmPlan';
import { TBM_TASKS } from '@/features/tbm/tbmDemo';
import type { Zone } from '@/features/zones/types';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

it('세팅 구역의 실제 다각형을 가상 배치 위에 표시한다', () => {
  const zone: Zone = {
    zoneId: 'z-1',
    name: '위험 구역',
    min: [0, 0, 0],
    max: [2, 2, 2],
    version: 1,
    judgeType: 'VOLUME_3D',
    zoneType: 'OPENING',
    severity: 'HIGH',
    polygon: [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
    zBounds: [0, 2],
    zRange: [0, 2],
    hasGuardrail: null,
    requirements: null,
    validFrom: 0,
    workId: null,
    layoutId: null,
    layoutItemId: null,
    shapeEditable: true,
  };
  render(<TbmPlan task={TBM_TASKS[0]!} others={[]} spots={[]} setupZones={[zone]} />);
  const area = screen.getByLabelText('위험 구역 위험 구역 (경고)');
  expect(area.getAttribute('points')).not.toBeNull();
  expect(area.getAttribute('class')).toContain('stroke-sev-high');
});
