import type { PpeSnapshot } from '@/store/realtime.store';

/** 명세 6장 PPE 상태 */
export type PpeState = 'WORN' | 'NOT_WORN' | 'UNKNOWN';

/** 화면에 보일 장비 하나의 상태. */
export interface PpeItemDisplay {
  state: PpeState;
  /** 보낸 사유 코드, 또는 화면이 UNKNOWN 으로 바꾼 이유(EVIDENCE_EXPIRED·EC2_DISCONNECTED). 모르는 코드는 표시만 한다. */
  reason: string;
  /** 마지막 근거 촬영 시각(ms, Tier 0 시계). 근거가 없으면 null. */
  lastEvidenceAtMs: number | null;
}

export interface PersonPpe {
  helmet: PpeItemDisplay;
  vest: PpeItemDisplay;
}

/** 관제 화면이 EC2 연결을 잃어 UNKNOWN 으로 바꿨다는 화면 전용 사유(계약 값이 아니다). */
export const LINK_LOST_REASON = 'EC2_DISCONNECTED';
export const EXPIRED_REASON = 'EVIDENCE_EXPIRED';

interface ItemView {
  state: PpeState;
  reason: string;
  last_evidence_at_ms: number | null;
  expires_at_ms: number | null;
}

/**
 * 한 사람의 화면용 PPE 상태(명세 13.3). 그 사람이 지금 그리는 트랙과 같은 identity_revision 의 상태만 붙인다.
 * - 같은 World ID 가 없거나 identity_revision 이 다르면 null(이전 ID 의 상태를 새 사람에게 넘기지 않는다).
 * - EC2 연결이 끊겼으면 UNKNOWN(EC2_DISCONNECTED).
 * - 다음 스냅샷 전이라도 착용·미착용 근거의 expires_at_ms 가 지나면 UNKNOWN(EVIDENCE_EXPIRED). 지금 EC2 시각은
 *   스냅샷 시각 + 받은 뒤 흐른 시간으로 어림한다(Tier 0·EC2 시계는 같은 UTC 로 본다, 설계 문서 잔여 위험).
 */
export function personPpe(
  snapshots: Readonly<Record<string, PpeSnapshot>>,
  worldId: string,
  identityRevision: number,
  now: number,
  linkAlive: boolean,
): PersonPpe | null {
  return personPpeAt(snapshots, worldId, identityRevision, now, linkAlive)?.ppe ?? null;
}

/** personPpe 와 같고, 근거 시각과 견줄 지금 EC2 시각(어림)도 돌려준다. */
function personPpeAt(
  snapshots: Readonly<Record<string, PpeSnapshot>>,
  worldId: string,
  identityRevision: number,
  now: number,
  linkAlive: boolean,
): { ppe: PersonPpe; serverNow: number } | null {
  for (const snapshot of Object.values(snapshots)) {
    const person = snapshot.payload.people.find((p) => p.world_id === worldId);
    if (!person) continue;
    if (person.identity_revision !== identityRevision) return null;
    const serverNow = snapshot.payload.snapshot_at_ms + Math.max(0, now - snapshot.receivedAt);
    return {
      ppe: {
        helmet: itemDisplay(person.helmet, serverNow, linkAlive),
        vest: itemDisplay(person.vest, serverNow, linkAlive),
      },
      serverNow,
    };
  }
  return null;
}

function itemDisplay(item: ItemView, serverNow: number, linkAlive: boolean): PpeItemDisplay {
  const lastEvidenceAtMs = item.last_evidence_at_ms;
  if (!linkAlive) return { state: 'UNKNOWN', reason: LINK_LOST_REASON, lastEvidenceAtMs };
  const decided = item.state === 'WORN' || item.state === 'NOT_WORN';
  if (decided && (item.expires_at_ms === null || item.expires_at_ms < serverNow)) {
    return { state: 'UNKNOWN', reason: EXPIRED_REASON, lastEvidenceAtMs };
  }
  return { state: item.state, reason: item.reason, lastEvidenceAtMs };
}

/** 사람 몸에 붙는 장비 종류: helmet · vest. */
export type PpeItemKind = keyof PersonPpe;

const ITEM_NAMES: Readonly<Record<PpeItemKind, string>> = { helmet: '안전모', vest: '조끼' };
const ITEM_ORDER: readonly PpeItemKind[] = ['helmet', 'vest'];

