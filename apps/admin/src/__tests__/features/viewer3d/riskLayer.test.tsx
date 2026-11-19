import { focusPoint } from '@/features/viewer3d/camera';
import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import {
  DEMO_ZONES_RESPONSE,
  mockMsgId,
  scenarioTick,
  scenarioWorld,
  TICK_MS,
} from '@/features/viewer3d/dev-harness/scenarios';
import { cssHex, PALETTE } from '@/features/viewer3d/palette';
import { PersonLayer } from '@/features/viewer3d/people/PersonLayer';
import type { RiskHighlight } from '@/features/viewer3d/risk/riskPresentation';
import { RiskScope, useRiskHighlight } from '@/features/viewer3d/risk/RiskScope';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { ZoneLayer } from '@/features/viewer3d/zones/ZoneLayer';
import { createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import { act, StrictMode, useEffect } from 'react';
import type { BufferGeometry, Mesh, Object3D, Scene } from 'three';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom 에는 WebGL 이 없다. 그리기만 하는 가짜 renderer 로 R3F 루트를 만들어 실제 ZoneLayer·PersonLayer·위험 표식의
// 장면 트리·등록·자원 유지를 본다. 픽셀·광선 피킹·이동 추종은 격리 WebGL 브라우저에서 따로 확인한다.
extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

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

const T0 = 1_760_342_400_000;
const at = (tick: number) => T0 + tick * TICK_MS + 50;

let scene: Scene | null = null;
function SceneProbe() {
  const current = useThree((s) => s.scene);
  useEffect(() => {
    scene = current;
  }, [current]);
  return null;
}

// 위험 강조 계산이 다시 돌았는지 보려고 w-0001 강조 객체를 렌더마다 모은다.
const seen: (RiskHighlight | null)[] = [];
function RiskProbe() {
  seen.push(useRiskHighlight('person', 'w-0001'));
  return null;
}

let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
let viewer: ViewerStore;
let data: SpatialDataStore;
let tick = 0;

async function mount(strict = false) {
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
        <SceneProbe />
        <RiskScope>
          <RiskProbe />
          <ZoneLayer />
          <PersonLayer />
        </RiskScope>
      </SpatialDataContext>
    </ViewerStoreContext>
  );
  await act(async () => root!.render(strict ? <StrictMode>{tree}</StrictMode> : tree));
}

/** risk-lifecycle 을 지금 tick 부터 until 직전까지 재생한다. */
async function playUntil(until: number) {
  await act(async () => {
    for (; tick < until; tick++) {
      for (const out of scenarioTick('risk-lifecycle', tick, T0)) {
        if (out.type === 'message') data.getState().ingest(out.raw, at(tick));
      }
    }
  });
}

/** tick 10 의 첫 위험 이벤트(w-0001·z-01)를 주의 등급으로 바꾼 메시지. */
function cautionEvent() {
  const out = scenarioTick('risk-lifecycle', 10, T0).find(
    (o) => o.type === 'message' && (o.raw as { msg_type: string }).msg_type === 'risk_event',
  );
  const raw = structuredClone((out as { raw: unknown }).raw) as {
    msg_id: string;
    payload: { severity: string };
  };
  raw.msg_id = mockMsgId('risk-lifecycle', 10, 9);
  raw.payload.severity = 'CAUTION';
  return raw;
}

const named = (name: string) => scene!.getObjectByName(name);
const count = (prefix: string) => {
  const names: string[] = [];
  scene!.traverse((n) => {
    if (n.name.startsWith(prefix)) names.push(n.name);
  });
  return names.sort();
};
const info = (name: string) =>
  named(name)?.userData as
    { level: string; eventIds: string[]; source: string; kind?: string } | undefined;

beforeEach(async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  viewer = createViewerStore();
  viewer.getState().markReady();
  data = createSpatialDataStore();
  data.getState().reset('mock:risk');
  data.getState().setConnection({ state: 'OPEN', at: T0 });
  data.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_RESPONSE) }, T0);
  tick = 0;
  seen.length = 0;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  scene = null;
  vi.restoreAllMocks();
});

