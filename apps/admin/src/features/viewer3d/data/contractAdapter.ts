import {
  isZoneSeverity,
  type HealthView,
  type MessageMeta,
  type RiskEventView,
  type SkeletonView,
  type TrackView,
  type WorldFrame,
  type ZoneSnapshot,
  type ZoneView,
} from '@/features/viewer3d/data/spatialFrame';
import { avatarFrameOf, type AvatarFrameView } from '@/features/viewer3d/people/avatarFrame';
import { toWorldPoint, type WorldPoint } from '@/features/viewer3d/worldCoordinates';
import { adaptOfficialZones } from '@/features/viewer3d/zones/officialZones';
import {
  isMessageType,
  validateMessage,
  type AvatarFrameMessage,
  type Envelope,
  type RiskEventMessage,
  type Skeleton,
  type ValidationError,
  type ViewerHealthMessage,
  type WorldStateMessage,
  type WorldTrack,
} from '@simai/contracts';
import { z } from 'zod';

// 받은 메시지를 계약(@simai/contracts 검증기)으로 검사한 뒤 View Model 로 옮긴다. Mock 과 외부 입력이 같은 길을 지난다.
// 값의 뜻은 바꾸지 않는다. 계약에 없는 값을 채우지 않고, 모르는 값은 null 로 둔다.

export type RejectReason = 'NOT_OBJECT' | 'UNKNOWN_MSG_TYPE' | 'SCHEMA' | 'NON_FINITE';

export type AdaptResult =
  | { kind: 'world'; frame: WorldFrame }
  | { kind: 'event'; event: RiskEventView }
  | { kind: 'health'; health: HealthView }
  /** avatar_frame(/topic/avatar, EXP-02, -65). 사람별 관절 회전과 자산만 싣는다(위치는 world_state). */
  | { kind: 'avatar'; frame: AvatarFrameView }
  | { kind: 'rejected'; reason: RejectReason; msgType: string | null; detail: string };

class NonFinite extends Error {}

/**
 * 관절 가시성 필드 이름(계약 skeleton.visible). 소스에 그 단어를 그대로 두면 Tailwind 가 같은 이름의 유틸리티를
 * 운영 CSS 에 만든다(앱 src 전체를 훑는다). 그래서 이어 붙여 만들고 이 상수 하나로만 읽고 쓴다.
 */
export const SKELETON_VISIBLE_KEY = ['visi', 'ble'].join('') as keyof Skeleton;

function point(value: readonly number[] | null | undefined): WorldPoint | null {
  if (value === null || value === undefined) return null;
  const p = toWorldPoint(value);
  if (!p) throw new NonFinite('World 좌표가 유한한 숫자 3개가 아니다');
  return p;
}

const tuple = <T extends readonly number[]>(value: T | null | undefined): T | null =>
  value ? ([...value] as unknown as T) : null;

function metaOf(message: Envelope, receivedAt: number): MessageMeta {
  return {
    msgId: message.msg_id,
    schemaVersion: message.schema_version,
    sourceId: message.source_id,
    sentAt: message.sent_at,
    receivedAt,
  };
}

function skeletonOf(skeleton: WorldTrack['skeleton']): SkeletonView | null {
  if (!skeleton) return null;
  return {
    layout: skeleton.joint_layout,
    joints: skeleton.joints.map((joint) => point(joint)),
    jointVisible: [...(skeleton[SKELETON_VISIBLE_KEY] as boolean[])],
    validity: [...skeleton.validity],
    jointSource: [...skeleton.joint_source],
  };
}

function trackOf(track: WorldTrack): TrackView {
  return {
    worldId: track.world_id,
    tLastValid: track.t_last_valid,
    observationState: track.observation_state,
    lifecycle: track.track_lifecycle,
    identityConfidence: track.identity_confidence,
    identityRevision: track.identity_revision,
    aliases: track.aliases ? [...track.aliases] : [],
    splitFrom: track.split_from ?? null,
    frameAgeMs: track.frame_age_ms ?? null,
    positionXy: [track.position_xy[0], track.position_xy[1]],
    positionXySigma: [track.position_xy_sigma[0], track.position_xy_sigma[1]],
    pelvis: point(track.pelvis_xyz),
    groundAnchor: point(track.ground_anchor_xyz),
    groundAnchorSigma: tuple(track.ground_anchor_sigma),
    surfaceSource: track.surface_source ?? null,
    supportSurfaceId: track.support_surface_id,
    supportSurfaceValidity: track.support_surface_validity,
    contactValidity: track.contact_validity,
    zValidity: track.z_validity,
    headZ: track.head_z,
    headZSigma: track.head_z_sigma ?? null,
    headZValidity: track.head_z_validity ?? null,
    velocity: tuple(track.velocity),
    cameras: [...track.cameras],
    skeleton: skeletonOf(track.skeleton),
  };
}

