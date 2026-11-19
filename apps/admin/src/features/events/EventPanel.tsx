import { useIsDemoAccount } from '@/features/demo/demoAccount';
import { alarmingCardsFirst } from '@/features/demo/demoEvents';
import { GHOST_MAX_LIFE_MS } from '@/features/events/constants';
import { isAlarming, type EventEntry } from '@/features/events/entries';
import type { OutsideWorkKind } from '@/features/events/EventBadges';
import { EventDetail } from '@/features/events/EventDetail';
import { IncidentCard } from '@/features/events/IncidentCard';
import {
  eventSections,
  incidentOf,
  isGone,
  type AliveIds,
  type EventSections,
  type Incident,
} from '@/features/events/incidents';
import { defaultPanelHeight, movePanel, PANEL_DEFAULT_STYLE } from '@/features/events/panelBox';
import { PanelGrip } from '@/features/events/PanelGrip';
import type { EventItem } from '@/features/events/types';
import { useAutoFold } from '@/features/events/useAutoFold';
import { useAvoidCctv } from '@/features/events/useAvoidCctv';
import { useFloatingBox } from '@/features/events/useFloatingBox';
import { usePanelDrag } from '@/features/events/usePanelDrag';
import { ConfirmDialog } from '@/features/work/ConfirmDialog';
import { measure, type FloatBox, type Measured } from '@/lib/floatSpot';
import {
  ALIVE_ID_SEPARATOR,
  selectAliveIdsKey,
  selectTrackedCount,
  useRealtimeStore,
} from '@/store/realtime.store';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * 기본 자리: 오른쪽 위(PANEL_TOP·PANEL_GAP 과 같다). 높이는 PANEL_DEFAULT_STYLE(펼치면 화면의 46%, 접으면 머리줄만큼)이다.
 * 폭은 --event-panel-width 이고, 상단 알림·2D 창이 오른쪽에서 비키는 간격(--event-panel-inset)이 이 폭에 맞춰 정해진다(index.css).
 */
const PANEL_CLASS =
  'absolute top-[72px] right-3.5 z-[6] flex w-(--event-panel-width) flex-col gap-2 rounded-[16px] bg-card/82 p-2.5 shadow-float ring-1 ring-border backdrop-blur-[8px] ring-inset';

const NOTE_CLASS = 'mx-2 my-4 text-sm text-faint';

/** 「진행 중」·「최근 해소」 카드가 있는지. 없으면 패널을 저절로 접는다(지난 관제만 있어도 접는다). */
const hasRecentCards = ({ active, resolved }: EventSections) => active.length + resolved.length > 0;

/** 보이는 카드가 하나라도 있는지(지난 관제·잠깐 잡힌 번호 포함). 「모두 지우기」 버튼과 빈 목록 문구가 쓴다. */
const hasCards = (sections: EventSections) =>
  hasRecentCards(sections) || sections.stale.length > 0 || sections.ghost.length > 0;

/** 옮긴 자리의 인라인 스타일. 접으면 높이는 머리줄만큼이다. */
const boxStyle = (box: FloatBox, folded: boolean): CSSProperties => ({
  left: box.left,
  top: box.top,
  width: box.width,
  height: folded ? undefined : box.height,
  right: 'auto',
  bottom: 'auto',
});

function FoldButton({ folded, onToggle }: { folded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={!folded}
      aria-label={folded ? '이벤트 펼치기' : '이벤트 접기'}
      onClick={onToggle}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
    >
      <span
        aria-hidden
        className={cn('inline-block transition-transform duration-200', folded && 'rotate-180')}
      >
        ▾
      </span>
    </button>
  );
}

/**
 * 처음에는 접어 두는 칸. 펼치면 카드로 보이고 상세·운영자 종료는 진행 중과 같다.
 * - 「지난 관제 · 확인 필요 N건」(S15P31A101-595): 해소 전이지만 지금 Tier 0 가 들고 있지 않은 이벤트(GPU 를 끈 관제에서 열린 채 남은 것).
 *   경보·소리·2D 평면에는 들어가지 않는다.
 * - 「잠깐 잡힌 번호 · 안 보임 N건」(S15P31A101-785): 잠깐 생겼다 사라졌거나 병합으로 흡수된 사람(유령 트랙)의 사라짐 카드. 경보·소리는 그대로다.
 */