describe('위험 표식(같은 장면)', () => {
  it('발생·상향·중첩·부분 해소·전체 해소를 사람과 구역 표식에 그대로 반영한다', async () => {
    await mount();
    await playUntil(10);
    expect(count('risk-')).toEqual([]);

    await playUntil(11);
    expect(count('risk-')).toEqual(['risk-person:w-0001', 'risk-zone:z-01']);
    expect(info('risk-person:w-0001')).toMatchObject({ level: 'HIGH', kind: 'BODY' });

    await playUntil(21);
    expect(info('risk-zone:z-01')!.level).toBe('CRITICAL');

    await playUntil(31);
    expect(count('risk-')).toEqual([
      'risk-person:w-0001',
      'risk-person:w-0002',
      'risk-zone:z-01',
      'risk-zone:z-02',
    ]);
    expect(info('risk-person:w-0001')!.eventIds).toHaveLength(2);

    await playUntil(51);
    expect(count('risk-')).toEqual(['risk-person:w-0001', 'risk-person:w-0002', 'risk-zone:z-02']);
    expect(info('risk-person:w-0001')!.eventIds).toHaveLength(1);

    await playUntil(66);
    expect(count('risk-')).toEqual([]);
  });

  it('주의는 사람 발밑에 링 하나만 그리고 구역 표식은 만들지 않는다', async () => {
    await mount();
    await playUntil(10);
    await act(async () => data.getState().ingest(cautionEvent(), at(10)));
    expect(count('risk-')).toEqual(['risk-person:w-0001']);
    expect(info('risk-person:w-0001')).toMatchObject({ level: 'CAUTION', kind: 'BODY' });
    expect(named('risk-person:w-0001')!.children).toHaveLength(1);
  });

  it('PLANNED 모드에서는 계획 이벤트만 보이고 LIVE 로 돌아오면 원래대로다', async () => {
    await mount();
    await playUntil(41);
    await act(async () => viewer.getState().setMode('PLANNED'));
    expect(count('risk-')).toEqual(['risk-person:w-0003', 'risk-zone:z-01']);
    expect(info('risk-person:w-0003')!.source).toBe('PLANNED');
    await act(async () => viewer.getState().setMode('LIVE'));
    expect(count('risk-person:')).toEqual(['risk-person:w-0001', 'risk-person:w-0002']);
  });

  it('표식은 사람·구역의 메시·재질·이름표 객체와 선택 등록을 바꾸지 않는다', async () => {
    await mount();
    await playUntil(10);
    const avatar = named('person-avatar:w-0001');
    const zoneBox = named('zone-box:z-01') as Mesh;
    const [geometry, material] = [zoneBox.geometry, zoneBox.material];
    const targets = [...viewer.getState().targets.entries()].sort();

    await playUntil(31);
    expect(named('person-avatar:w-0001')).toBe(avatar);
    expect(named('zone-box:z-01')).toBe(zoneBox);
    expect([zoneBox.geometry, zoneBox.material]).toEqual([geometry, material]);
    expect([...viewer.getState().targets.entries()].sort()).toEqual(targets);
    // 표식은 선택 그룹(person:·zone:) 밖에 있어 초점 중심·클릭 경계에 끼지 않는다.
    for (const name of ['risk-person:w-0001', 'risk-zone:z-01']) {
      let parent: Object3D | null = named(name)!.parent;
      while (parent && !/^(person|zone):/.test(parent.name)) parent = parent.parent;
      expect(parent).toBeNull();
    }
  });

  it('위험 표식이 생겨도 사람·구역의 초점 중심은 그대로다', async () => {
    await mount();
    await playUntil(10);
    const center = (name: string) =>
      focusPoint(named(name)!)
        .toArray()
        .map((v) => Math.round(v * 1e6) / 1e6);
    const before = [center('person:w-0001'), center('zone:z-01')];
    await playUntil(11);
    expect(count('risk-')).toHaveLength(2);
    expect([center('person:w-0001'), center('zone:z-01')]).toEqual(before);
  });

  it('표식은 광선 검사에 걸리지 않는다', async () => {
    await mount();
    await playUntil(31);
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(3, 10, -7),
      new THREE.Vector3(0, -1, 0),
    );
    for (const name of ['risk-person:w-0001', 'risk-zone:z-01']) {
      let meshes = 0;
      named(name)!.traverse((node) => {
        if (!(node as Mesh).isMesh && node.type !== 'Line2' && node.type !== 'LineSegments2')
          return;
        meshes += 1;
        // 표식은 광선 검사를 빈 함수로 덮어 쓴다(기본 Line2·Mesh 검사를 쓰지 않는다).
        expect(node.raycast).not.toBe(Object.getPrototypeOf(node).raycast);
        const hits: THREE.Intersection[] = [];
        node.raycast(raycaster, hits);
        expect(hits).toEqual([]);
      });
      expect(meshes).toBeGreaterThan(0);
    }
  });

  it('구역 표식은 수평으로만 넓히고 높이 범위(공중 z-03 포함)는 그대로다', async () => {
    await mount();
    await playUntil(10);
    // z-03 을 가리키는 이벤트를 만든다(tick 10 E1 을 z-03 으로).
    const raw = scenarioTick('risk-lifecycle', 10, T0).flatMap((o) =>
      o.type === 'message' && (o.raw as { msg_type: string }).msg_type === 'risk_event'
        ? [o.raw as { msg_id: string; payload: Record<string, unknown> }]
        : [],
    )[0]!;
    await act(async () =>
      data.getState().ingest(
        {
          ...raw,
          msg_id: mockMsgId('risk-lifecycle', 700, 1),
          payload: {
            ...raw.payload,
            event_id: '01890a5d-ac96-774b-bcce-b302099a8057',
            zone_id: 'z-03',
          },
        },
        at(10),
      ),
    );
    const mark = named('risk-zone:z-03')!;
    const box = new THREE.Box3();
    mark.updateWorldMatrix(true, true);
    mark.traverse((node) => {
      const g = (node as Mesh).geometry as BufferGeometry | undefined;
      if (node.type !== 'LineSegments2' || !g) return;
      g.computeBoundingBox();
      box.union(g.boundingBox!.clone().applyMatrix4(node.matrixWorld));
    });
    const r = (v: number) => Math.round(v * 1e6) / 1e6;
    expect([r(box.min.y), r(box.max.y)]).toEqual([1.2, 2.4]);
    expect([r(box.max.x - box.min.x), r(box.max.z - box.min.z)]).toEqual([2.12, 1.62]);
  });

  it('높이를 모르는 사람에게는 바닥 고리 대신 세로 표식을 두른다', async () => {
    // invalid-input 의 w-0003 은 3D 위치가 없다(XY_ONLY).
    const world = scenarioWorld('invalid-input', 1, T0);
    await act(async () => data.getState().ingest(world, at(1)));
    await mount();
    const raw = scenarioTick('risk-lifecycle', 10, T0).flatMap((o) =>
      o.type === 'message' && (o.raw as { msg_type: string }).msg_type === 'risk_event'
        ? [o.raw as { msg_id: string; payload: Record<string, unknown> }]
        : [],
    )[0]!;
    await act(async () =>
      data.getState().ingest(
        {
          ...raw,
          msg_id: mockMsgId('risk-lifecycle', 701, 1),
          payload: { ...raw.payload, world_ids: ['w-0003'], zone_id: null },
        },
        at(10),
      ),
    );
    expect(info('risk-person:w-0003')).toMatchObject({ kind: 'COLUMN', level: 'HIGH' });
    let minY = Infinity;
    named('risk-person:w-0003')!.traverse((node) => {
      const g = (node as Mesh).geometry as BufferGeometry | undefined;
      if (node.type !== 'LineSegments2' || !g) return;
      g.computeBoundingBox();
      minY = Math.min(minY, g.boundingBox!.min.y);
    });
    expect(minY).toBeGreaterThanOrEqual(0.1);
  });

  it('10 Hz World 만 바뀔 때는 강조를 다시 계산하지 않는다', async () => {
    await mount();
    await playUntil(31);
    const before = seen.at(-1);
    expect(before?.eventIds).toHaveLength(2);
    // tick 31~34 에는 이벤트가 없다(World 4번).
    await playUntil(35);
    expect(data.getState().counts.world).toBe(35);
    expect(new Set(seen.slice(seen.indexOf(before!))).size).toBe(1);
  });

  it('연결이 끊기면 강조를 지우지 않고, Source 를 바꾸면 모두 정리한다', async () => {
    await mount();
    await playUntil(31);
    await act(async () => data.getState().setConnection({ state: 'CLOSED', at: at(31) }));
    expect(count('risk-')).toHaveLength(4);
    expect(seen.at(-1)!.lastReceived).toBe(true);
    await act(async () => data.getState().reset('mock:other'));
    expect(count('risk-')).toEqual([]);
  });

  it('StrictMode 이중 마운트에도 표식은 대상마다 하나이고 내리면 모두 풀린다', async () => {
    await mount(true);
    await playUntil(31);
    expect(count('risk-person:w-0001')).toEqual(['risk-person:w-0001']);
    expect(count('risk-zone:')).toEqual(['risk-zone:z-01', 'risk-zone:z-02']);
    await act(async () => root!.unmount());
    root = null;
    expect([...viewer.getState().targets.keys()]).toEqual([]);
  });
});

