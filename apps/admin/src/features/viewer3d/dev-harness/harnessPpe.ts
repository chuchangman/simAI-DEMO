import type { SpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import type { PersonHelmetState } from '@/features/viewer3d/types';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';

// 개발 화면의 사람별 안전모·조끼 상태(-552). 서버 없이 골격 막대·캡슐에 미착용 경고 표식을 보려고 쓴다(장비 형상은 그리지 않는다, -783).
// ?ppe=fixed 는 사람 순서대로 정해진 상태(스크린샷용), ?ppe=cycle 은 그 상태가 돌아가며 바뀐다. 없으면 상태 없음(표식도 없다).

export type HarnessPpeMode = 'off' | 'fixed' | 'cycle';

const PARAM = 'ppe';
/** cycle 에서 상태가 바뀌는 간격(ms). */
const STEP_MS = 2500;

interface Wear {
  helmet: PersonHelmetState;
  vest: PersonHelmetState;
}

/** 사람마다 한 칸씩 어긋나게 쓰는 상태: 둘 다 착용 → 조끼만 미착용 → 안전모만 미착용 → 둘 다 모름. */
const CYCLE: readonly Wear[] = [
  { helmet: 'WORN', vest: 'WORN' },
  { helmet: 'WORN', vest: 'NOT_WORN' },
  { helmet: 'NOT_WORN', vest: 'WORN' },
  { helmet: 'UNKNOWN', vest: 'UNKNOWN' },
];

/** 뷰어 `personHelmets`·`personVests` 에 그대로 넘기는 상태. */
export interface HarnessPpe {
  helmets: Readonly<Record<string, PersonHelmetState>>;
  vests: Readonly<Record<string, PersonHelmetState>>;
}

export function readPpeMode(search: string): HarnessPpeMode {
  const value = new URLSearchParams(search).get(PARAM)?.toLowerCase();
  return value === 'fixed' || value === 'cycle' ? value : 'off';
}

/** 사람 순서(i)와 단계(step)로 상태를 정한다. */
export function harnessPpe(worldIds: readonly string[], step: number): HarnessPpe {
  const wearOf = (index: number) => CYCLE[(index + step) % CYCLE.length]!;
  return {
    helmets: Object.fromEntries(worldIds.map((id, i) => [id, wearOf(i).helmet])),
    vests: Object.fromEntries(worldIds.map((id, i) => [id, wearOf(i).vest])),
  };
}

/** 지금 사람들의 상태. off 면 undefined(상태 없음). */
export function useHarnessPpe(
  store: SpatialDataStore,
  mode: HarnessPpeMode,
): HarnessPpe | undefined {
  // 사람 ID 가 바뀔 때만 다시 만든다(좌표는 매 표본 바뀐다).
  const idsKey = useStore(
    store,
    (state) => state.world?.tracks.map((track) => track.worldId).join('|') ?? '',
  );
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (mode !== 'cycle') return;
    const timer = setInterval(() => setStep((s) => s + 1), STEP_MS);
    return () => clearInterval(timer);
  }, [mode]);
  return useMemo(
    () =>
      mode === 'off'
        ? undefined
        : harnessPpe(idsKey ? idsKey.split('|') : [], mode === 'cycle' ? step : 0),
    [idsKey, mode, step],
  );
}
