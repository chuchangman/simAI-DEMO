import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import {
  DEMO_ZONES_RESPONSE,
  scenarioTick,
  TICK_MS,
} from '@/features/viewer3d/dev-harness/scenarios';
import { cssHex, PALETTE } from '@/features/viewer3d/palette';
import { RiskScope } from '@/features/viewer3d/risk/RiskScope';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { ZoneLayer } from '@/features/viewer3d/zones/ZoneLayer';
import { ZoneApplyContext, type ZoneApplyState } from '@/features/viewer3d/zones/zonePresentation';
import { createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import { act, StrictMode, useEffect } from 'react';
import type { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Scene } from 'three';
import * as THREE from 'three';
import { Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// <Canvas> 가 하던 THREE 등록을 루트를 직접 만들 때는 손으로 한다.
extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

// jsdom 에는 WebGL 이 없다. R3F 루트에 그리기만 하는 가짜 renderer 를 넘겨 실제 ZoneLayer 장면 트리·등록·클릭 처리기를 본다.
// 픽셀·광선 피킹 자체는 격리 WebGL 브라우저에서 따로 확인한다.
function fakeRenderer(canvas: HTMLCanvasElement) {
  return {
    render: () => {},
    setPixelRatio: () => {},
    setSize: () => {},
    dispose: () => {},
    forceContextLoss: () => {},
    domElement: canvas,
    shadowMap: { enabled: false, type: 0, needsUpdate: false },
    xr: {
      enabled: false,
      isPresenting: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      setAnimationLoop: () => {},
    },
    renderLists: { dispose: () => {} },
    outputColorSpace: '',
    toneMapping: 0,
  };
}

let scene: Scene | null = null;
function SceneProbe() {
  const current = useThree((s) => s.scene);
  useEffect(() => {
    scene = current;
  }, [current]);
  return null;
}

let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
let viewer: ViewerStore;
let data: SpatialDataStore;

async function mount(applyState: ZoneApplyState = 'UNVERIFIED', strict = false) {
  const canvas = document.createElement('canvas');
  root ??= createRoot(canvas);
  await root.configure({
    gl: fakeRenderer(canvas) as never,
    size: { width: 800, height: 600, top: 0, left: 0 },
    frameloop: 'never',
  });
  const tree = (
    <ViewerStoreContext value={viewer}>
      <SpatialDataContext value={data}>
        <ZoneApplyContext value={applyState}>
          <SceneProbe />
          <RiskScope>
            <ZoneLayer />
          </RiskScope>
        </ZoneApplyContext>
      </SpatialDataContext>
    </ViewerStoreContext>
  );
  await act(async () => root!.render(strict ? <StrictMode>{tree}</StrictMode> : tree));
}

const ingest = async (raw: unknown, ok = true) =>
  act(async () =>
    data.getState().ingestZones(ok ? { ok: true, raw } : { ok: false, reason: 'HTTP 503' }, 1),
  );

const named = (name: string) => scene!.getObjectByName(name);
const zoneKeys = () => [...viewer.getState().targets.keys()].filter((k) => k.startsWith('zone:'));

type Handler = (event: unknown) => void;
const onClickOf = (object: Object3D) =>
  (object as unknown as { __r3f: { handlers: { onClick: Handler } } }).__r3f.handlers.onClick;

function click(zoneId: string, hits: string[]) {
  const stopPropagation = vi.fn();
  act(() =>
    onClickOf(named(`zone:${zoneId}`)!)({
      intersections: hits.map((name) => ({ eventObject: { name } })),
      stopPropagation,
    }),
  );
  return stopPropagation;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  viewer = createViewerStore();
  viewer.getState().markReady();
  data = createSpatialDataStore();
  data.getState().reset('mock:test');
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  scene = null;
  vi.restoreAllMocks();
});

describe('ZoneLayer', () => {
  it('Provider 의 유효한 구역만 같은 장면에 정확한 위치·크기로 올린다', async () => {
    await mount();
    expect(zoneKeys()).toEqual([]);
    await ingest(DEMO_ZONES_RESPONSE);

    expect(zoneKeys().sort()).toEqual(['zone:z-01', 'zone:z-02', 'zone:z-03']);
    expect(named('zone:z-bad')).toBeUndefined();
    const z3 = named('zone-box:z-03') as Mesh<BoxGeometry>;
    const center = z3.getWorldPosition(new Vector3()).toArray();
    expect(center.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([5.5, 1.8, -8.25]);
    const { width, height, depth } = z3.geometry.parameters;
    expect([width, height, depth]).toEqual([2, 1.2, 1.5]);
    // 공중 구역 하단은 World Z 1.2m 그대로다.
    expect(Math.round((center[1]! - height / 2) * 1e6) / 1e6).toBe(1.2);
  });

  it('이름표는 구역 이름만 적는다(구역 번호·높이·적용 상태가 없다)', async () => {
    const fillText = vi.fn();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      measureText: (text: string) => ({ width: text.length * 12 }),
      beginPath: () => {},
      roundRect: () => {},
      fill: () => {},
      fillText,
    } as unknown as CanvasRenderingContext2D);
    await mount();
    await ingest(DEMO_ZONES_RESPONSE);

    const labels = [...new Set(fillText.mock.calls.map(([text]) => text as string))].sort();
    expect(labels).toEqual(['예시 구역 A', '예시 구역 B', '예시 구역 C(공중)']);
  });

  it('이름표는 흰 바탕에 어두운 고딕 글자이고, 왼쪽 띠는 구역 색이다', async () => {
    const fills: string[] = [];
    const inks: string[] = [];
    const fonts: string[] = [];
    const context = {
      fillStyle: '',
      font: '',
      measureText: (text: string) => ({ width: text.length * 12 }),
      beginPath: () => {},
      roundRect: () => {},
      fill() {
        fills.push(this.fillStyle);
      },
      fillText() {
        inks.push(this.fillStyle);
        fonts.push(this.font);
      },
    };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    await mount();
    await ingest(DEMO_ZONES_RESPONSE);

    // 등급을 모르는 구역이라 띠는 구역 기본색이다. 띠 색으로 칠한 뒤 흰 바탕으로 덮는다.
    expect([...new Set(fills)].sort()).toEqual(['#ffffff', cssHex(PALETTE.dark.zone.color)].sort());
    expect([...new Set(inks)]).toEqual(['#0b2140']);
    expect(fonts.every((font) => font.startsWith('800 ') && !font.includes('monospace'))).toBe(
      true,
    );
  });

  it('상자 구역 이름표는 포인터를 올리거나 선택하지 않아도 모두 보인다', async () => {
    await mount();
    await ingest(DEMO_ZONES_RESPONSE);

    const sprites: THREE.Sprite[] = [];
    scene!.traverse((node) => {
      if (node instanceof THREE.Sprite) sprites.push(node);
    });
    expect(viewer.getState().selected).toBeNull();
    expect(sprites).toHaveLength(3);
    expect(sprites.every((sprite) => sprite.visible)).toBe(true);
  });

  it('위험 강조가 걸린 구역도 이름만 적고, 글자 색만 위험 색이다', async () => {
    const t0 = 1_760_342_400_000;
    const drawn: { text: string; color: string }[] = [];
    const context = {
      fillStyle: '',
      measureText: (text: string) => ({ width: text.length * 12 }),
      beginPath: () => {},
      roundRect: () => {},
      fill: () => {},
      fillText(text: string) {
        drawn.push({ text, color: this.fillStyle });
      },
    };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    data.getState().setConnection({ state: 'OPEN', at: t0 });
    await mount();
    await ingest(DEMO_ZONES_RESPONSE);
    // z-01 에 위험이 걸리는 시나리오 앞부분(tick 0~10)을 재생한다.
    await act(async () => {
      for (let tick = 0; tick < 11; tick++) {
        for (const out of scenarioTick('risk-lifecycle', tick, t0)) {
          if (out.type === 'message') data.getState().ingest(out.raw, t0 + tick * TICK_MS + 50);
        }
      }
    });

    const { level } = named('risk-zone:z-01')!.userData as {
      level: keyof typeof PALETTE.dark.risk;
    };
    const colorOf = (text: string) => drawn.filter((d) => d.text === text).at(-1)?.color;
    expect([...new Set(drawn.map((d) => d.text))].sort()).toEqual([
      '예시 구역 A',
      '예시 구역 B',
      '예시 구역 C(공중)',
    ]);
    expect(colorOf('예시 구역 A')).toBe(cssHex(PALETTE.dark.risk[level].color));
    expect(colorOf('예시 구역 B')).not.toBe(colorOf('예시 구역 A'));
  });

  it('zone_id 로 선택·초점하고, 없는 구역은 NOT_FOUND 다', async () => {
    await mount();
    await ingest(DEMO_ZONES_RESPONSE);
    const commands = viewer.getState();
    // 선택이 바뀌면 ZoneVolume 이 다시 그려지므로 act 안에서 명령한다.
    const run = (command: () => unknown) => {
      let result: unknown;
      act(() => {
        result = command();
      });
      return result;
    };
    expect(run(() => commands.select({ type: 'zone', id: 'z-01' }))).toEqual({ ok: true });
    expect(viewer.getState().selected).toEqual({ type: 'zone', id: 'z-01' });
    expect(commands.focusOn({ type: 'zone', id: 'z-03' })).toEqual({ ok: true });
    expect(commands.select({ type: 'zone', id: 'z-bad' })).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(commands.focusOn({ type: 'zone', id: 'zoneA' })).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(run(() => commands.clearSelection())).toEqual({ ok: true });
    expect(viewer.getState().selected).toBeNull();
  });

  it('3D 클릭은 zone_id 를 고르고, 광선에 사람이 있으면 그 사람을 고른다', async () => {
    await mount();
    await ingest(DEMO_ZONES_RESPONSE);
    // 장면의 사람(PersonLayer 의 Selectable)이 올라와 있는 상태를 흉내 낸다.
    act(() => viewer.getState().registerTarget({ type: 'person', id: 'w-0001' }));

    const stopped = click('z-01', ['zone:z-01']);
    expect(viewer.getState().selected).toEqual({ type: 'zone', id: 'z-01' });
    expect(stopped).toHaveBeenCalledOnce();

    // 사람이 구역 안(광선상 구역 면 뒤)에 있어도 사람이 골라지고, 클릭은 거기서 끝난다.
    const throughZone = click('z-01', ['zone:z-01', 'person:w-0001', 'zone:z-03']);
    expect(viewer.getState().selected).toEqual({ type: 'person', id: 'w-0001' });
    expect(throughZone).toHaveBeenCalledOnce();
  });

  it('구역이 빠지면 등록·선택을 풀고, 거부·Source 교체 때 이전 구역을 남기지 않는다', async () => {
    await mount();
    await ingest(DEMO_ZONES_RESPONSE);
    act(() => {
      viewer.getState().select({ type: 'zone', id: 'z-02' });
    });

    await ingest({
      ...DEMO_ZONES_RESPONSE,
      zones: DEMO_ZONES_RESPONSE.zones.filter((z) => z.zone_id !== 'z-02'),
    });
    expect(zoneKeys().sort()).toEqual(['zone:z-01', 'zone:z-03']);
    expect(viewer.getState().selected).toBeNull();
    expect(viewer.getState().select({ type: 'zone', id: 'z-02' })).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });

    await ingest(null, false);
    expect(data.getState().zones.status).toBe('REJECTED');
    expect(zoneKeys()).toEqual([]);
    expect(named('zone-layer')!.children).toHaveLength(0);

    await ingest(DEMO_ZONES_RESPONSE);
    await act(async () => data.getState().reset('mock:other'));
    expect(zoneKeys()).toEqual([]);
  });

  it('10 Hz World 를 받아도 구역 메시·형상·재질을 다시 만들지 않는다', async () => {
    await mount();
    await ingest(DEMO_ZONES_RESPONSE);
    const before = named('zone-box:z-01') as Mesh<BoxGeometry, MeshBasicMaterial>;
    const [geometry, material] = [before.geometry, before.material];

    await act(async () => {
      for (let tick = 0; tick < 20; tick++) {
        for (const out of scenarioTick('normal', tick, 1_760_342_400_000)) {
          if (out.type === 'message') data.getState().ingest(out.raw, tick);
        }
      }
    });
    expect(data.getState().counts.world).toBeGreaterThan(10);
    const after = named('zone-box:z-01') as Mesh<BoxGeometry, MeshBasicMaterial>;
    expect(after).toBe(before);
    expect(after.geometry).toBe(geometry);
    expect(after.material).toBe(material);
  });

  it('같은 형상을 다시 받으면 메시·형상을 그대로 두고, 형상이 바뀐 구역만 새 크기가 된다', async () => {
    await mount();
    await ingest(DEMO_ZONES_RESPONSE);
    const z1 = named('zone-box:z-01') as Mesh<BoxGeometry>;
    const z2 = named('zone-box:z-02') as Mesh<BoxGeometry>;
    const z2Geometry = z2.geometry;

    const moved = structuredClone(DEMO_ZONES_RESPONSE);
    moved.zones[0]!.aabb.max_xyz = [4.5, 8.5, 3];
    await ingest(moved);
    expect(named('zone-box:z-01')).toBe(z1);
    expect(z1.geometry.parameters.height).toBe(3);
    expect(named('zone-box:z-02')).toBe(z2);
    expect(z2.geometry).toBe(z2Geometry);
  });

  it('적용 상태는 선 모양과 투명도로 구분하고 기본은 적용 미확인(점선)이다', async () => {
    const lineOf = (id: string) => {
      let dashed: boolean | null = null;
      named(`zone:${id}`)!.traverse((node) => {
        const material = (node as Mesh).material as
          { dashed?: boolean; isLineMaterial?: boolean } | undefined;
        if (dashed === null && material?.isLineMaterial) {
          dashed = Boolean(material.dashed);
        }
      });
      return dashed;
    };
    const fillOf = (id: string) =>
      ((named(`zone-box:${id}`) as Mesh).material as MeshBasicMaterial).opacity;

    await mount();
    await ingest(DEMO_ZONES_RESPONSE);
    expect([lineOf('z-01'), fillOf('z-01')]).toEqual([true, 0.08]);

    await mount('DEMO_ASSUMED_APPLIED');
    expect([lineOf('z-01'), fillOf('z-01')]).toEqual([false, 0.16]);

    await mount('DEMO_PREVIEW');
    expect([lineOf('z-01'), fillOf('z-01')]).toEqual([true, 0.05]);
  });

  it('윤곽선은 구역 심각도 색이고, 배경에 가려진 부분을 덧그리는 흐린 선이 하나 더 있다', async () => {
    type EdgeMaterial = {
      isLineMaterial?: boolean;
      color: { getHex(): number };
      opacity: number;
      depthTest: boolean;
    };
    const edgesOf = (id: string) => {
      const found: EdgeMaterial[] = [];
      named(`zone:${id}`)!.traverse((node) => {
        const material = (node as Mesh).material as unknown as EdgeMaterial | undefined;
        if (material?.isLineMaterial) found.push(material);
      });
      return {
        all: found,
        visible: found.find((m) => m.depthTest)!,
        hidden: found.find((m) => !m.depthTest)!,
      };
    };
    const zone = (zone_id: string, x: number, severity?: string) => ({
      zone_id,
      name: zone_id,
      ...(severity && { severity }),
      aabb: { min_xyz: [x, 0, 0], max_xyz: [x + 1, 1, 1] },
    });

    await mount();
    await ingest({
      contract: 'DEMO_UNCONFIRMED',
      zones: [zone('danger', 0, 'CRITICAL'), zone('warn', 2, 'HIGH'), zone('unknown', 4)],
    });

    const danger = edgesOf('danger');
    expect(danger.all).toHaveLength(2);
    expect(danger.visible.color.getHex()).toBe(PALETTE.dark.risk.CRITICAL.color);
    expect(danger.hidden.color.getHex()).toBe(PALETTE.dark.risk.CRITICAL.color);
    expect(danger.hidden.opacity).toBeGreaterThan(0);
    expect(danger.hidden.opacity).toBeLessThan(danger.visible.opacity);
    expect(edgesOf('warn').visible.color.getHex()).toBe(PALETTE.dark.risk.HIGH.color);
    // 심각도를 모르는 구역은 위험 색으로 지어내지 않고 기본 청록이다.
    expect(edgesOf('unknown').visible.color.getHex()).toBe(PALETTE.dark.zone.color);
  });

  it('StrictMode 이중 마운트 뒤에도 구역 등록은 하나씩이고, 내리면 모두 풀린다', async () => {
    await mount('UNVERIFIED', true);
    await ingest(DEMO_ZONES_RESPONSE);
    expect([...viewer.getState().targets.entries()].filter(([k]) => k.startsWith('zone:'))).toEqual(
      [
        ['zone:z-01', 1],
        ['zone:z-02', 1],
        ['zone:z-03', 1],
      ],
    );
    await act(async () => root!.unmount());
    root = null;
    expect(zoneKeys()).toEqual([]);
  });
});
