import {
  confirmationText,
  groupIncidents,
  incidentTimeline,
  mergeEvent,
} from '@/features/events/events';
import { statusText } from '@/features/events/format';
import {
  appliedBundle,
  needsBundlesForRelease,
  ppePolicyMissing,
  ppeReleaseOf,
  vestPolicyMissing,
} from '@/features/events/ppePolicy';
import type { EventItem } from '@/features/events/types';
import { readBundles } from '@/features/zones/useRecentBundles';
import { describe, expect, it, vi } from 'vitest';

// R9 계약 변경(-519, -518)을 관제 화면이 받아 읽는 계산(S15P31A101-520).
// readBundles 가 있는 모듈은 앱 REST 인스턴스를 import 한다(환경변수를 읽지 않게 바꿔 끼운다).
vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));

const T = 1_760_342_400_000;

/** 서버 묶음 보기(GET /api/config-bundles) 한 건. ppe_policy 를 빼면 칸이 없는 이전 서버 응답이다. */
function rawBundle(version: string, status: string, ppe?: unknown) {
  return {
    config_version: version,
    issued_at: T,
    status,
    applied_at: status === 'APPLIED' ? T + 100 : null,
    last_ack: null,
    items: [],
    ...(ppe === undefined ? {} : { ppe_policy: ppe }),
  };
}

const REQUIRED = { helmet: 'REQUIRED', work_id: 12, effective_from_ms: T };
const NOT_REQUIRED = { helmet: 'NOT_REQUIRED', work_id: null, effective_from_ms: T + 60_000 };

function r9(change: Partial<EventItem> = {}): EventItem {
  return {
    event_id: 'e-9',
    event_sequence: 3,
    rule_id: 'R9',
    source: 'LIVE',
    lifecycle: 'RESOLVED',
    verification: 'VERIFIED',
    severity: 'CAUTION',
    confidence: 'HIGH',
    needs_check: false,
    world_ids: ['w-0007'],
    zone_id: null,
    metrics: {},
    rationale: null,
    proposed_severity: null,
    raised_at: T,
    updated_at: T + 5_000,
    resolved_at: T + 5_000,
    config_version: 'cfg-3',
    ...change,
  };
}

describe('묶음의 안전모 요구 요약 읽기', () => {
  it('요약·null·칸 없음을 구분하고, 모양이 틀린 요약은 묶음을 버리지 않고 모름으로 둔다', () => {
    const [withPolicy, missing, absent, broken] = readBundles([
      rawBundle('cfg-4', 'APPLIED', REQUIRED),
      rawBundle('cfg-3', 'APPLIED', null),
      rawBundle('cfg-2', 'APPLIED'),
      rawBundle('cfg-1', 'APPLIED', { helmet: 'MAYBE' }),
    ]);
    expect(withPolicy?.ppe_policy).toEqual(REQUIRED);
    expect(missing?.ppe_policy).toBeNull();
    expect(absent?.ppe_policy).toBeUndefined();
    expect(broken?.config_version).toBe('cfg-1');
    expect(broken?.ppe_policy).toBeUndefined();
  });

  it('모르는 칸(previous_config_version·components 등)이 더해져도 묶음을 받는다', () => {
    const extra = { ...rawBundle('cfg-5', 'PENDING', REQUIRED), components: {}, rule_profile: 'p' };
    expect(readBundles([extra])).toHaveLength(1);
  });
});

