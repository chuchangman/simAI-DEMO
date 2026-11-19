import type { EventItem } from '@/features/events/types';
import type { ConfigBundle } from '@/features/zones/types';

// R9·R11 을 구성 묶음의 안전모·조끼 요구(ppe_policy)와 맞춰 읽는 계산(S15P31A101-520·-556).
// 요구는 작업 기준이다: 진행 중 작업이 있으면 REQUIRED, 없으면 NOT_REQUIRED(명세 7.2 R9, 8.10).

/** 위치·구역을 보지 않는 사람 단위 규칙. 이벤트에 zone_id 가 없다(명세 7.2 R9). */
export const PERSON_ONLY_RULES: ReadonlySet<string> = new Set(['R9', 'R11']);

/**
 * 현장 Tier 0 가 지금 쓰는 묶음: 최근 묶음(새것부터) 가운데 가장 새로 적용된(APPLIED) 것. 뒤 묶음이 적용 대기·거부·불일치여도
 * Tier 0 는 그 앞에 적용한 묶음을 계속 쓴다(명세 3.2). 목록에 적용된 묶음이 없으면 모른다(null).
 */
export const appliedBundle = (bundles: readonly ConfigBundle[]): ConfigBundle | null =>
  bundles.find((b) => b.status === 'APPLIED') ?? null;

/**
 * "PPE 요구 미수신": 적용 중인 묶음에 ppe_policy 가 실리지 않았다(null). Tier 0 는 요구 없음으로 보고 R9 를 내지 않는다
 * (명세 7.2 R9). 적용 묶음을 모르거나 서버가 칸을 주지 않으면(undefined) 표시하지 않는다(모르는 것을 지어내지 않는다).
 */
export function ppePolicyMissing(bundles: readonly ConfigBundle[] | undefined): boolean {
  if (!bundles) return false;
  return appliedBundle(bundles)?.ppe_policy === null;
}

/** ppe_policy 는 받았지만 조끼 요구 칸이 없는 이전 문서. 요약 칸 자체를 모르면 추측하지 않는다. */
export function vestPolicyMissing(bundles: readonly ConfigBundle[] | undefined): boolean {
  if (!bundles) return false;
  const policy = appliedBundle(bundles)?.ppe_policy;
  return policy != null && policy.vest === null;
}

/**
 * 해소된 R9·R11 의 해소 원인. 해소 전이의 config_version 이 가리키는 묶음의 해당 장비 요구로 가른다(명세 7.2).
 * - WORK_ENDED: 요구 NOT_REQUIRED 묶음(작업 종료) 적용으로 요구가 풀려 닫혔다.
 * - POLICY_MISSING: ppe_policy 가 없는 묶음 적용으로 요구 없음이 돼 닫혔다.
 * - VEST_POLICY_MISSING: vest 가 없는 이전 문서 적용으로 조끼 요구가 풀렸다(서버 요약 vest: null).
 * - WORN: 해당 장비 요구가 REQUIRED 인 채로 닫혔다. R9·R11 은 착용 관측이나 요구 해제로만 해소된다.
 * 운영자 종료, 아직 열림, LIVE 아님, 묶음을 못 찾음(최근 목록 밖), 요약을 모름은 null 이다(그냥 "해소").
 */
export type PpeRelease = 'WORK_ENDED' | 'POLICY_MISSING' | 'VEST_POLICY_MISSING' | 'WORN';

export function ppeReleaseOf(
  event: Pick<EventItem, 'rule_id' | 'source' | 'lifecycle' | 'resolution' | 'config_version'>,
  bundles: readonly ConfigBundle[] | undefined,
): PpeRelease | null {
  if (
    !PERSON_ONLY_RULES.has(event.rule_id) ||
    event.source !== 'LIVE' ||
    event.lifecycle !== 'RESOLVED'
  ) {
    return null;
  }
  if (event.resolution || !event.config_version || !bundles) return null;
  const bundle = bundles.find((b) => b.config_version === event.config_version);
  if (!bundle || bundle.ppe_policy === undefined) return null;
  if (bundle.ppe_policy === null) return 'POLICY_MISSING';
  const requirement = event.rule_id === 'R9' ? bundle.ppe_policy.helmet : bundle.ppe_policy.vest;
  // 이전 서버가 vest 요약 칸을 주지 않으면 문서에 실렸는지 모른다. null 만 실제 문서에 vest 가 없다는 뜻이다.
  if (requirement === undefined) return null;
  if (requirement === null) return 'VEST_POLICY_MISSING';
  return requirement === 'REQUIRED' ? 'WORN' : 'WORK_ENDED';
}

/** 해소 원인 문구. 상세 처리·근거 줄과 타임라인이 "해소" 대신 쓴다. */
export const PPE_RELEASE_LABEL: Record<PpeRelease, string> = {
  WORK_ENDED: '작업 종료로 해소',
  POLICY_MISSING: 'PPE 요구 미수신으로 해소',
  VEST_POLICY_MISSING: '조끼 요구 미수신으로 해소',
  WORN: '착용 확인으로 해소',
};

/** 해소된 LIVE R9·R11 의 해소 원인을 가릴 때만 묶음 목록이 필요하다. */
export const needsBundlesForRelease = (events: readonly EventItem[]) =>
  events.some(
    (e) => PERSON_ONLY_RULES.has(e.rule_id) && e.source === 'LIVE' && e.lifecycle === 'RESOLVED',
  );
