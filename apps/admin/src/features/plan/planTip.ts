import { SEVERITY_LABEL } from '@/features/events/constants';
import { formatPersonFull, type PersonDisplayMap } from '@/features/people/personDisplay';
import type { TipTone } from '@/features/plan/HoverTip';
import {
  markFor,
  personKey,
  severityTone,
  trackIds,
  trackLook,
  ZONE_KEY_PREFIX,
  zoneKey,
  type PlanMark,
  type PlanMarks,
  type PlanZone,
  type TrackLook,
} from '@/features/plan/plan';
import { ZONE_TYPE_LABEL } from '@/features/zones/zoneForm';
import { zoneDisplayName } from '@/lib/zoneName';
import type { WorldTrack } from '@simai/contracts';

// 2D 평면 말풍선 글자. 화면 컴포넌트 없이 만든다.

const GLYPH = { CRITICAL: '▲▲', HIGH: '▲', CAUTION: '!', INFO: 'i' } as const;

/** 관측 상태 뒤에 붙는 말. 관측 중이면 없다. */
export const LOOK_LABEL = { observed: '', predicted: ' · 예측', unknown: ' · 확인 불가' } as const;

function zoneTip(zone: PlanZone): string {
  const parts = [zoneDisplayName(zone.name)];
  if (zone.zoneType) parts.push(ZONE_TYPE_LABEL[zone.zoneType] ?? zone.zoneType);
  if (zone.severity) parts.push(`${GLYPH[zone.severity]} ${SEVERITY_LABEL[zone.severity]}`);
  return parts.join(' · ');
}

function personGlyph(mark: PlanMark | undefined, look: TrackLook): string {
  if (mark) return `${GLYPH[mark.severity]} `;
  return look === 'unknown' ? '? ' : '';
}

function personTip(
  track: WorldTrack,
  mark: PlanMark | undefined,
  personNames?: PersonDisplayMap,
): string {
  const look = trackLook(track);
  return `${personGlyph(mark, look)}${formatPersonFull(track.world_id, personNames)}${LOOK_LABEL[look]}`;
}

/** 지금 머무는 대상의 말풍선 글자. 그 사이 대상이 사라졌으면 없다. */
export function planTip(
  key: string,
  tracks: readonly WorldTrack[],
  zones: readonly PlanZone[],
  marks: PlanMarks,
  personNames?: PersonDisplayMap,
): { text: string; tone?: TipTone } | undefined {
  if (key.startsWith(ZONE_KEY_PREFIX)) {
    const zone = zones.find((z) => zoneKey(z.zoneId) === key);
    return zone && { text: zoneTip(zone) };
  }
  const track = tracks.find((t) => personKey(t.world_id) === key);
  if (!track) return undefined;
  const mark = markFor(marks.people, trackIds(track));
  return { text: personTip(track, mark, personNames), tone: mark && severityTone(mark.severity) };
}
