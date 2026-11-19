import {
  createExternalSource,
  type ExternalSpatialSource,
  type SpatialSource,
} from '@/features/viewer3d/data/spatialSource';
import {
  createMockSource,
  type MockSpatialSource,
} from '@/features/viewer3d/dev-harness/mockSource';
import type { SpatialMockApi } from '@/features/viewer3d/dev-harness/mswHandlers';
import type { GeometryMode } from '@/features/viewer3d/dev-harness/officialFixtures';
import {
  DEMO_MAX_TICKS,
  isScenarioKey,
  SCENARIOS,
  type ScenarioKey,
} from '@/features/viewer3d/dev-harness/scenarios';
import riskEventExample from '@/features/viewer3d/replay/fixtures/risk_event.example.jsonl?raw';
import worldStateExample from '@/features/viewer3d/replay/fixtures/world_state.example.jsonl?raw';
import {
  parseReplayLog,
  type ReplayFile,
  type ReplayLog,
} from '@/features/viewer3d/replay/replayLog';
import {
  createReplaySource,
  type ReplaySpatialSource,
} from '@/features/viewer3d/replay/replaySource';
import type { ZoneApplyState } from '@/features/viewer3d/zones/zonePresentation';

// 개발 화면의 데이터 입력 선택. 시나리오 Mock, 외부 Live 주입 시험, 녹화 재생(JSONL), 입력 없음.

export const DATA_SOURCES = [
  ...SCENARIOS.map((s) => ({ key: s.key as DataSourceKey, label: `Mock · ${s.label}` })),
  { key: 'external' as DataSourceKey, label: '외부 입력 시험(JSON 주입)' },
  { key: 'replay' as DataSourceKey, label: '녹화 재생(world_state JSONL)' },
  { key: 'off' as DataSourceKey, label: '입력 없음' },
];

export type DataSourceKey = ScenarioKey | 'external' | 'replay' | 'off';

const PARAM = 'source';
const DEFAULT: DataSourceKey = 'normal';

/**
 * 개발 PC 에만 두는 XBot 모델 위치. Git 에 넣지 않는다(node_modules 는 .gitignore 대상).
 * 'simAI 관제 데모/xbot.glb.txt'(base64)를 풀어 front/apps/admin/node_modules/.cache/spatial-dev/xbot.glb 로 둔다.
 * 파일이 없으면 모델 읽기가 실패하고 캡슐 아바타로 그린다.
 */
export const DEV_XBOT_URL = '/node_modules/.cache/spatial-dev/xbot.glb';

export type AvatarKind = 'xbot' | 'capsule';

/** ?avatar=capsule 이면 캡슐만, 그 밖에는 XBot 을 먼저 시도한다. */
export function readAvatar(search: string): AvatarKind {
  return new URLSearchParams(search).get('avatar')?.toLowerCase() === 'capsule'
    ? 'capsule'
    : 'xbot';
}

/** ?avatarMesh=off 면 사람 메시(EXP-02)를 끄고 골격 막대·캡슐로만 그린다. 배포 화면은 메시가 거의 없어 그 모습을 본다. */
export function readAvatarMesh(search: string): 'auto' | 'off' {
  return new URLSearchParams(search).get('avatarMesh')?.toLowerCase() === 'off' ? 'off' : 'auto';
}

const isDataSourceKey = (value: unknown): value is DataSourceKey =>
  isScenarioKey(value) || value === 'external' || value === 'replay' || value === 'off';

/** 개발 화면의 구역 적용 상태 표시 시험. ?zones=preview|applied, 없거나 모르면 적용 미확인. */
const ZONE_PARAM: Record<string, ZoneApplyState> = {
  unverified: 'UNVERIFIED',
  preview: 'DEMO_PREVIEW',
  applied: 'DEMO_ASSUMED_APPLIED',
};

export const ZONE_APPLY_OPTIONS: { key: ZoneApplyState; label: string }[] = [
  { key: 'UNVERIFIED', label: '구역 · 적용 미확인(기본)' },
  { key: 'DEMO_PREVIEW', label: '구역 · 미리보기(DEMO)' },
  { key: 'DEMO_ASSUMED_APPLIED', label: '구역 · 적용 가정(DEMO)' },
];

export function readZoneApply(search: string): ZoneApplyState {
  return ZONE_PARAM[new URLSearchParams(search).get('zones')?.toLowerCase() ?? ''] ?? 'UNVERIFIED';
}

/** zones 만 바꾼 주소. 기본값이면 매개변수를 지운다. */
export function withZoneApply(href: string, state: ZoneApplyState): string {
  const url = new URL(href);
  const key = Object.keys(ZONE_PARAM).find((k) => ZONE_PARAM[k] === state);
  if (!key || state === 'UNVERIFIED') url.searchParams.delete('zones');
  else url.searchParams.set('zones', key);
  return url.toString();
}

