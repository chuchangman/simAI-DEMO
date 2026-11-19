import type { StartPpe } from '@/features/work/api';
import { ConfirmDialog } from '@/features/work/ConfirmDialog';
import {
  canStart,
  withCheck,
  type PreflightCheckKey,
  type PreflightChecks,
} from '@/features/work/preflight/preflight';
import { SETUP_REQUIRED_MESSAGE } from '@/features/work/preflight/preflightErrors';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { Check, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';

// '작업 전 확인' 창: 보고서·가상 레이아웃을 확인했는지 체크하고, 참석자 서명이 1명 이상이면 '작업 시작'이 켜진다.
// 서명이 없으면 이 창을 닫고 서명 창을 여는 '서명하기'가 있다. 시작이 거절되면 이유를 창 안에 보인다.
// 세팅 완료(서버 setup_completed_at) 전이면 '작업 시작'을 끄고 「세팅을 완료해야 시작할 수 있습니다」와 '세팅으로' 단추를 보인다(-642).
// 서명 수처럼 자동으로 정해지는 줄은 체크 칸 모양이 아니라 ✓/✗ 상태로 보인다(사람이 누르는 칸과 헷갈리지 않게, -730).
// 보호구 상태 미수신·워치 0대 같은 경고(warnings)는 한 줄씩 보이고 시작을 막지 않는다(-730).

const CHECK_ROWS: readonly { key: PreflightCheckKey; label: string }[] = [
  { key: 'reportChecked', label: 'TBM 보고서를 확인했습니다' },
  { key: 'layoutChecked', label: '가상 레이아웃을 확인했습니다' },
];

// 작업 중 보호구 요구(S15P31A101-654). 기본 필수이고 끄면 그 장비 미착용(R9·R11)을 판정하지 않는다.
const PPE_ROWS: readonly { key: keyof StartPpe; label: string }[] = [
  { key: 'helmet', label: '안전모 필수' },
  { key: 'vest', label: '조끼 필수' },
];

export function PreflightConfirmDialog({
  checks,
  onChecksChange,
  ppe,
  onPpeChange,
  signerCount,
  pending,
  error,
  errorAction = null,
  draftWarning = null,
  warnings = [],
  setupCompleted = true,
  setupBlocked = false,
  onGoSetup,
  onSign,
  onStart,
  onCancel,
}: {
  checks: PreflightChecks;
  onChecksChange: (next: PreflightChecks) => void;
  /** 작업 중 안전모·조끼 요구. 없으면 고르는 칸을 그리지 않는다(서버 기본값 = 필수). */
  ppe?: StartPpe;
  onPpeChange?: (next: StartPpe) => void;
  signerCount: number;
  /** 작업 시작 요청이 가는 중. */
  pending: boolean;
  /** 시작이 거절됐을 때 보일 글. */
  error: string | null;
  /** 오류 글 옆에 놓을 단추(막는 세팅 취소 등). */
  errorAction?: ReactNode;
  /** AI 초안이 끝나지 않았을 때의 경고(-625). 시작을 막지 않는다. */
  draftWarning?: string | null;
  /** 보호구 상태 미수신·워치 0대 등 시작 전 경고 줄(-730). 시작을 막지 않는다. */
  warnings?: readonly string[];
  /** 서버가 세팅 완료를 알렸는지(progress SETUP_DONE 이후). 꺼지면 '작업 시작'을 끄고 안내한다(-642). */
  setupCompleted?: boolean;
  /** 시작이 409 WORK_SETUP_NOT_COMPLETED 로 거절됐다. 안내는 error 가 맡고 '세팅으로' 단추만 더한다. */
  setupBlocked?: boolean;
  /** '세팅으로': 이 창을 닫고 세팅 단계로 돌아간다. */
  onGoSetup?: () => void;
  /** '서명하기': 이 창을 닫고 서명 창을 연다. */
  onSign: () => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const signed = signerCount > 0;
  // 세팅 완료 전 안내: 시작 전에 아는 경우(setupCompleted 꺼짐)와 서버가 거절한 경우(setupBlocked, 글은 error)
  const setupNotice = setupCompleted ? null : SETUP_REQUIRED_MESSAGE;
  const setupButton = onGoSetup ? (
    <Button variant="secondary" size="sm" onClick={onGoSetup}>
      세팅으로
    </Button>
  ) : null;
  return (
    <ConfirmDialog
      title="작업 전 확인"
      confirmLabel="작업 시작"
      confirmDisabled={!setupCompleted || !canStart({ ...checks, signerCount })}
      pending={pending}
      onConfirm={onStart}
      onCancel={onCancel}
    >
      <div className="flex flex-col gap-3">
        {CHECK_ROWS.map(({ key, label }) => (
          <label key={key} className="flex cursor-pointer items-center gap-2.5 text-sm select-none">
            <input
              type="checkbox"
              checked={checks[key]}
              onChange={(event) => onChecksChange(withCheck(checks, key, event.target.checked))}
              className="size-[18px] cursor-pointer accent-primary"
            />
            <span>{label}</span>
          </label>
        ))}
        <div className="flex items-center gap-2.5 text-sm">
          <span
            aria-hidden
            data-testid="signer-state"
            className={cn(
              'grid size-[18px] flex-none place-items-center',
              signed ? 'text-ok' : 'text-destructive',
            )}
          >
            {signed ? (
              <Check className="size-4" strokeWidth={3} />
            ) : (
              <X className="size-4" strokeWidth={3} />
            )}
          </span>
          {signed ? (
            <span>{`참석자 서명 ${signerCount}명`}</span>
          ) : (
            <>
              <span>참석자 서명이 필요합니다</span>
              <Button variant="secondary" size="sm" onClick={onSign}>
                서명하기
              </Button>
            </>
          )}
        </div>
        {ppe && onPpeChange && (
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <legend className="mb-1 text-[13px] text-muted-foreground">작업 중 보호구</legend>
            {PPE_ROWS.map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={ppe[key] === 'REQUIRED'}
                  onChange={(event) =>
                    onPpeChange({
                      ...ppe,
                      [key]: event.target.checked ? 'REQUIRED' : 'NOT_REQUIRED',
                    })
                  }
                  className="size-[18px] cursor-pointer accent-primary"
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        )}
        {(!checks.reportChecked || !checks.layoutChecked) && (
          // 주 단추가 꺼진 이유를 본문에 쓴다(S15P31A101-719: 17차에 서명 뒤 「작업 시작」이 22초 꺼져 있던 까닭이 화면에 없었다)
          <p className="text-[13px] text-muted-foreground">
            위 확인 칸 두 개를 체크하면 「작업 시작」이 켜집니다
          </p>
        )}
        {draftWarning && <p className="text-[13px] text-sev-caution">{draftWarning}</p>}
        {warnings.length > 0 && (
          <ul
            aria-label="시작 전 경고"
            className="flex flex-col gap-1 text-[13px] text-sev-caution"
          >
            {warnings.map((line) => (
              <li key={line} className="flex items-start gap-1.5">
                <TriangleAlert aria-hidden className="mt-[3px] size-3.5 flex-none" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
        {setupNotice && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-destructive">
            <p role="alert">{setupNotice}</p>
            {setupButton}
          </div>
        )}
        {error && error !== setupNotice && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-destructive">
            <p role="alert">{error}</p>
            {errorAction}
            {setupBlocked && setupButton}
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
}