function FoldedSection({
  label,
  count,
  hint,
  children,
}: {
  label: string;
  count: number;
  hint?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const title = `${label} ${count}건`;
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <button
        type="button"
        title={hint}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md px-1 text-left text-[15px] font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground"
      >
        <span
          aria-hidden
          className={cn('inline-block transition-transform duration-200', !open && '-rotate-90')}
        >
          ▾
        </span>
        {title}
      </button>
      {open && <ul className="flex flex-col gap-2 p-0.5">{children}</ul>}
    </section>
  );
}

/** 잠깐 잡힌 번호 칸의 설명(S15P31A101-785). */
const GHOST_HINT = `${GHOST_MAX_LIFE_MS / 1000}초 안에 잡혔다 사라졌거나 다른 번호에 합쳐진 작업자 번호의 사건입니다. 같은 사람이 잠깐 두 번호로 잡힌 경우가 많습니다. 위험이 끝난 것은 아니며, 펼쳐서 확인·종료할 수 있습니다.`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="px-1 text-[15px] font-bold">{title}</h3>
      <ul className="flex flex-col gap-2 p-0.5">{children}</ul>
    </section>
  );
}

interface EventListProps {
  sections: EventSections;
  loaded: boolean;
  failed: boolean;
  outsideWorkOf?: (event: EventItem) => OutsideWorkKind | null;
  selectedKey: string | null;
  /** 지금 살아 있는 사람(null 은 모른다). 사라진 사람의 카드를 흐리게 한다(S15P31A101-757). */
  alive: AliveIds;
  onSelect: (incident: Incident) => void;
  onOpen: (eventId: string) => void;
}

/**
 * 「진행 중」·「최근 해소」·「지난 관제 · 확인 필요」(접힘) 칸의 카드 목록(빈 칸은 그리지 않는다). 모두 비었으면 상태(없음·받는 중)를
 * 한 줄로 보인다. 지난 관제만 남았으면 진행 중이 없다는 것을 한 줄로 보인다. 받지 못했으면 패널 위의 실패 문구가 대신한다.
 */
function EventList({
  sections,
  loaded,
  failed,
  outsideWorkOf,
  selectedKey,
  alive,
  ...card
}: EventListProps) {
  const { active, ghost, resolved, stale, staleEvents } = sections;
  const outside = (incident: Incident): OutsideWorkKind | null => {
    if (outsideWorkOf === undefined) return null;
    for (const e of incident.entries) {
      const kind = outsideWorkOf(e.event);
      if (kind !== null) return kind;
    }
    return null;
  };
  if (!hasCards(sections)) {
    if (loaded) return <p className={NOTE_CLASS}>활성 이벤트 없음</p>;
    return failed ? null : <p className={NOTE_CLASS}>불러오는 중…</p>;
  }
  return (
    <div className="flex flex-col gap-3 p-0.5">
      {/* 지난 관제만 남았으면 지금 진행 중인 것이 없다는 것을 먼저 알린다 */}
      {active.length === 0 && stale.length + ghost.length > 0 && (
        <p className="mx-2 text-sm text-faint">진행 중 이벤트 없음</p>
      )}
      {active.length > 0 && (
        <Section title="진행 중">
          {active.map(({ id, incident, occurrences, people }) => (
            <IncidentCard
              key={id}
              incident={incident}
              occurrences={occurrences}
              people={people}
              selected={incident.key === selectedKey}
              gone={isGone(incident, alive)}
              outsideWork={outside(incident)}
              {...card}
            />
          ))}
        </Section>
      )}
      {resolved.length > 0 && (
        <Section title="최근 해소">
          {resolved.map(({ id, incident, occurrences, people }) => (
            <IncidentCard
              key={id}
              incident={incident}
              occurrences={occurrences}
              people={people}
              selected={incident.key === selectedKey}
              outsideWork={outside(incident)}
              {...card}
            />
          ))}
        </Section>
      )}
      {ghost.length > 0 && (
        <FoldedSection label="잠깐 잡힌 번호 · 안 보임" count={ghost.length} hint={GHOST_HINT}>
          {ghost.map(({ id, incident, occurrences, people }) => (
            <IncidentCard
              key={id}
              incident={incident}
              occurrences={occurrences}
              people={people}
              selected={incident.key === selectedKey}
              gone
              outsideWork={outside(incident)}
              {...card}
            />
          ))}
        </FoldedSection>
      )}
      {stale.length > 0 && (
        <FoldedSection label="지난 관제 · 확인 필요" count={staleEvents}>
          {stale.map((incident) => (
            <IncidentCard
              key={incident.key}
              incident={incident}
              selected={incident.key === selectedKey}
              outsideWork={outside(incident)}
              {...card}
            />
          ))}
        </FoldedSection>
      )}
    </div>
  );
}

