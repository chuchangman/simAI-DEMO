import type { SpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import type { ExternalSpatialSource } from '@/features/viewer3d/data/spatialSource';
import {
  GEOMETRY_OPTIONS,
  type GeometryMode,
} from '@/features/viewer3d/dev-harness/officialFixtures';
import {
  VIEWER_LAYER_KEYS,
  VIEWER_LAYER_MODES,
  type ResolvedLayers,
  type ViewerLayerKey,
  type ViewerLayerMode,
} from '@/features/viewer3d/layers';
import type {
  Viewer3DHandle,
  ViewerSelectRequest,
  ViewerTarget,
  ViewerTargetType,
} from '@/features/viewer3d/types';
import { useState, type RefObject } from 'react';
import { useStore } from 'zustand';

// 개발 화면 전용 -234 공개 계약 시험. 형상 입력 형식(DEMO·BE 정식), 레이어 값, 대기 선택, 초안 한 번에 다시 열기,
// Source 형상 보관 비우기를 실제 WebGL 장면에서 눌러 본다. 화면별 레이어 정책은 FE 가 정한다(여기 값은 시험용이다).

const LAYER_LABEL: Record<ViewerLayerKey, string> = {
  zones: '구역',
  workSurfaces: '작업면',
  obstacles: '장애물',
};

const shift = (box: { min: readonly number[]; max: readonly number[] }, dx: number) => ({
  min: [box.min[0]! + dx, box.min[1]!, box.min[2]!] as [number, number, number],
  max: [box.max[0]! + dx, box.max[1]!, box.max[2]!] as [number, number, number],
});

interface ContractPanelProps {
  viewer: RefObject<Viewer3DHandle | null>;
  store: SpatialDataStore;
  selected: ViewerTarget | null;
  geometry: GeometryMode;
  onGeometryChange(mode: GeometryMode): void;
  layers: ResolvedLayers;
  onLayersChange(layers: ResolvedLayers): void;
  selectRequest: ViewerSelectRequest | null;
  external: ExternalSpatialSource | null;
}

export function ContractPanel({
  viewer,
  store,
  selected,
  geometry,
  onGeometryChange,
  layers,
  onLayersChange,
  selectRequest,
  external,
}: ContractPanelProps) {
  const zones = useStore(store, (s) => s.zones);
  const surfaces = useStore(store, (s) => s.workSurfaces);
  const [targetType, setTargetType] = useState<ViewerTargetType>('zone');
  const [targetId, setTargetId] = useState('z-03');
  const [note, setNote] = useState('');

  const waitSelect = () => {
    const result = viewer.current?.select(
      { type: targetType, id: targetId },
      { waitMs: 8000, focus: true },
    );
    setNote(`select(waitMs 8000) → ${JSON.stringify(result)}`);
  };

  // 선택한 BOX 구역을 원본 대비 +0.5m 옮긴 초안으로 한 번에 다시 연다(before = 원본).
  const restoreDraft = () => {
    const zone =
      selected?.type === 'zone' ? zones.zones.find((z) => z.zoneId === selected.id) : undefined;
    if (!zone) {
      setNote('구역을 먼저 고른다');
      return;
    }
    const before = shift(zone, 0);
    const result = viewer.current?.beginEdit(
      { type: 'zone', id: zone.zoneId },
      { before, draft: shift(before, 0.5) },
    );
    setNote(`beginEdit(draft +0.5m) → ${JSON.stringify(result)}`);
  };

  const staleRestore = () => {
    const zone =
      selected?.type === 'zone' ? zones.zones.find((z) => z.zoneId === selected.id) : undefined;
    if (!zone) {
      setNote('구역을 먼저 고른다');
      return;
    }
    const before = shift(zone, -1);
    const result = viewer.current?.beginEdit(
      { type: 'zone', id: zone.zoneId },
      { before, draft: shift(before, 0.5) },
    );
    setNote(`beginEdit(옛 원본) → ${JSON.stringify(result)}`);
  };

  return (
    <div className="smk-data" data-testid="contract-panel">
      <div className="smk-data-row">
        <select
          aria-label="형상 입력"
          value={geometry}
          onChange={(e) => onGeometryChange(e.target.value as GeometryMode)}
        >
          {GEOMETRY_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <p className="smk-data-dim smk-mono" data-testid="geometry-status">
        구역 {zones.status} · {zones.contract} ·{' '}
        {zones.zones
          .map(
            (z) =>
              `${z.zoneId}(${z.shape ?? 'BOX'}${z.official ? ` v${z.official.zoneVersion}` : ''})`,
          )
          .join(', ') || '—'}
        {zones.invalid.map((z) => ` · 거부 ${z.zoneId ?? 'ID 없음'}(${z.reason})`).join('')}
      </p>
      <p className="smk-data-dim smk-mono" data-testid="static-status">
        정적 객체 {surfaces.status} · {surfaces.contract} · 작업면{' '}
        {surfaces.surfaces.map((s) => s.surfaceId).join(', ') || '—'} · 장애물{' '}
        {surfaces.obstacles.map((o) => o.objectId).join(', ') || '—'}
        {[
          ...surfaces.invalid.map((s) => s.surfaceId),
          ...surfaces.invalidObstacles.map((o) => o.objectId),
        ]
          .map((id) => ` · 거부 ${id ?? 'ID 없음'}`)
          .join('')}
      </p>
      <div className="smk-data-row">
        {VIEWER_LAYER_KEYS.map((key) => (
          <select
            key={key}
            aria-label={`레이어 ${LAYER_LABEL[key]}`}
            value={layers[key]}
            onChange={(e) =>
              onLayersChange({ ...layers, [key]: e.target.value as ViewerLayerMode })
            }
          >
            {VIEWER_LAYER_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {LAYER_LABEL[key]} · {mode}
              </option>
            ))}
          </select>
        ))}
      </div>
      <div className="smk-data-row">
        <select
          aria-label="대기 선택 종류"
          value={targetType}
          onChange={(e) => setTargetType(e.target.value as ViewerTargetType)}
        >
          <option value="zone">zone</option>
          <option value="person">person</option>
          <option value="object">object</option>
        </select>
        <input
          aria-label="대기 선택 ID"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          size={10}
        />
        <button type="button" className="smk-chip" onClick={waitSelect}>
          기다려 고르기
        </button>
      </div>
      <div className="smk-data-row">
        <button type="button" className="smk-chip" onClick={restoreDraft}>
          초안 다시 열기(+0.5m)
        </button>
        <button type="button" className="smk-chip" onClick={staleRestore}>
          옛 원본으로 다시 열기
        </button>
      </div>
      {external && (
        <div className="smk-data-row">
          <button type="button" className="smk-chip" onClick={() => external.clearSnapshot()}>
            형상 비우기
          </button>
          <button
            type="button"
            className="smk-chip"
            onClick={() => external.setScope(`scope-${Date.now()}`)}
          >
            범위 바꾸기
          </button>
        </div>
      )}
      <p className="smk-data-dim smk-mono" data-testid="select-request">
        대기 선택{' '}
        {selectRequest
          ? `${selectRequest.status} ${selectRequest.target.type}:${selectRequest.target.id}${selectRequest.reason ? ` (${selectRequest.reason})` : ''}`
          : '—'}
      </p>
      <p className="smk-data-dim smk-mono" data-testid="contract-note">
        {note || '—'}
      </p>
    </div>
  );
}
