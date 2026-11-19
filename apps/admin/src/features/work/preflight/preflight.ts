import type { Tier0Link } from '@/features/monitor/monitoringPhase';
import type { PpeReceipt } from '@/features/ppe/ppeHealth';
import type { StartPpe } from '@/features/work/api';
import { SIGNATURE_MAX_COUNT, type DayProgress } from '@/features/work/types';

// 작업 전 확인의 순수 규칙: 확인창의 체크 상태, '작업 시작'을 켜는 조건, 서명 추가를 켜는 조건.

/** 세팅이 끝난 뒤의 서버 진행 값들(작업 전 확인 이후 어느 때든). */
const SETUP_FINISHED: readonly DayProgress[] = ['SETUP_DONE', 'IN_PROGRESS', 'ENDED', 'SUBMITTED'];

/**
 * 서버가 세팅을 끝냈는가. 보고서 초안은 이때부터 만들어지므로 그 전에는 초안을 기다리며 보고서를 자주 받을 필요가 없다.
 * 이 화면은 세팅 구역 저장 직후 서버 진행이 아직 SETUP 인 채로도 열리므로 화면 단계가 아니라 서버 진행으로 가른다.
 */
export const isSetupFinished = (progress: DayProgress | null): boolean =>
  progress !== null && SETUP_FINISHED.includes(progress);

/** 확인창의 체크 둘: 'TBM 보고서를 확인했습니다'·'가상 레이아웃을 확인했습니다'. */
export interface PreflightChecks {
  reportChecked: boolean;
  layoutChecked: boolean;
}

export type PreflightCheckKey = keyof PreflightChecks;

/** 아무것도 체크하지 않은 처음 상태. */
export const NO_CHECKS: PreflightChecks = { reportChecked: false, layoutChecked: false };

/** 체크 하나를 바꾼 새 상태(원래 객체는 그대로). */
export function withCheck(
  checks: PreflightChecks,
  key: PreflightCheckKey,
  checked: boolean,
): PreflightChecks {
  return { ...checks, [key]: checked };
}

/** 작업을 시작할 수 있는지: 두 체크가 모두 켜져 있고 참석자 서명이 1명 이상. */
export function canStart({
  reportChecked,
  layoutChecked,
  signerCount,
}: PreflightChecks & { signerCount: number }): boolean {
  return reportChecked && layoutChecked && signerCount > 0;
}

/** 서명 인원이 상한(50명)에 닿았는지. */
export const isSignerLimitReached = (signerCount: number): boolean =>
  signerCount >= SIGNATURE_MAX_COUNT;

/**
 * 서명 추가를 켤 수 있는지: 이름(공백 제외)과 획이 있고, 서명할 보고서가 있고, 다른 요청이 없고, 상한에 닿지 않았을 때.
 */
export function canAddSigner({
  name,
  hasInk,
  ready,
  busy,
  signerCount,
}: {
  name: string;
  hasInk: boolean;
  /** 서명을 받을 보고서가 있는지. */
  ready: boolean;
  /** 서명 추가·삭제 요청이 가는 중인지. */
  busy: boolean;
  signerCount: number;
}): boolean {
  return name.trim() !== '' && hasInk && ready && !busy && !isSignerLimitReached(signerCount);
}

/** 작업 시작 전 경고(S15P31A101-730)를 가르는 데 쓰는 서버 상태. 모르는 값은 null 이고 그 경고는 내지 않는다. */
export interface StartReadiness {
  /** 이번 작업의 안전모·조끼 요구(확인창에서 고른 값). */
  ppe: StartPpe;
  /** PPE 상태 수신(GET /api/ppe/current 의 마지막 수신 시각). 'unknown' 이면 경고하지 않는다. */
  ppeReceipt: PpeReceipt;
  /** EC2 ↔ Tier 0 연결. 끊겼으면 GPU 확인 창이 맡으므로 PPE 경고를 내지 않는다. */
  tier0: Tier0Link;
  /** 연결된 워치 수(viewer_health.watches.connected). 모르면 null. */
  watchesConnected: number | null;
  /** 현장 경보 단말(노트북) 연결(viewer_health.laptop.link). 모르면 null. */
  laptopConnected: boolean | null;
}

const WATCH_WARNING = {
  true: '연결된 워치가 없어 현장 경보는 현장 노트북에서만 울립니다. 워치 전원과 와이파이를 확인하세요',
  false:
    '연결된 워치·현장 노트북이 없어 현장에서 경보가 울리지 않습니다. 워치 전원과 노트북 연결을 확인하세요',
  null: '연결된 워치가 없습니다. 워치 전원과 와이파이를 확인하세요',
} as const;

/**
 * 작업 전 확인 창의 경고 줄(S15P31A101-730). 시작을 막지 않는다(뒤늦게 막지 않는다).
 * - 안전모·조끼 중 하나라도 필수인데 Tier 0 는 이어져 있고 보호구 상태가 들어오지 않으면: 미착용 경보가 나지 않는다
 * - 연결된 워치가 0대면: 현장 단말(노트북)도 끊겼으면 현장 경보가 울리지 않는다, 이어져 있으면 현장 경보는 노트북으로만 울린다
 */
export function startWarnings(r: StartReadiness): string[] {
  const out: string[] = [];
  const gears = [
    r.ppe.helmet === 'REQUIRED' && '안전모',
    r.ppe.vest === 'REQUIRED' && '조끼',
  ].filter(Boolean);
  if (gears.length > 0 && r.tier0 === 'up' && r.ppeReceipt === 'stale') {
    out.push(
      `보호구 상태가 들어오지 않아 ${gears.join('·')} 미착용 경보가 나지 않습니다. 현장에서 직접 확인하세요`,
    );
  }
  if (r.watchesConnected === 0) {
    out.push(WATCH_WARNING[String(r.laptopConnected) as 'true' | 'false' | 'null']);
  }
  return out;
}