interface EventPanelProps {
  entries: EventEntry[];
  /** 목록(REST)을 받아 합쳤는지. false 면 STOMP 로 받은 것만 있다. */
  loaded: boolean;
  /** 목록을 아직 못 받았고 마지막 시도가 실패했다. */
  failed: boolean;
  selectedKey: string | null;
  onSelect: (incident: Incident) => void;
  openEventId: string | null;
  onOpen: (eventId: string | null) => void;
  /** 「목록에서 숨기기」(옛 「모두 지우기」). 화면에서만 숨기고 서버·확인 상태는 건드리지 않는다. */
  onClearAll: () => void;
  /** 이 이벤트가 작업 외 진입이면 그 이유(카드에 꼬리표). 없으면 꼬리표를 달지 않는다. */
  outsideWorkOf?: (event: EventItem) => OutsideWorkKind | null;
  /**
   * 지금 실행이 시작된 시각(EC2 ms). null 은 진행 중인 실행이 없음(작업 전·대기): 「최근 해소」를 비우고 머리줄 사람 수를 미리보기로 적는다.
   * 주지 않으면(작업 목록을 모름) 거르지 않고 「작업자」로 적는다(S15P31A101-731).
   */
  runStartedAt?: number | null;
  /** GPU 가 꺼져 있다고 확실히 알면 true(S15P31A101-752): 사람 수를 지어내지 않고 머리줄에 「GPU 꺼짐」을 적는다. */
  gpuOff?: boolean;
  /** 목록 아래에 붙는 것(이번 실행 전 이벤트 안내). 접으면 함께 접힌다. */
  footer?: ReactNode;
}

/** 머리줄 사람 수를 올려 보면 나오는 설명(S15P31A101-731). */
const PEOPLE_TITLE =
  '지금 카메라로 추적 중인 사람 수입니다(확정·가려짐 트랙). 같은 사람이 잠깐 두 번호로 잡히면 많게, 가려지면 적게 보일 수 있습니다.';
/** 작업 전(실행 없음)의 사람 수 설명. */
/** GPU 꺼짐의 사람 수 설명. */
const GPU_OFF_TITLE =
  'GPU 가 꺼져 있어 카메라 추적과 위험 판정이 멈춰 있습니다. 상단의 GPU 에서 켤 수 있습니다.';
const PREVIEW_TITLE = `작업을 시작하기 전 미리보기입니다. 경보는 꺼져 있습니다. ${PEOPLE_TITLE}`;
/** 머리줄 진행 중 수를 올려 보면 나오는 설명: 사건(카드)과 경보(기록 한 건 한 건)를 가른다. */
const ACTIVE_TITLE =
  '지금 진행 중인 사건(카드) 수입니다. 한 사람의 여러 규칙과, 트랙 번호만 바뀌며 이어진 같은 위험은 한 사건으로 셉니다. 경보 기록 한 건 한 건의 수는 작업 관리의 작업 현황·종료 미팅에 있습니다.';

/** 머리줄 해소 대기 수 설명(S15P31A101-757). */
const WAITING_TITLE =
  '대상 사람이 카메라에서 사라졌지만 아직 확인·해소되지 않은 사건 수입니다. 사람이 다시 보이거나 확인·해소하면 줄어듭니다.';

/** 「목록에서 숨기기」 단추 설명: 확인 처리가 아니다(S15P31A101-731). */
const CLEAR_TITLE =
  '지금 보이는 이벤트를 이 브라우저의 목록·배너·경보음에서만 숨깁니다. 확인(ACK) 처리가 아니며 서버 기록과 확인 상태는 그대로입니다. 새로 나거나 등급이 오른 경보는 다시 보입니다.';

