import { useMonitoringPhase } from '@/features/monitor/useMonitoringPhase';
import { useMonitorWorks } from '@/features/monitor/useMonitorWorks';
import {
  activePpeRequirement,
  PPE_OFF_TEXT,
  ppeOffDetail,
  ppeStatusText,
  ruleProfileText,
} from '@/features/monitor/workPpeText';
import { usePpeReceipt, useSustained } from '@/features/ppe/usePpeReceipt';
import { useRecentBundles } from '@/features/zones/useRecentBundles';
import { cn } from '@simai/ui/lib/utils';
import { useState } from 'react';

/** 관제가 켜진 뒤 PPE 상태가 이만큼(ms) 계속 없어야 「보호구 감시 꺼짐」으로 바꾼다(PPE 첫 수신·순간 끊김은 알리지 않는다, -634). */
export const PPE_OFF_SUSTAIN_MS = 15_000;

const BADGE =
  'pointer-events-auto flex max-w-[520px] flex-col rounded-[12px] px-3 py-1.5 text-[13px] shadow-float ring-1 ring-inset backdrop-blur-[8px]';

/**
 * 관제 머리줄의 보호구 상태 한 줄(S15P31A101-654, -692, -730). 진행 중 작업이 있을 때만 보인다(작업 전에는 「작업 시작 전 · 경보 꺼짐」이 맡는다).
 * 이번 작업 묶음이 현장에 적용되기 전에는 「보호구 감시 준비 중」, 적용되면 「안전모·조끼 감시 중」이고, 작업이 끈 장비는 「감시 대상 아님」이다.
 * 관제 중인데 EC2 가 PPE 상태를 15초 넘게 받지 못하면(보호구 감시 프로세스가 안 떴거나 멈춤) 같은 자리를 회색 「보호구 감시 꺼짐」 하나로 바꾼다
 * (예전에는 별도 카드가 겹쳐 떴다, -730). 원인·할 일과 규칙 기준(「교실 시험 기준 · 0.35m」 등)은 hover(title)와 「자세히」에만 둔다.
 * 3D 화면 가운데를 덜 가리게 한 줄 크기로 둔다. 작업 목록을 모르면 그리지 않는다.
 */
export function WorkPpeStatus() {
  const works = useMonitorWorks({ passive: true });
  const bundles = useRecentBundles().data;
  const phase = useMonitoringPhase();
  const [open, setOpen] = useState(false);
  const active = works.state === 'ready' ? works.active : null;
  const requirement = active ? activePpeRequirement(active, bundles) : null;
  const watched =
    requirement !== null && (requirement.helmet === 'REQUIRED' || requirement.vest === 'REQUIRED');
  const watching = watched && phase.stage === 'on' && phase.problem === null;
  const receipt = usePpeReceipt(watching);
  const off = useSustained(watching && receipt === 'stale', PPE_OFF_SUSTAIN_MS);
  if (!active || !requirement) return null;

  const profile = ruleProfileText(bundles);
  const text = off ? PPE_OFF_TEXT : ppeStatusText(requirement, phase.stage === 'on');
  const detail = [...(off ? ppeOffDetail(requirement) : []), ...(profile ? [profile] : [])];
  return (
    <section
      aria-label="보호구 감시"
      title={detail.length > 0 ? detail.join('\n') : undefined}
      className={cn(
        BADGE,
        off ? 'bg-muted/94 text-muted-foreground ring-border' : 'bg-card/94 ring-border',
      )}
    >
      <div className="flex items-center gap-2">
        <b role="status" className="font-semibold">
          {text}
        </b>
        {detail.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="text-[12px] text-muted-foreground underline-offset-2 hover:underline"
          >
            {open ? '접기' : '자세히'}
          </button>
        )}
      </div>
      {open && detail.length > 0 && (
        <ul aria-label="보호구 감시 자세히" className="mt-1 flex flex-col gap-0.5">
          {detail.map((line) => (
            <li key={line} className="text-muted-foreground">
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
