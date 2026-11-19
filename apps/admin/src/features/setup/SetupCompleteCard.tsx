import { isDemoNewMap } from '@/features/demo/demoNewMap';
import { completeBlockedReason, deriveSceneTierStatus } from '@/features/setup/setup';
import type { AppliedZones, SetupSessionResponse } from '@/features/setup/types';
import { Card, CardContent, CardHeader, CardTitle } from '@simai/ui/components/card';

// 세팅을 끝낸 뒤 구역 단계 오른쪽 칸에 남는 「세팅 완료」 요약 카드(C17, S15P31A101-615). 완료는 구역 단계 아래 오른쪽 단추가
// useCompleteSetup 으로 부른다. 완료 뒤에는 이 세팅으로 구역·보강을 고치지 않는다(하루 1회).
// S15P31A101-691: 개수 한 줄 대신 사용 맵 · 카메라 확인 · 구역 · 저장 결과를 줄마다 보인다(모르는 값은 줄을 빼고 지어내지 않는다).

/**
 * 세팅 구역 목록이 비었을 때 완료 전에 묻는 문구(목록에 없는 관제 구역은 보관된다). 지금 관제 구역 이름을 알면 몇 개·무엇이 보관되는지
 * 구체적으로 쓴다(S15P31A101-691). 이름을 모르면 개수 없이 묻는다.
 */
export function emptyZonePlanConfirm(liveZoneNames: readonly string[] | null): string {
  if (liveZoneNames === null)
    return '저장한 구역이 없어 지금 관제 구역이 모두 보관됩니다. 그래도 세팅을 완료할까요?';
  if (liveZoneNames.length === 0)
    return '저장한 구역이 없습니다. 완료하면 위험 구역 없이 관제합니다(지금 관제 구역도 없습니다). 그래도 세팅을 완료할까요?';
  const shown = liveZoneNames.slice(0, 3).join(', ');
  const more = liveZoneNames.length > 3 ? ` 외 ${liveZoneNames.length - 3}개` : '';
  return `저장한 구역이 없습니다. 완료하면 지금 관제 구역 ${liveZoneNames.length}개(${shown}${more})가 모두 보관되고 위험 구역 없이 관제합니다. 그래도 세팅을 완료할까요?`;
}

/** 완료 요약 한 줄(이름 · 값). */
export interface SetupSummaryRow {
  label: string;
  value: string;
}

/** 사용 맵 이름. 이전 맵 재사용은 맵을 새로 만들지 않았다(시연 계정의 새 맵은 새 맵으로 보인다, features/demo/demoNewMap). */
function mapLabel(session: SetupSessionResponse): string {
  if (session.mode === 'REUSE' && !isDemoNewMap(session.setup_session_id)) return '이전 맵 재사용';
  return deriveSceneTierStatus(session).tier === 'FINAL'
    ? '새 맵 · 정밀 3D 맵'
    : '새 맵 · 미리보기 맵';
}

/** 카메라 확인 결과(카메라마다 PASS 인 수 / 전체). 확인 결과가 없으면 null(줄을 뺀다). */
function cameraCheckLabel(session: SetupSessionResponse): string | null {
  const cameras = Object.values(session.camera_check?.cameras ?? {});
  if (cameras.length === 0) return session.camera_check_passed ? '통과' : null;
  const passed = cameras.filter((c) => c.verdict === 'PASS').length;
  if (session.camera_check_passed === true && passed === cameras.length)
    return `카메라 ${cameras.length}대 모두 통과`;
  return session.camera_check_passed === true
    ? `통과 (카메라 ${passed}/${cameras.length}대 확인)`
    : `카메라 ${passed}/${cameras.length}대 통과`;
}