/** ?source=<시나리오>|external|replay|off. 없거나 모르면 normal. */
export function readDataSource(search: string): DataSourceKey {
  const value = new URLSearchParams(search).get(PARAM)?.toLowerCase();
  return isDataSourceKey(value) ? value : DEFAULT;
}

/** source 만 바꾼 주소. 다른 매개변수와 해시는 그대로 둔다. */
export function withDataSource(href: string, key: DataSourceKey): string {
  const url = new URL(href);
  url.searchParams.set(PARAM, key);
  return url.toString();
}

export interface HarnessSource {
  source: SpatialSource | null;
  /** 재생 조작 대상. 입력 없음이면 null. */
  mock: MockSpatialSource | null;
  /** 녹화 재생 조작 대상. 재생 입력이 아니면 null. */
  replay: ReplaySpatialSource | null;
  /** 외부 입력 시험의 ExternalSpatialSource(형상 보관·비우기 시험용, -234). 그 밖에는 null. */
  external?: ExternalSpatialSource | null;
}

/**
 * 녹화 재생 예시. contracts/examples 의 world_state·risk_event 를 여러 프레임으로 이어 쓴 것이다(1.5초 기록 없는 구간 포함).
 * Tier 0 file 입력(-215) 출력과 같은 두 파일 이름이다. 실제 교실 녹화 결과는 개발 화면에서 파일로 고른다.
 */
export const EXAMPLE_REPLAY_FILES: readonly ReplayFile[] = [
  { name: 'world_state.example.jsonl', text: worldStateExample },
  { name: 'risk_event.example.jsonl', text: riskEventExample },
];

export const exampleReplayLog = (): ReplayLog => parseReplayLog(EXAMPLE_REPLAY_FILES);

/** 고른 재생 기록 파일을 글자(UTF-8)로 읽는다. */
export function readReplayFiles(list: FileList | readonly File[]): Promise<ReplayFile[]> {
  return Promise.all(
    Array.from(list, async (file) => ({ name: file.name, text: await file.text() })),
  );
}

/**
 * 외부 입력 시험: Mock 정상 시나리오를 JSON 문자열로 바꿨다가 다시 읽어 createExternalSource 로 밀어 넣는다.
 * FE 가 STOMP 본문을 받아 push 하는 경로와 같다. 구독이 모두 풀리면 Mock 도 멈춘다.
 */
function relay(mock: MockSpatialSource): {
  source: SpatialSource;
  external: ExternalSpatialSource;
} {
  const external = createExternalSource(`external:${mock.id}`);
  let stop: (() => void) | null = null;
  const source: SpatialSource = {
    id: external.id,
    kind: 'EXTERNAL',
    subscribe(sink) {
      const off = external.subscribe(sink);
      stop ??= mock.subscribe({
        onMessage: (raw) => external.push(JSON.parse(JSON.stringify(raw))),
        onConnectionChange: (change) => external.setConnection(change.state, change.reason),
        onZones: (result) => external.pushZones(result),
        onWorkSurfaces: (result) => external.pushWorkSurfaces(result),
      });
      return () => {
        off();
        if (external.subscriberCount === 0) {
          stop?.();
          stop = null;
        }
      };
    },
  };
  return { source, external };
}

/**
 * 고른 입력의 Source 를 만든다. 다시 만들면 새 id 라 Viewer 가 데이터를 비우고 처음부터 받는다.
 * 재생은 고른 기록(replayLog), 없으면 예시 기록을 처음부터 재생한다.
 */
export function createHarnessSource(
  key: DataSourceKey,
  restBase: string | null,
  api: SpatialMockApi | null,
  replayLog: ReplayLog | null = null,
  geometry: GeometryMode = 'demo',
): HarnessSource {
  if (key === 'off') return { source: null, mock: null, replay: null };
  if (key === 'replay') {
    const replay = createReplaySource(replayLog ?? exampleReplayLog(), { autoplay: true });
    return { source: replay, mock: null, replay };
  }
  const scenario: ScenarioKey = key === 'external' ? 'normal' : key;
  const mock = createMockSource({
    scenario,
    restBase,
    reactivateMocks: api ? () => api.reactivate() : undefined,
    maxTicks: DEMO_MAX_TICKS[scenario],
    geometry,
  });
  // REST 스냅샷이 같은 시나리오·시각축에서 나오게 맞춘다.
  api?.setScenario(scenario, mock.t0);
  api?.setGeometry(geometry);
  if (key !== 'external') return { source: mock, mock, replay: null };
  const relayed = relay(mock);
  return { source: relayed.source, mock, replay: null, external: relayed.external };
}
