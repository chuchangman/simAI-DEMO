import { SEVERITY_RANK } from '@/features/events/constants';
import type { Zone } from '@/features/zones/types';
import { zoneDisplayName } from '@/features/zones/zoneName';

/** 목록에 보일 순서: 위험한 등급이 먼저이고, 같은 등급은 이름순이다. */
export const zonesForList = (zones: readonly Zone[]): Zone[] =>
  [...zones].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      zoneDisplayName(a.name).localeCompare(zoneDisplayName(b.name), 'ko'),
  );