/** 저장 결과 한 줄(0 인 항목은 뺀다). */
function appliedLabel(applied: AppliedZones): string {
  const parts = [
    applied.created.length > 0 ? `새로 ${applied.created.length}` : null,
    applied.updated.length > 0 ? `고침 ${applied.updated.length}` : null,
    applied.kept.length > 0 ? `그대로 ${applied.kept.length}` : null,
    applied.archived.length > 0 ? `보관 ${applied.archived.length}` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? `관제 구역에 적용 · ${parts.join(' · ')}` : '바뀐 구역 없음';
}

/**
 * 완료 요약 줄(S15P31A101-691): 사용 맵 · 카메라 확인 · 구역 수 · 저장 결과. applied 는 방금 완료한 이 화면에서만 있으므로
 * 없으면 구역·저장 줄을 빼고(다른 화면에서 이미 완료) 지어내지 않는다.
 */
export function setupSummaryRows(
  session: SetupSessionResponse,
  applied: AppliedZones | null,
): SetupSummaryRow[] {
  const rows: SetupSummaryRow[] = [{ label: '사용 맵', value: mapLabel(session) }];
  const check = cameraCheckLabel(session);
  if (check) rows.push({ label: '카메라 확인', value: check });
  if (applied) {
    const zones = applied.created.length + applied.updated.length + applied.kept.length;
    rows.push({ label: '위험 구역', value: zones > 0 ? `${zones}개` : '없음' });
    rows.push({ label: '저장 결과', value: appliedLabel(applied) });
  }
  return rows;
}

/** 이 세션으로 세팅을 완료했는지(서버 setup_completed_at_ms). */
export function setupCompleted(session: SetupSessionResponse | null | undefined): boolean {
  return session?.setup_completed_at_ms != null;
}

/**
 * 세팅을 완료할 수 있는 때: 아직 완료 전이고 세션 쪽 완료 조건(서버 complete_blocked_reason 과 같은 판정, S15P31A101-688)을 모두
 * 채웠다 — 새 모델은 정밀 3D 맵까지, 재사용은 기존 맵 맞추기까지, 둘 다 카메라 확인 통과. 미리보기 맵만으로는 완료하지 않는다.
 */
export function canCompleteSetup(session: SetupSessionResponse | null | undefined): boolean {
  return session != null && !setupCompleted(session) && completeBlockedReason(session) === null;
}

/**
 * 완료 시각 글. 오늘이면 시각만, 오늘이 아니면 날짜를 앞에 붙인다(S15P31A101-752: 다음 날 열면 오늘 세팅처럼 보이지 않게).
 * 올해가 아니면 연도도 붙인다. now 는 시험용.
 */
export function completedAtLabel(ms: number, now: number = Date.now()): string {
  const at = new Date(ms);
  const today = new Date(now);
  const time = at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  if (at.toDateString() === today.toDateString()) return time;
  const date = at.toLocaleDateString('ko-KR', {
    ...(at.getFullYear() !== today.getFullYear() && { year: 'numeric' as const }),
    month: 'long',
    day: 'numeric',
  });
  return `${date} ${time}`;
}

/** 완료한 세션의 상태 카드. 완료 전 세션이면 아무것도 그리지 않는다. applied 는 방금 완료한 이 화면에서만 받는다. */
export function SetupCompleteCard({
  session,
  applied = null,
}: {
  session: SetupSessionResponse;
  applied?: AppliedZones | null;
}) {
  if (session.setup_completed_at_ms == null) return null;
  return (
    <Card size="sm" data-testid="setup-complete-card">
      <CardHeader>
        <CardTitle>
          <h3>세팅 완료</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p role="status" className="font-semibold text-ok">
          {completedAtLabel(session.setup_completed_at_ms)}에 세팅을 완료했습니다
        </p>
        <dl aria-label="세팅 요약" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {setupSummaryRows(session, applied).map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          이 세팅으로는 구역·맵 보강을 더 고치지 않습니다. 구역 수정은 관제 화면의 구역 편집에서
          하세요.
        </p>
      </CardContent>
    </Card>
  );
}