describe('이름표(같은 장면)', () => {
  it('사람 이름표는 위험일 때도 ID 만 적고, 모든 이름표가 포인터 없이 보이며, 위험이면 글자 색만 바뀐다', async () => {
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
    await mount();
    await playUntil(11);

    const texts = [...new Set(drawn.map((d) => d.text))];
    const people = texts.filter((text) => text.includes('w-'));
    expect(people.length).toBeGreaterThan(1);
    expect(people.every((text) => /^w-\d{4}$/.test(text))).toBe(true);

    const colorOf = (text: string) => drawn.filter((d) => d.text === text).at(-1)?.color;
    const { level } = named('risk-person:w-0001')!.userData as {
      level: keyof typeof PALETTE.dark.risk;
    };
    expect(colorOf('w-0001')).toBe(cssHex(PALETTE.dark.risk[level].color));
    const calm = people.find((text) => text !== 'w-0001')!;
    expect(colorOf(calm)).not.toBe(colorOf('w-0001'));

    const sprites: THREE.Sprite[] = [];
    scene!.traverse((node) => {
      if (node instanceof THREE.Sprite) sprites.push(node);
    });
    expect(viewer.getState().selected).toBeNull();
    expect(sprites).toHaveLength(texts.length);
    expect(sprites.every((sprite) => sprite.visible)).toBe(true);
  });
});