/** 마지막 근거로부터 지난 시간. 이름표가 1초마다 바뀌지 않게 10초·1분 단위로 끊는다. */
export function evidenceAgeText(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 10) return '방금';
  if (seconds < 60) return `${Math.floor(seconds / 10) * 10}초 전`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  return `${Math.floor(seconds / 3600)}시간 전`;
}

/** 이름표 PPE 글에 넣을 것: 장비 종류와 모름 상태를 쓸지(기본은 둘 다·모름도). */
export interface PpeLabelScope {
  items: readonly PpeItemKind[];
  unknown: boolean;
}

const ALL_LABELS: PpeLabelScope = { items: ITEM_ORDER, unknown: true };

/**
 * 이름표 뒤에 붙일 PPE 글(명세 13.3, S15P31A101-656). 착용이 아닐 때만 만든다(둘 다 착용이면 null, 장비 실물이 보인다).
 * 미착용 장비를 먼저, 모름 장비를 뒤에 쓰고, 모름에는 마지막 근거 시각(또는 EC2 연결 끊김)을 괄호로 붙인다.
 * 예: '안전모 미착용', '안전모·조끼 모름(30초 전)', '안전모 미착용 · 조끼 모름(연결 끊김)'.
 * scope 로 장비 종류를 줄이거나 모름 글을 뺄 수 있다(시연 계정은 안전모 미착용만).
 */
export function ppeLabel(
  ppe: PersonPpe,
  serverNow: number,
  scope: PpeLabelScope = ALL_LABELS,
): string | null {
  const shownItems = ITEM_ORDER.filter((item) => scope.items.includes(item));
  const notWorn = shownItems.filter((item) => ppe[item].state === 'NOT_WORN');
  const unknownBySuffix = new Map<string, PpeItemKind[]>();
  for (const item of shownItems) {
    const display = ppe[item];
    if (!scope.unknown || display.state !== 'UNKNOWN') continue;
    const suffix =
      display.reason === LINK_LOST_REASON
        ? '(연결 끊김)'
        : display.lastEvidenceAtMs === null
          ? ''
          : `(${evidenceAgeText(serverNow - display.lastEvidenceAtMs)})`;
    unknownBySuffix.set(suffix, [...(unknownBySuffix.get(suffix) ?? []), item]);
  }
  const names = (items: readonly PpeItemKind[]) => items.map((item) => ITEM_NAMES[item]).join('·');
  const parts: string[] = [];
  if (notWorn.length > 0) parts.push(`${names(notWorn)} 미착용`);
  for (const [suffix, items] of unknownBySuffix) parts.push(`${names(items)} 모름${suffix}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** 지금 그리는 트랙별 이름표 PPE 글. 착용이 아닌 사람만 담는다(상태가 없거나 둘 다 착용이면 빠진다). */
export function ppeLabels(
  snapshots: Readonly<Record<string, PpeSnapshot>>,
  tracks: readonly { worldId: string; identityRevision: number }[],
  now: number,
  linkAlive: boolean,
  scope?: PpeLabelScope,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const track of tracks) {
    const found = personPpeAt(snapshots, track.worldId, track.identityRevision, now, linkAlive);
    const label = found && ppeLabel(found.ppe, found.serverNow, scope);
    if (label) labels[track.worldId] = label;
  }
  return labels;
}

/** 이름표 뒤 글(워치 등)에 PPE 글을 ' · ' 로 이어 붙인다. 둘 중 하나만 있으면 그것만 쓴다. */
export function withPpeLabels(
  badges: Readonly<Record<string, string>>,
  labels: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = { ...badges };
  for (const [worldId, label] of Object.entries(labels)) {
    out[worldId] = out[worldId] ? `${out[worldId]} · ${label}` : label;
  }
  return out;
}

/** 3D 에 넘길 사람별 장비(안전모 또는 조끼) 상태. 붙일 상태가 있는 사람만 담는다. */
export function itemStates(
  snapshots: Readonly<Record<string, PpeSnapshot>>,
  tracks: readonly { worldId: string; identityRevision: number }[],
  now: number,
  linkAlive: boolean,
  item: PpeItemKind,
): Record<string, PpeState> {
  const states: Record<string, PpeState> = {};
  for (const track of tracks) {
    const ppe = personPpe(snapshots, track.worldId, track.identityRevision, now, linkAlive);
    if (ppe) states[track.worldId] = ppe[item].state;
  }
  return states;
}
