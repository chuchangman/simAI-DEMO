import type { SpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import { useSpatialDataStore } from '@/features/viewer3d/data/SpatialDataProvider';
import type { ViewerStatus, ViewerTarget } from '@/features/viewer3d/types';
import { WORLD_REFERENCE_POINTS } from '@/features/viewer3d/WorldReference';
import { useThree, type RootState } from '@react-three/fiber';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Box3, Vector3, type BoxGeometry, type Mesh, type Object3D } from 'three';

// Spatial 진단 도구. 같은 Canvas·renderer·Scene·Camera 가 유지되는지, World 기준점이 어디 놓였는지 숫자로 확인한다.
// 측정은 버튼을 누를 때만 한다. 접혀 있거나 다른 보기일 때는 아무것도 읽지 않는다.
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (value: object) => {
  if (!ids.has(value)) ids.set(value, nextId++);
  return ids.get(value)!;
};
const renderers = new Set<number>();
let readState: (() => RootState) | null = null;
let readData: SpatialDataStore | null = null;

/** Canvas 안에 두어 렌더러 상태를 읽을 수 있게 한다. 화면에는 아무것도 그리지 않아 모든 보기에 둔다. */
export function DebugProbe() {
  const get = useThree((s) => s.get);
  const data = useSpatialDataStore();
  useEffect(() => {
    readState = get;
    readData = data;
    renderers.add(idOf(get().gl));
  }, [get, data]);
  return null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

// 기준점이 장면에 실제로 놓인 Three 좌표. World 기준점을 띄운 보기에서만 값이 있다.
function worldRefsOf(state: RootState) {
  const out: Record<string, number[] | null> = {};
  for (const point of WORLD_REFERENCE_POINTS) {
    const object = state.scene.getObjectByName(`world-ref:${point.key}`);
    out[point.key] = object ? object.getWorldPosition(new Vector3()).toArray().map(round) : null;
  }
  return out;
}

function screenOf(state: RootState, object: Object3D | undefined) {
  if (!object) return null;
  const point = new Box3().setFromObject(object).getCenter(new Vector3()).project(state.camera);
  const rect = state.gl.domElement.getBoundingClientRect();
  return [
    Math.round(rect.left + ((point.x + 1) / 2) * rect.width),
    Math.round(rect.top + ((1 - point.y) / 2) * rect.height),
  ];
}

/** 장면의 첫 사람(Selectable 이름 person:<id>)과 그 화면 좌표·Three 발 위치. */
function firstPerson(state: RootState) {
  let found: Object3D | undefined;
  state.scene.traverse((node) => {
    if (!found && node.name.startsWith('person:')) found = node;
  });
  if (!found) return null;
  const avatar = found.children[0];
  const body = avatar?.children[0];
  return {
    id: found.name,
    screen: screenOf(state, found),
    feet: avatar ? avatar.getWorldPosition(new Vector3()).toArray().map(round) : null,
    yaw: body ? round(body.rotation.y) : null,
  };
}

/**
 * 장면에 올라온 구역(Selectable 이름 zone:<id>)의 화면 좌표와, Provider 구역이면 실제 상자의 Three 중심·크기.
 * 레거시 고정 구역(zoneA·zoneB)은 상자 이름이 없어 box 가 null 이다.
 */
function zonesOf(state: RootState) {
  const out: Record<
    string,
    { screen: number[] | null; box: { center: number[]; size: number[] } | null }
  > = {};
  state.scene.traverse((node) => {
    if (!node.name.startsWith('zone:')) return;
    const id = node.name.slice('zone:'.length);
    const mesh = state.scene.getObjectByName(`zone-box:${id}`) as Mesh<BoxGeometry> | undefined;
    const p = mesh?.geometry.parameters;
    out[id] = {
      screen: screenOf(state, node),
      box:
        mesh && p
          ? {
              center: mesh.getWorldPosition(new Vector3()).toArray().map(round),
              size: [p.width, p.height, p.depth].map(round),
            }
          : null,
    };
  });
  return out;
}

/**
 * 장면의 위험 표식(risk-person:<id>·risk-zone:<id>)과 등급·이벤트 수, 표식의 World 위치(Three).
 * 사람 표식 위치가 사람 아바타 위치와 같아야 이동을 따라간 것이다.
 */
function risksOf(state: RootState) {
  const out: Record<
    string,
    { level: string; events: number; at: number[]; receiveToApplyMs: number | null }
  > = {};
  const events = readData?.getState().events;
  state.scene.traverse((node) => {
    if (!node.name.startsWith('risk-')) return;
    const data = node.userData as {
      level: string;
      eventIds: string[];
      source: string;
      appliedAt?: number;
    };
    // 이 강조에 든 이벤트 중 가장 늦게 받은 것부터 장면 반영까지(같은 브라우저 시계).
    const received = (data.eventIds ?? []).map(
      (id) => events?.get(`${data.source}:${id}`)?.meta.receivedAt ?? 0,
    );
    out[node.name] = {
      level: data.level,
      events: data.eventIds?.length ?? 0,
      at: node.getWorldPosition(new Vector3()).toArray().map(round),
      receiveToApplyMs:
        data.appliedAt && received.length ? data.appliedAt - Math.max(...received) : null,
    };
  });
  return out;
}

/** 마지막 프레임의 그리기 호출·삼각형 수와 살아 있는 GPU 자원 수, 브라우저가 알려 주면 JS 힙(MB). */
function rendererOf(state: RootState) {
  const info = state.gl.info;
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    calls: info.render.calls,
    triangles: info.render.triangles,
    lines: info.render.lines,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs?.length ?? null,
    heapMB: memory ? round(memory.usedJSHeapSize / 1048576) : null,
  };
}

