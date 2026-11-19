import type { ViewerHealthMessage } from '@simai/contracts';

// world·health·위험 이벤트 시나리오가 함께 쓰는 값: 버전, 카메라, 바퀴 시간, msg_id.

/** 메시지 봉투의 보낸 곳. */
export const SOURCE_ID = 'ec2';

export const VERSIONS = { calibration: 'cal-7', scene: 'scene-3', config: 'cfg-12' } as const;
/** Scene 불일치 흉내에서 Tier 0 가 아직 판정에 쓰는 이전 Scene. */
export const PREVIOUS_SCENE = 'scene-2';
export const CAMERAS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'] as const;
export type CameraId = (typeof CAMERAS)[number];

/** health 의 구성 묶음 상태(명세 FR-17). 구역 mock 이 발행·ACK 를 흉내 내며 바꾼다. */
export type MockConfig = ViewerHealthMessage['payload']['config'];
export const MOCK_CONFIG: MockConfig = {
  published_version: VERSIONS.config,
  applied_version: VERSIONS.config,
  sync: 'CURRENT',
};

/** 위험 이벤트 한 바퀴(ms). 바퀴마다 같은 이벤트가 같은 순서로 일어난다. */
export const EVENT_CYCLE_MS = 40_000;

/** 마지막 World 상태(t_latest_global)가 보낸 시각보다 늦은 만큼(ms). */
export const LATEST_GLOBAL_LAG_MS = 120;

/** 소수 둘째 자리까지 반올림. */
export const r2 = (value: number) => Math.round(value * 100) / 100;

/** 바퀴(EVENT_CYCLE_MS) 안에서 cam_C 가 키프레임을 기다리는 구간(ms). 시스템 상태 화면의 빈칸·비정상 카메라를 보인다. */
const CAM3_DOWN = { from: 20_000, to: 26_000 } as const;

export const cam3DownAt = (t: number) => {
  const inCycle = t % EVENT_CYCLE_MS;
  return inCycle >= CAM3_DOWN.from && inCycle < CAM3_DOWN.to;
};

/** 시각 t 에 영상을 보내는 카메라만 남긴다. cam_C 가 키프레임을 기다리는 동안은 cam_C 로 관측하지 않는다. */
export const sending = (ids: readonly CameraId[], t: number) =>
  ids.filter((id) => id !== 'cam_C' || !cam3DownAt(t));

/** UUID 끝 12자리(16진). */
export const uuidTail = (n: number) => (n % 2 ** 48).toString(16).padStart(12, '0');

const MSG_ID_PREFIX = '0192a6f0-7c1e-4b3a-9f2d-';
let messages = 0;
/** 메시지마다 다른 msg_id(UUID 형식). 다른 mock(이벤트 저장소)도 쓴다. */
export const nextMsgId = () => `${MSG_ID_PREFIX}${uuidTail(++messages)}`;
