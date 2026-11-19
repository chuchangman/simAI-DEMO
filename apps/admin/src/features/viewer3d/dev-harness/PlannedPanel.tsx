import type {
  ViewerPlannedEditPreview,
  ViewerPlannedEditResult,
} from '@/features/viewer3d/editing/editTypes';
import type {
  PlannedGeometry,
  PlannedKind,
  PlannedLayoutInput,
  PlannedObjectInput,
} from '@/features/viewer3d/planned/plannedLayout';
import type { Viewer3DHandle, ViewerMode, ViewerTarget } from '@/features/viewer3d/types';
import { useState, type RefObject } from 'react';

// 개발 화면 전용 -186 PLANNED 가상 배치 소비 예시. FE 계획 화면(-62)이 하는 일을 흉내 낸다:
// 배치 목록을 갖고 있다가 편집 결과(FINISHED)를 받으면 그 값으로 목록을 바꿔 다시 넘긴다. 저장·평가는 하지 않는다.
// 값은 DEMO 교실 치수다(실측 아님). plan-bad 는 모르는 종류라 Viewer 가 빼야 한다.

export const DEMO_PLANNED_LAYOUT: PlannedLayoutInput = {
  layoutId: 'tbm-demo-1',
  objects: [
    {
      id: 'plan-open-1',
      kind: 'OPENING',
      label: '바닥 개구부',
      geometry: { center: [6.2, 6, 0.05], size: [1.2, 0.8, 0.1], yawRad: 0 },
    },
    {
      id: 'plan-scaf-1',
      kind: 'SCAFFOLD',
      label: '비계',
      geometry: { center: [8.6, 8.2, 1.5], size: [2, 0.8, 3], yawRad: 0 },
    },
    {
      id: 'plan-equip-1',
      kind: 'EQUIPMENT',
      label: '고소작업대',
      geometry: { center: [3, 8.8, 0.6], size: [1, 0.8, 1.2], yawRad: 0.4 },
    },
    {
      id: 'plan-bad',
      kind: 'TOWER' as PlannedKind,
      geometry: { center: [1, 1, 1], size: [1, 1, 1], yawRad: 0 },
    },
  ],
};

const NEW_GEOMETRY: Record<PlannedKind, PlannedGeometry> = {
  OPENING: { center: [5, 2.5, 0.05], size: [1, 1, 0.1], yawRad: 0 },
  WORK_SURFACE: { center: [5, 2.5, 0.2], size: [1, 1, 0.4], yawRad: 0 },
  SCAFFOLD: { center: [5, 2.5, 1], size: [1.6, 0.6, 2], yawRad: 0 },
  EQUIPMENT: { center: [5, 2.5, 0.5], size: [0.8, 0.8, 1], yawRad: 0 },
};