function measure() {
  return measureNow();
}

/**
 * 개발 진단용 프레임 측정. 이 탭의 requestAnimationFrame 간격(ms)과 그동안 실제로 그린 프레임 수, 끝난 뒤의 렌더러 자원·힙을 잰다.
 * 브라우저·창 크기·다른 탭 부하에 따라 달라지는 참고값이다(-56 10명 30 FPS 목표 판정이 아니다).
 */
function measureFrames(durationMs: number) {
  const state = readState?.();
  const startFrame = state?.gl.info.render.frame ?? 0;
  return new Promise<Record<string, unknown>>((resolve) => {
    const gaps: number[] = [];
    const begin = performance.now();
    let last = begin;
    const loop = (time: number) => {
      gaps.push(time - last);
      last = time;
      if (time - begin < durationMs) {
        requestAnimationFrame(loop);
        return;
      }
      const sorted = gaps.slice(1).sort((a, b) => a - b);
      const at = (p: number) =>
        round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0);
      const after = readState?.();
      resolve({
        seconds: round((last - begin) / 1000),
        fps: round(sorted.length / ((last - begin) / 1000)),
        frameMs: { p50: at(0.5), p95: at(0.95), max: at(1) },
        rendered: after ? after.gl.info.render.frame - startFrame : null,
        renderer: after ? rendererOf(after) : null,
        size: after ? [after.size.width, after.size.height, after.viewport.dpr] : null,
      });
    };
    requestAnimationFrame(loop);
  });
}

function measureNow() {
  const canvas = document.querySelector('canvas');
  const state = readState?.();
  if (!state || !canvas) return { canvases: document.querySelectorAll('canvas').length };
  const controls = state.controls as unknown as { target: Vector3 } | null;
  const target = controls?.target ?? new Vector3();
  return {
    canvases: document.querySelectorAll('canvas').length,
    canvasId: idOf(canvas),
    rendererId: idOf(state.gl),
    sceneId: idOf(state.scene),
    cameraId: idOf(state.camera),
    renderersCreated: renderers.size,
    camera: state.camera.position.toArray().map(round),
    target: target.toArray().map(round),
    distance: round(state.camera.position.distanceTo(target)),
    size: [state.size.width, state.size.height],
    screen: {
      // 화면에 있는 첫 사람(Provider 의 World ID 또는 입력 없음일 때의 예전 작업자).
      person: firstPerson(state),
      'world-ref:O': screenOf(state, state.scene.getObjectByName('world-ref:O')),
    },
    zones: zonesOf(state),
    risks: risksOf(state),
    renderer: rendererOf(state),
    worldRefs: worldRefsOf(state),
  };
}

/** World 기준 표시 범례. DEMO 교실이 실측이 아님을 함께 알린다. */
function WorldLegend() {
  return (
    <div className="smk-legend" data-testid="world-legend">
      <p>원점 O = 교실 모서리 바닥(Z=0)</p>
      <p>
        <b className="smk-axis" data-axis="X">
          X
        </b>{' '}
        <b className="smk-axis" data-axis="Y">
          Y
        </b>{' '}
        <b className="smk-axis" data-axis="Z">
          Z(위)
        </b>{' '}
        · 표식 간격 1m
      </p>
      <p className="smk-hint">DEMO 10×10m 교실 · 실측·캘리브레이션 아님</p>
    </div>
  );
}

interface SpatialDiagnosticsProps {
  open: boolean;
  onToggle: () => void;
  status: ViewerStatus | null;
  selected: ViewerTarget | null;
  /** 데이터 Provider 진단(입력 선택·Track·이벤트). */
  children?: ReactNode;
}

/** World 범례와 측정을 한 곳에 모은 접이식 진단 영역. 접으면 제목과 뷰어 상태 한 줄만 남는다. */
export function SpatialDiagnostics({
  open,
  onToggle,
  status,
  selected,
  children,
}: SpatialDiagnosticsProps) {
  const [out, setOut] = useState('');
  const [perf, setPerf] = useState('');
  return (
    <section
      aria-label="Spatial 진단"
      data-testid="spatial-diagnostics"
      className="smk-diag smk-float"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="smk-diag-body"
        className="smk-diag-head"
        onClick={onToggle}
      >
        <span className="smk-card-title">Spatial 진단</span>
        <span className="smk-diag-state smk-mono" data-testid="diag-status">
          {status ? `${status.phase} · ${status.mode}` : '—'}
        </span>
        {open ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
      </button>
      {open && (
        <div id="smk-diag-body" className="smk-diag-body">
          <WorldLegend />
          <p className="smk-id smk-mono" data-testid="diag-selected">
            선택 {selected ? `${selected.type}:${selected.id}` : '없음'}
          </p>
          <button
            type="button"
            className="smk-chip"
            onClick={() => setOut(JSON.stringify(measure()))}
          >
            측정
          </button>
          <button
            type="button"
            className="smk-chip"
            onClick={() => {
              setPerf('측정 중…');
              void measureFrames(5000).then((result) => setPerf(JSON.stringify(result)));
            }}
          >
            프레임 5초
          </button>
          <pre data-testid="debug-out" className="smk-mono">
            {out}
          </pre>
          <pre data-testid="perf-out" className="smk-mono">
            {perf}
          </pre>
          {children}
        </div>
      )}
    </section>
  );
}