describe('PPE 요구 미수신', () => {
  it('적용 중 묶음은 가장 새로 적용된(APPLIED) 것이다. 뒤 묶음이 대기·거부면 그 앞 것이다', () => {
    const bundles = readBundles([
      rawBundle('cfg-6', 'PENDING', REQUIRED),
      rawBundle('cfg-5', 'REJECTED', REQUIRED),
      rawBundle('cfg-4', 'APPLIED', null),
      rawBundle('cfg-3', 'APPLIED', NOT_REQUIRED),
    ]);
    expect(appliedBundle(bundles)?.config_version).toBe('cfg-4');
    expect(ppePolicyMissing(bundles)).toBe(true);
  });

  it('적용 묶음에 요구가 있으면(필수·없음 모두) 표시하지 않는다', () => {
    expect(ppePolicyMissing(readBundles([rawBundle('cfg-4', 'APPLIED', REQUIRED)]))).toBe(false);
    expect(ppePolicyMissing(readBundles([rawBundle('cfg-4', 'APPLIED', NOT_REQUIRED)]))).toBe(
      false,
    );
  });

  it('적용 묶음을 모르거나 서버가 칸을 주지 않으면 표시하지 않는다', () => {
    expect(ppePolicyMissing(undefined)).toBe(false);
    expect(ppePolicyMissing(readBundles([rawBundle('cfg-4', 'PENDING', null)]))).toBe(false);
    expect(ppePolicyMissing(readBundles([rawBundle('cfg-4', 'APPLIED')]))).toBe(false);
  });
});

describe('R9 해소 원인', () => {
  const bundles = readBundles([
    rawBundle('cfg-3', 'APPLIED', NOT_REQUIRED),
    rawBundle('cfg-2', 'APPLIED', REQUIRED),
    rawBundle('cfg-1', 'APPLIED', null),
    rawBundle('cfg-0', 'APPLIED'),
  ]);

  it('해소 전이의 config_version 이 가리키는 묶음의 요구로 가른다', () => {
    expect(ppeReleaseOf(r9({ config_version: 'cfg-3' }), bundles)).toBe('WORK_ENDED');
    expect(ppeReleaseOf(r9({ config_version: 'cfg-2' }), bundles)).toBe('WORN');
    expect(ppeReleaseOf(r9({ config_version: 'cfg-1' }), bundles)).toBe('POLICY_MISSING');
  });

  it('묶음을 못 찾거나 요약을 모르면, 운영자 종료·열림·LIVE 아님·다른 규칙이면 가리지 않는다', () => {
    expect(ppeReleaseOf(r9({ config_version: 'cfg-99' }), bundles)).toBeNull();
    expect(ppeReleaseOf(r9({ config_version: 'cfg-0' }), bundles)).toBeNull();
    expect(ppeReleaseOf(r9({ config_version: undefined }), bundles)).toBeNull();
    expect(ppeReleaseOf(r9(), undefined)).toBeNull();
    expect(
      ppeReleaseOf(
        r9({ resolution: { kind: 'OPERATOR_CLOSED', reason: '오탐', requested_at: T } }),
        bundles,
      ),
    ).toBeNull();
    expect(ppeReleaseOf(r9({ lifecycle: 'UPDATED' }), bundles)).toBeNull();
    expect(ppeReleaseOf(r9({ source: 'REPLAY' }), bundles)).toBeNull();
    expect(ppeReleaseOf(r9({ rule_id: 'R2' }), bundles)).toBeNull();
  });

  it('상태 문구와 타임라인이 "해소" 대신 해소 원인을 쓴다', () => {
    const resolved = { kind: 'resolved', at: T + 5_000, closed: false } as const;
    expect(statusText(resolved, 'WORK_ENDED')).toMatch(/^작업 종료로 해소 /);
    expect(statusText(resolved, 'WORN')).toMatch(/^착용 확인으로 해소 /);
    expect(statusText(resolved)).toMatch(/^해소 /);
    // 운영자 종료가 먼저다.
    expect(statusText({ ...resolved, closed: true }, 'WORN')).toMatch(/^운영자 종료 /);

    const [incident] = groupIncidents([mergeEvent(undefined, r9())]);
    expect(incidentTimeline(incident!, bundles).at(-1)).toEqual({
      at: T + 5_000,
      who: '시스템',
      text: '안전모 미착용 작업 종료로 해소',
    });
    expect(incidentTimeline(incident!).at(-1)?.text).toBe('안전모 미착용 해소');
  });

  it('해소된 LIVE R9 가 있을 때만 묶음 목록이 필요하다', () => {
    expect(needsBundlesForRelease([r9()])).toBe(true);
    expect(needsBundlesForRelease([r9({ lifecycle: 'RAISED' })])).toBe(false);
    expect(needsBundlesForRelease([r9({ rule_id: 'R2' })])).toBe(false);
  });
});