function worldOf(message: WorldStateMessage, receivedAt: number): WorldFrame {
  const { payload } = message;
  return {
    meta: metaOf(message, receivedAt),
    tLatestGlobal: payload.t_latest_global,
    calibrationVersion: payload.calibration_version,
    sceneVersion: payload.scene_version,
    configVersion: payload.config_version ?? null,
    inputSource: payload.input_provenance?.frames.source ?? null,
    isUpperBound: payload.input_provenance?.is_upper_bound ?? null,
    tracks: payload.tracks.map(trackOf),
  };
}

function eventOf(message: RiskEventMessage, receivedAt: number): RiskEventView {
  const p = message.payload;
  return {
    meta: metaOf(message, receivedAt),
    eventId: p.event_id,
    eventSequence: p.event_sequence ?? null,
    ruleId: p.rule_id,
    ruleVersion: p.rule_version,
    source: p.source,
    lifecycle: p.lifecycle,
    verification: p.verification,
    severity: p.severity,
    confidence: p.confidence,
    needsCheck: p.needs_check,
    confidenceReasons: p.confidence_reasons ? [...p.confidence_reasons] : null,
    resumeCount: p.resume_count ?? 0,
    worldIds: [...p.world_ids],
    zoneId: p.zone_id,
    metrics: { ...p.metrics },
    rationale: p.rationale,
    proposedSeverity: p.proposed_severity,
    raisedAt: p.raised_at ?? null,
    updatedAt: p.updated_at ?? null,
    resolvedAt: p.resolved_at ?? null,
    operatorClosed: p.resolution?.kind === 'OPERATOR_CLOSED',
    ackCount: p.acks?.length ?? 0,
    escalationCount: p.escalations?.length ?? 0,
    sceneVersion: p.scene_version ?? null,
    delivery: p.delivery ?? null,
  };
}

function healthOf(message: ViewerHealthMessage, receivedAt: number): HealthView {
  const p = message.payload;
  return {
    meta: metaOf(message, receivedAt),
    asOf: p.as_of,
    systemHealth: p.system_health,
    remoteState: p.remote_state,
    tier0Link: p.tier0_link,
    laptopLink: p.laptop.link,
    laptopLastHeartbeatAt: p.laptop.last_heartbeat_at,
    dataAgeMs: p.data_age_ms,
    calibrationState: p.calibration_state,
    config: {
      publishedVersion: p.config.published_version,
      appliedVersion: p.config.applied_version,
      sync: p.config.sync,
    },
    scene: {
      committedVersion: p.scene.committed_version,
      liveVersion: p.scene.live_version,
      mismatch: p.scene.mismatch,
      ...(p.scene.compatibility ? { compatibility: p.scene.compatibility } : {}),
    },
  };
}

const describe = (errors: ValidationError[]) => {
  const first = errors[0];
  if (!first) return '계약 검사 실패';
  return `${first.instancePath || '/'} ${first.message ?? first.keyword}`.trim();
};

/** 계약에 없거나 뷰어가 옮기지 않는 msg_type 은 모르는 종류로 거부한다. */
const unknownMsgType = (msgType: unknown): AdaptResult => ({
  kind: 'rejected',
  reason: 'UNKNOWN_MSG_TYPE',
  msgType: typeof msgType === 'string' ? msgType : null,
  detail: `모르는 msg_type: ${String(msgType)}`,
});

/** 메시지 하나를 검사·변환한다. 예외를 던지지 않는다. */
export function adaptMessage(raw: unknown, receivedAt: number): AdaptResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      kind: 'rejected',
      reason: 'NOT_OBJECT',
      msgType: null,
      detail: '메시지가 객체가 아니다',
    };
  }
  const msgType = (raw as { msg_type?: unknown }).msg_type;
  if (!isMessageType(msgType)) return unknownMsgType(msgType);
  const checked = validateMessage(msgType, raw);
  if (!checked.ok) {
    return { kind: 'rejected', reason: 'SCHEMA', msgType, detail: describe(checked.errors) };
  }
  try {
    switch (msgType) {
      case 'world_state':
        return { kind: 'world', frame: worldOf(checked.message as WorldStateMessage, receivedAt) };
      case 'risk_event':
        return { kind: 'event', event: eventOf(checked.message as RiskEventMessage, receivedAt) };
      case 'viewer_health':
        return {
          kind: 'health',
          health: healthOf(checked.message as ViewerHealthMessage, receivedAt),
        };
      case 'avatar_frame':
        return {
          kind: 'avatar',
          frame: avatarFrameOf(checked.message as AvatarFrameMessage, receivedAt),
        };
      default:
        return unknownMsgType(msgType);
    }
  } catch (error) {
    if (error instanceof NonFinite) {
      return { kind: 'rejected', reason: 'NON_FINITE', msgType, detail: error.message };
    }
    throw error;
  }
}

