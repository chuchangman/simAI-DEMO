import { useCurrentRole } from '@/features/auth/useCurrentRole';
import { targetOfKey } from '@/features/layout/spatialHost/selectionKey';
import { useSpatialViewport } from '@/features/layout/SpatialViewportHost';
import { SIDE_PANEL_CLASS, SIDE_PANEL_TITLE_CLASS } from '@/features/monitor/sideColumnStyle';
import { personNameSourceText, type PersonDisplayInfo } from '@/features/people/personDisplay';
import { usePersonDisplay, usePersonRename } from '@/features/people/usePersonDisplay';
import {
  BUTTON_CLASS,
  FIELD_NOTE_CLASS,
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
} from '@/features/zones/zonePanelStyle';
import { isComposing } from '@/lib/imeKey';
import { Button } from '@simai/ui/components/button';
import { Input } from '@simai/ui/components/input';
import { cn } from '@simai/ui/lib/utils';
import { Watch, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';

function WatchStatusLine({ watch }: { watch: PersonDisplayInfo['watch'] }) {
  if (watch.status === 'connected') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-foreground">
        <Watch className="size-3.5 shrink-0 text-sky-400" aria-hidden />
        <span>연결됨</span>
        {watch.deviceId && (
          <code className="truncate font-mono text-[11.5px] text-muted-foreground">
            {watch.deviceId}
          </code>
        )}
      </span>
    );
  }
  if (watch.status === 'disconnected') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-foreground">
        <span className="relative inline-flex shrink-0">
          <Watch className="size-3.5 text-muted-foreground" aria-hidden />
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-red-500"
          />
        </span>
        <span>연결 끊김</span>
        {watch.deviceId && (
          <code className="truncate font-mono text-[11.5px] text-muted-foreground">
            {watch.deviceId}
          </code>
        )}
      </span>
    );
  }
  return <span className="text-muted-foreground">연결된 워치 없음</span>;
}

function PersonRenameForm({ person }: { person: PersonDisplayInfo }) {
  const hasCustomName =
    person.nameSource === 'WATCH_DEVICE' || person.nameSource === 'WORLD_MANUAL';
  const [draft, setDraft] = useState(() => (hasCustomName ? person.displayName : ''));
  const { save, resetName, busy, error, clearError } = usePersonRename();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const ok = await save(person, draft);
    if (ok) {
      setDraft(draft.trim());
    }
  };

  const onReset = async () => {
    if (busy) return;
    const ok = await resetName(person);
    if (ok) {
      setDraft('');
    }
  };

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-1.5 pt-1">
      <label
        htmlFor="person-display-name-input"
        className="text-[12px] font-medium text-muted-foreground"
      >
        표시 이름 변경
      </label>
      <div className="flex items-center gap-1.5">
        <Input
          id="person-display-name-input"
          aria-label="표시 이름"
          value={draft}
          placeholder={hasCustomName ? '예: 김철수' : `${person.displayName} → 예: 김철수`}
          readOnly={busy}
          aria-invalid={error !== null}
          onChange={(event) => {
            if (error) clearError();
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (isComposing(event.nativeEvent)) return;
            if (event.key === 'Escape') {
              event.stopPropagation();
              clearError();
              setDraft(hasCustomName ? person.displayName : '');
            }
          }}
          className={cn(INPUT_CLASS, 'flex-1')}
        />
        <Button
          type="submit"
          disabled={busy}
          className={cn(PRIMARY_BUTTON_CLASS, 'shrink-0 px-2.5')}
        >
          저장
        </Button>
      </div>
      {hasCustomName && (
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={busy}
            onClick={() => void onReset()}
            className={cn(BUTTON_CLASS, 'h-7 px-2 text-[11.5px]')}
          >
            이름 초기화
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className={FIELD_NOTE_CLASS}>
          {error}
        </p>
      )}
      <p className="text-[11.5px] leading-snug text-muted-foreground">
        {person.watch.deviceId !== null
          ? `워치(${person.watch.deviceId})에 저장되어 현장 단위로 계속 유지됩니다.`
          : '연결된 워치가 없어 현재 World ID에 오늘 한정으로 저장됩니다(병합 시 승계).'}
      </p>
    </form>
  );
}

/**
 * 관제 화면에서 사람을 선택했을 때 왼쪽 칼럼에 열리는 사람 상세 패널(S15P31A101-658).
 * 3D 이름표에서 덜어낸 워치 기기 ID·연결 상태·World ID 를 보여 주고, 관리자는 여기서 표시 이름을 바로 바꾼다.
 */
export function PersonDetailPanel() {
  const viewport = useSpatialViewport();
  const target = targetOfKey(viewport?.selectedKey ?? null);
  const selectedWorldId = target?.type === 'person' ? target.id : null;
  const person = usePersonDisplay(selectedWorldId);
  const isAdmin = useCurrentRole() === 'ADMIN';

  if (!viewport || !person) return null;

  return (
    <section aria-label="선택한 작업자" className={cn(SIDE_PANEL_CLASS, 'shrink-0 gap-2')}>
      <div className="flex items-center justify-between">
        <h2 className={SIDE_PANEL_TITLE_CLASS}>선택한 작업자</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="작업자 선택 해제"
          onClick={viewport.clearSelection}
        >
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5 rounded-[10px] bg-surface-2 px-2.5 py-2 text-[13px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[15px] font-bold text-foreground">{person.displayName}</span>
          {person.isDuplicateName && (
            <span className="rounded bg-amber-500/18 px-1.5 py-0.5 text-[11px] font-semibold text-amber-400">
              동명이인 있음
            </span>
          )}
        </div>
        <span className="text-[11.5px] text-muted-foreground">
          {personNameSourceText(person.nameSource)}
        </span>

        <dl className="mt-1 grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1 border-t border-border/60 pt-1.5 text-[12px]">
          <dt className="text-muted-foreground">워치</dt>
          <dd className="min-w-0">
            <WatchStatusLine watch={person.watch} />
          </dd>
          <dt className="text-muted-foreground">World ID</dt>
          <dd className="min-w-0 truncate">
            <code className="font-mono text-[11.5px] text-foreground">{person.worldId}</code>
          </dd>
        </dl>
      </div>

      {isAdmin && <PersonRenameForm key={person.worldId} person={person} />}
    </section>
  );
}