describe('PPE_UNKNOWN', () => {
  it('확인 필요 이유를 한국어 문구로 보인다', () => {
    const holding = r9({
      lifecycle: 'UPDATED',
      needs_check: true,
      confidence_reasons: ['PPE_UNKNOWN'],
    });
    expect(confirmationText(holding)).toBe('확인 필요 · 안전모 상태 모름');
    expect(confirmationText({ ...holding, rule_id: 'R11' })).toBe('확인 필요 · 조끼 상태 모름');
    expect(confirmationText({ ...holding, rule_id: 'R99' })).toBe('확인 필요 · 보호구 상태 모름');
  });
});

describe('R11 조끼 요구와 해소', () => {
  const event = r9({ rule_id: 'R11' });
  const bundles = readBundles([
    rawBundle('cfg-3', 'APPLIED', { ...REQUIRED, vest: 'NOT_REQUIRED' }),
    rawBundle('cfg-2', 'APPLIED', { ...NOT_REQUIRED, vest: 'REQUIRED' }),
    rawBundle('cfg-1', 'APPLIED', { ...REQUIRED, vest: null }),
    rawBundle('cfg-0', 'APPLIED', REQUIRED),
    rawBundle('cfg-missing', 'APPLIED', null),
    rawBundle('cfg-broken', 'APPLIED', { ...REQUIRED, vest: 'MAYBE' }),
  ]);

  it('서버 vest 요약을 보존하고 안전모 요구와 별개로 조끼 요구를 읽는다', () => {
    expect(bundles[0]?.ppe_policy?.vest).toBe('NOT_REQUIRED');
    expect(ppeReleaseOf(event, bundles)).toBe('WORK_ENDED');
    expect(ppeReleaseOf({ ...event, config_version: 'cfg-2' }, bundles)).toBe('WORN');
    expect(needsBundlesForRelease([event])).toBe(true);
    expect(needsBundlesForRelease([{ ...event, source: 'REPLAY' }])).toBe(false);
  });

  it('이전 문서의 vest 없음(null)과 요약 모름(undefined·형식 오류)을 구분한다', () => {
    expect(ppeReleaseOf({ ...event, config_version: 'cfg-1' }, bundles)).toBe(
      'VEST_POLICY_MISSING',
    );
    expect(ppeReleaseOf({ ...event, config_version: 'cfg-0' }, bundles)).toBeNull();
    expect(ppeReleaseOf({ ...event, config_version: 'cfg-broken' }, bundles)).toBeNull();
    expect(ppeReleaseOf({ ...event, config_version: 'cfg-missing' }, bundles)).toBe(
      'POLICY_MISSING',
    );
    expect(
      vestPolicyMissing(readBundles([rawBundle('cfg-v', 'APPLIED', { ...REQUIRED, vest: null })])),
    ).toBe(true);
    expect(vestPolicyMissing(readBundles([rawBundle('cfg-v', 'APPLIED', REQUIRED)]))).toBe(false);
  });

  it('운영자 종료·열린 이벤트·알 수 없는 묶음에서 착용 해소를 지어내지 않는다', () => {
    expect(ppeReleaseOf({ ...event, lifecycle: 'UPDATED' }, bundles)).toBeNull();
    expect(ppeReleaseOf({ ...event, config_version: 'cfg-99' }, bundles)).toBeNull();
    expect(
      ppeReleaseOf(
        { ...event, resolution: { kind: 'OPERATOR_CLOSED', reason: '오탐', requested_at: T } },
        bundles,
      ),
    ).toBeNull();
  });

  it('타임라인은 R11 규칙명과 조끼 해소 원인을 쓴다', () => {
    const [incident] = groupIncidents([
      mergeEvent(undefined, { ...event, config_version: 'cfg-1' }),
    ]);
    expect(incidentTimeline(incident!, bundles).at(-1)?.text).toBe(
      '조끼 미착용 조끼 요구 미수신으로 해소',
    );
  });
});