// ---- 구역(DEMO 형상) ----
// GET /api/zones 응답 형상 계약은 아직 없다(BE -120·FE -189 협의 대상). config_bundle 의 zones URI·해시는 형상이 아니다.
// 그래서 contract: 'DEMO_UNCONFIRMED' 표시가 있는 DEMO 응답만 받고, 그렇지 않으면 실제 응답을 추측해 읽지 않고 거부한다.

const demoZones = z.object({
  contract: z.literal('DEMO_UNCONFIRMED'),
  zones: z.array(z.unknown()),
});

const AXES = ['X', 'Y', 'Z'] as const;

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;

/**
 * 구역 하나를 검사한다. 0폭·0높이·뒤집힌 범위·미상 높이는 넓히거나 0 으로 채우지 않고 이유와 함께 뺀다.
 * 심각도(색)는 없거나 모르는 값이면 비워 둔다. 구역을 빼지 않고 지어내지도 않는다.
 */
function readDemoZone(item: unknown): { zone: ZoneView } | { reason: string } {
  const zoneId = field(item, 'zone_id');
  const name = field(item, 'name');
  const severityField = field(item, 'severity');
  const severity = isZoneSeverity(severityField) ? severityField : undefined;
  const aabb = field(item, 'aabb');
  const rawMin = field(aabb, 'min_xyz');
  const rawMax = field(aabb, 'max_xyz');
  if (
    typeof zoneId !== 'string' ||
    zoneId.trim() === '' ||
    typeof name !== 'string' ||
    !Array.isArray(rawMin) ||
    !Array.isArray(rawMax) ||
    rawMin.length !== 3 ||
    rawMax.length !== 3
  ) {
    return { reason: '형식 오류' };
  }
  if (rawMin[2] == null || rawMax[2] == null) return { reason: '높이(Z) 미상' };
  const [min, max] = [toWorldPoint(rawMin), toWorldPoint(rawMax)];
  if (!min || !max) return { reason: '좌표가 유한한 숫자가 아니다' };
  const axis = AXES.find((_, i) => !(max[i]! > min[i]!));
  if (axis) return { reason: `${axis} 범위 오류(min ≥ max)` };
  return { zone: { zoneId, name, min, max, ...(severity && { severity }) } };
}

export const NO_ZONES: ZoneSnapshot = {
  status: 'NONE',
  contract: 'DEMO_UNCONFIRMED',
  zones: [],
  invalid: [],
  receivedAt: null,
  reason: null,
};

/**
 * DEMO 구역 응답을 검사한다. 형식이 틀린 구역은 빼고 이유를 남긴다(넓히거나 줄여 맞추지 않는다).
 * 같은 zone_id 가 둘 이상이면 어느 쪽이 맞는지 알 수 없어 그 ID 의 구역을 모두 뺀다.
 * READY 는 형상을 받아 검사했다는 뜻이다. 구역이 현장에 적용됐다는 증거가 아니다.
 */
export function adaptDemoZones(raw: unknown, receivedAt: number): ZoneSnapshot {
  const outer = demoZones.safeParse(raw);
  if (!outer.success) {
    return {
      ...NO_ZONES,
      status: 'REJECTED',
      receivedAt,
      reason: '형상 계약이 확정되지 않은 응답(DEMO 표시 없음)',
    };
  }
  const zones: ZoneView[] = [];
  const invalid: { zoneId: string | null; reason: string }[] = [];
  const idOf = (item: unknown) => {
    const id = field(item, 'zone_id');
    return typeof id === 'string' ? id : null;
  };
  const seen = new Map<string, number>();
  for (const item of outer.data.zones) {
    const id = idOf(item);
    if (id !== null) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const item of outer.data.zones) {
    const zoneId = idOf(item);
    if (zoneId !== null && seen.get(zoneId)! > 1) {
      invalid.push({ zoneId, reason: 'zone_id 중복' });
      continue;
    }
    const checked = readDemoZone(item);
    if ('reason' in checked) invalid.push({ zoneId, reason: checked.reason });
    else zones.push(checked.zone);
  }
  return {
    status: 'READY',
    contract: 'DEMO_UNCONFIRMED',
    zones,
    invalid,
    receivedAt,
    reason: null,
  };
}

/**
 * 구역 조회 결과 본문을 받는 입구. 본문 모양으로 출처를 가른다(값을 추측해 섞지 않는다).
 * - 배열: BE 정식 GET /api/zones 응답(-120) → adaptOfficialZones
 * - { contract: 'DEMO_UNCONFIRMED', zones }: 개발·FE 전환 기간의 DEMO 상자 → adaptDemoZones(기존 그대로)
 * - 그 밖: 거부
 */
export function adaptZones(raw: unknown, receivedAt: number): ZoneSnapshot {
  return Array.isArray(raw) ? adaptOfficialZones(raw, receivedAt) : adaptDemoZones(raw, receivedAt);
}