/** FINISHED 결과를 배치 목록에 반영한다(FE 가 할 일). 다른 결과는 목록을 바꾸지 않는다. */
export function applyPlannedResult(
  layout: PlannedLayoutInput,
  result: ViewerPlannedEditResult,
): PlannedLayoutInput {
  if (result.status !== 'FINISHED' || (!result.changed && result.origin === 'REGISTERED'))
    return layout;
  const next: PlannedObjectInput = {
    id: result.target.id,
    kind: result.plannedKind,
    geometry: result.after,
    label: layout.objects.find((o) => o.id === result.target.id)?.label ?? null,
  };
  const exists = layout.objects.some((o) => o.id === next.id);
  return {
    ...layout,
    objects: exists
      ? layout.objects.map((o) => (o.id === next.id ? next : o))
      : [...layout.objects, next],
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (g: PlannedGeometry) =>
  `center [${g.center.map(r2).join(', ')}] · size [${g.size.map(r2).join(', ')}] · yaw ${r2((g.yawRad * 180) / Math.PI)}°`;

interface PlannedPanelProps {
  viewer: RefObject<Viewer3DHandle | null>;
  layout: PlannedLayoutInput;
  mode: ViewerMode;
  selected: ViewerTarget | null;
  preview: ViewerPlannedEditPreview | null;
  result: ViewerPlannedEditResult | null;
}

export function PlannedPanel({
  viewer,
  layout,
  mode,
  selected,
  preview,
  result,
}: PlannedPanelProps) {
  const [seq, setSeq] = useState(1);
  const [note, setNote] = useState('');
  const run = (label: string, outcome: unknown) => setNote(`${label} → ${JSON.stringify(outcome)}`);
  const create = (kind: PlannedKind) => {
    const id = `plan-new-${seq}`;
    setSeq((n) => n + 1);
    run(
      `만들기 ${id}`,
      viewer.current?.beginPlannedCreate?.({ id, kind, geometry: NEW_GEOMETRY[kind] }),
    );
  };
  const selectedPlanned = selected?.type === 'planned' ? selected : null;

  return (
    <div className="smk-data" data-testid="planned-panel">
      <div className="smk-data-row">
        <span className="smk-data-dim">모드 {mode}</span>
        <button
          type="button"
          className="smk-chip"
          onClick={() => run('PLANNED', viewer.current?.setMode('PLANNED'))}
        >
          PLANNED
        </button>
        <button
          type="button"
          className="smk-chip"
          onClick={() => run('LIVE', viewer.current?.setMode('LIVE'))}
        >
          LIVE
        </button>
      </div>
      <div className="smk-data-row">
        <button type="button" className="smk-chip" onClick={() => create('OPENING')}>
          개구부 만들기
        </button>
        <button type="button" className="smk-chip" onClick={() => create('SCAFFOLD')}>
          비계 만들기
        </button>
        <button type="button" className="smk-chip" onClick={() => create('EQUIPMENT')}>
          장비 만들기
        </button>
      </div>
      <div className="smk-data-row">
        {layout.objects
          .filter((o) => o.id !== 'plan-bad')
          .map((o) => (
            <button
              key={o.id}
              type="button"
              className="smk-chip"
              onClick={() =>
                run(`편집 ${o.id}`, viewer.current?.beginEdit({ type: 'planned', id: o.id }))
              }
            >
              {o.id} 편집
            </button>
          ))}
      </div>
      <div className="smk-data-row">
        <button
          type="button"
          className="smk-chip"
          disabled={!preview}
          onClick={() =>
            run(
              'yaw +15°',
              viewer.current?.updatePlannedEditField?.({
                field: 'yaw',
                value: (preview?.draft.yawRad ?? 0) + Math.PI / 12,
              }),
            )
          }
        >
          yaw +15°
        </button>
        <button
          type="button"
          className="smk-chip"
          disabled={!preview}
          onClick={() =>
            run(
              '높이 2.5m',
              viewer.current?.updatePlannedEditField?.({ field: 'height', value: 2.5 }),
            )
          }
        >
          높이 2.5m
        </button>
        <button
          type="button"
          className="smk-chip"
          onClick={() => run('완료', viewer.current?.finishPlannedEdit?.()?.status ?? null)}
        >
          완료(결과 받기)
        </button>
        <button
          type="button"
          className="smk-chip"
          onClick={() => run('취소', viewer.current?.cancelPlannedEdit?.()?.status ?? null)}
        >
          취소
        </button>
      </div>
      <p className="smk-data-dim smk-mono" data-testid="planned-layout">
        배치 {layout.layoutId} · {layout.objects.map((o) => o.id).join(', ')} · 선택{' '}
        {selectedPlanned?.id ?? '—'}
      </p>
      <p className="smk-data-dim smk-mono" data-testid="planned-preview">
        {preview
          ? `${preview.target.id} · ${preview.plannedKind} · ${preview.origin} · ${fmt(preview.draft)}`
          : '초안 없음'}
      </p>
      <p className="smk-data-dim smk-mono" data-testid="planned-result">
        {result
          ? result.status === 'REJECTED'
            ? `REJECTED(${result.reason}) · ${result.detail}`
            : result.status === 'FINISHED'
              ? `FINISHED · ${result.target.id} · ${result.origin} · 변경 ${result.changed} · ${fmt(result.after)} · saved ${result.saved}`
              : `CANCELLED(${result.reason}) · ${result.target.id}`
          : '결과 없음'}
      </p>
      <p className="smk-data-dim smk-mono" data-testid="planned-note">
        {note || '—'}
      </p>
    </div>
  );
}
