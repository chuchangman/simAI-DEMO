import { ppePolicyMissing, vestPolicyMissing } from '@/features/events/ppePolicy';
import { useRecentBundles } from '@/features/zones/useRecentBundles';

/** 안내 문구. 명세 7.2 R9 의 표시 이름이다. */
export const PPE_POLICY_MISSING_TEXT = 'PPE 요구 미수신';

/**
 * 적용 중 묶음에 ppe_policy 가 없으면 안전모·조끼 모두, vest 만 없으면 조끼만 미판정 안내를 보인다(명세 7.2, -556).
 * 적용 묶음·해당 요약을 모르면 그리지 않는다.
 */
export function PpePolicyNotice() {
  const bundles = useRecentBundles().data;
  const missing = ppePolicyMissing(bundles);
  if (!missing && !vestPolicyMissing(bundles)) return null;
  return (
    <p
      role="status"
      className="pointer-events-auto rounded-[12px] bg-card/94 px-4 py-2 text-sm shadow-float ring-1 ring-border backdrop-blur-[8px] ring-inset"
    >
      <b>{missing ? PPE_POLICY_MISSING_TEXT : '조끼 요구 미수신'}</b>
      <span className="text-muted-foreground">
        {missing
          ? ' · 안전모·조끼 미착용(R9·R11)을 판정하지 않습니다'
          : ' · 조끼 미착용(R11)을 판정하지 않습니다'}
      </span>
    </p>
  );
}