/** 숨기기 전 확인 창: 미확인 경보가 있을 때만 띄운다(확인한 것처럼 보이지 않게). */
function ClearConfirm({
  unacked,
  onConfirm,
  onCancel,
}: {
  unacked: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      title="목록에서 숨길까요?"
      description={`확인(ACK) 처리가 아닙니다. 미확인 경보 ${unacked}건이 이 화면의 목록·배너·경보음에서 사라지지만 확인 기록은 남지 않습니다. 서버 기록은 그대로이고, 새로 나거나 등급이 오른 경보는 다시 보입니다.`}
      confirmLabel="숨기기"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/**
 * 실시간 관제 오른쪽 이벤트 패널: 머리줄의 사람 수·진행 중 사건 수, 「진행 중」·「최근 해소」 카드 목록(명세 13.4, FR-4)과 사건 상세 창.
 * 머리줄의 진행 중 수는 진행 중 카드(지금 Tier 0 가 들고 있는 사건, 화면 묶음 뒤)만 센다. 지난 관제는 목록 끝의 접힌 칸에 있다(S15P31A101-595).
 * 경보 기록 한 건 한 건의 수(작업 현황·종료 미팅)와 이름을 가른다(S15P31A101-731). 작업 전(실행 없음)이면 사람 수는 「미리보기」다.
 * 머리줄을 끌어 옮기고(두 번 누르면 제자리), 가장자리 손잡이로 크기를 바꾸고, ▾ 로 접는다(관제 데모와 같다).
 * 보이는 카드가 있으면 머리줄에 「목록에서 숨기기」가 있다(확인 처리가 아니다. 미확인 경보가 있으면 확인 창을 먼저 띄운다).
 */
export function EventPanel({
  entries,
  loaded,
  failed,
  selectedKey,
  onSelect,
  openEventId,
  onOpen,
  onClearAll,
  outsideWorkOf,
  runStartedAt,
  gpuOff = false,
  footer,
}: EventPanelProps) {
  // 화면 묶음(S15P31A101-731)이 지금 살아 있는 서로 다른 두 사람을 섞지 않게 살아 있는 World ID 를 본다. 사람이 바뀔 때만 다시 묶는다.
  const aliveKey = useRealtimeStore(selectAliveIdsKey);
  const alive = useMemo(
    () => (aliveKey === null ? null : new Set(aliveKey ? aliveKey.split(ALIVE_ID_SEPARATOR) : [])),
    [aliveKey],
  );
  // 유령 트랙(S15P31A101-785)을 가르는 World ID 기록. 보인 구간은 world 마다 바뀌어 구독하지 않고, 사람이 바뀔 때(alive) 그 순간 값을 읽는다.
  const watched = useRealtimeStore((s) => s.trackLife.watched);
  const demo = useIsDemoAccount();
  const sections = useMemo(() => {
    const { lives, survivorOf } = useRealtimeStore.getState().trackLife;
    const all = eventSections(entries, {
      alive,
      runStartedAt,
      life: { lives, survivorOf, watched },
    });
    // 시연 계정은 경보 배너가 없어 확인 대기 경보 카드를 맨 위에 둔다(features/demo/demoEvents)
    return demo ? { ...all, active: alarmingCardsFirst(all.active) } : all;
  }, [entries, alive, runStartedAt, watched, demo]);
  const goneCount = useMemo(
    () => sections.active.filter((card) => isGone(card.incident, alive)).length,
    [sections.active, alive],
  );
  const trackedCount = useRealtimeStore(selectTrackedCount);
  const unacked = useMemo(() => entries.filter(isAlarming).length, [entries]);
  const [confirmClear, setConfirmClear] = useState(false);
  const clear = () => (unacked > 0 ? setConfirmClear(true) : onClearAll());
  const preview = runStartedAt === null;
  const opened = useMemo(
    () => (openEventId ? incidentOf(entries, openEventId) : undefined),
    [entries, openEventId],
  );
  const openedMissing = openEventId !== null && !opened && loaded;

  // 연 이벤트가 목록에서 빠지면(오래된 해소 정리, 다른 계정) 상세를 닫는다. 나중에 같은 이벤트가 다시 와도 저절로 열리지 않게 한다.
  useEffect(() => {
    if (openedMissing) onOpen(null);
  }, [openedMissing, onOpen]);

  const panel = useRef<HTMLElement>(null);
  const { box, setBox, reset } = useFloatingBox(panel);
  // 목록을 받았는데 진행·최근 해소가 모두 0이면 접는다(지난 관제만 남아도 접는다). 목록을 못 받았거나 받는 중이면 접지 않는다
  // (실패 문구를 가리지 않는다).
  const { folded, setFolded } = useAutoFold(loaded && !hasRecentCards(sections));
  // 떠 있는 CCTV 창이 가리면 창 위·아래 넓은 빈칸으로 비켜 선다. 비켜 선 채 끌거나 크기를 바꾸면 그 자리가 새 기준(box)이다.
  const avoided = useAvoidCctv(panel, box, folded);
  const shown = avoided ?? box;
  // 끌기 시작 자리. 접힌 패널은 머리줄 높이로 재지므로 펼친 높이(옮긴 높이, 없으면 기본 자리 높이)로 바꾼다.
  const startOf = (): Measured => {
    const now = measure(panel.current);
    if (!now || !folded) return now;
    const height = box?.height ?? defaultPanelHeight(now.bounds);
    return { ...now, box: { ...now.box, height } };
  };
  const move = usePanelDrag(startOf, (start, dx, dy, bounds) =>
    setBox(movePanel(start, dx, dy, bounds)),
  );

  return (
    <>
      <aside
        ref={panel}
        aria-label="이벤트"
        style={shown ? boxStyle(shown, folded) : folded ? undefined : PANEL_DEFAULT_STYLE}
        className={PANEL_CLASS}
      >
        <div
          data-testid="event-panel-head"
          {...move.handlers}
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).closest('button')) reset();
          }}
          className={cn(
            'flex min-h-9 touch-none items-center gap-2 rounded-md pr-0.5 pl-2 select-none',
            move.active ? 'cursor-grabbing' : 'cursor-grab',
          )}
        >
          <b className="text-[15px]">
            <span title={gpuOff ? GPU_OFF_TITLE : preview ? PREVIEW_TITLE : PEOPLE_TITLE}>
              {gpuOff
                ? 'GPU 꺼짐 · 사람 수 알 수 없음'
                : preview
                  ? `미리보기 · 사람 ${trackedCount}명`
                  : `작업자 ${trackedCount}명`}
            </span>
            {' · '}
            <span title={ACTIVE_TITLE}>진행 중 {sections.active.length - goneCount}건</span>
            {goneCount > 0 && (
              <>
                {' · '}
                <span title={WAITING_TITLE}>해소 대기 {goneCount}건</span>
              </>
            )}
          </b>
          <div className="ml-auto flex items-center gap-1">
            {hasCards(sections) && (
              <Button variant="secondary" size="sm" title={CLEAR_TITLE} onClick={clear}>
                목록에서 숨기기
              </Button>
            )}
            <FoldButton folded={folded} onToggle={() => setFolded(!folded)} />
          </div>
        </div>
        {!folded && (
          <>
            {failed && (
              <p role="alert" className="px-2 text-sm text-muted-foreground">
                이벤트 목록을 받지 못했습니다
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <EventList
                sections={sections}
                loaded={loaded}
                failed={failed}
                outsideWorkOf={outsideWorkOf}
                selectedKey={selectedKey}
                alive={alive}
                onSelect={onSelect}
                onOpen={onOpen}
              />
            </div>
            {footer}
            <PanelGrip edge="y" startOf={startOf} onResize={setBox} onReset={reset} />
            <PanelGrip edge="xy" startOf={startOf} onResize={setBox} onReset={reset} />
          </>
        )}
        <PanelGrip edge="x" startOf={startOf} onResize={setBox} onReset={reset} />
      </aside>
      {opened && openEventId && (
        <EventDetail incident={opened} openEventId={openEventId} onClose={() => onOpen(null)} />
      )}
      {confirmClear && (
        <ClearConfirm
          unacked={unacked}
          onConfirm={() => {
            setConfirmClear(false);
            onClearAll();
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </>
  );
}
