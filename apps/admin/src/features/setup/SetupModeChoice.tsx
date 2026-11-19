import type { SetupMode } from '@/features/setup/types';
import type { ReuseChoiceState, ReuseMapOption } from '@/features/setup/useReuseScene';
import { Card, CardContent, CardHeader, CardTitle } from '@simai/ui/components/card';
import { cn } from '@simai/ui/lib/utils';
import type { ReactNode } from 'react';

// 1단계 「맵」 방식 고르기(S15P31A101-689). 예전 「3D 공간」 창(세션이 없을 때만 뜸) 대신 1단계 안에 늘 둔다: 실패·취소한 시도가 있어도,
// 새로고침 뒤에도 같은 자리에서 고른다. 새 맵 만들기가 기본이고(S15P31A101-762: 카메라 각도가 바뀌어 있을 위험이 높아 재사용은 고를 때만 쓴다),
// 이전 맵 재사용을 쓸 수 없으면 꺼서 이유를 두 줄(무엇이/어떻게)로 보인다.
// S15P31A101-714: 재사용 안에서 최근 완료 맵을 날짜와 함께 고른다. 재사용을 고르면 지금 카메라와 가장 잘 맞는 맵(추천)이 먼저 골라지고, 맞지 않는 맵은 이유와 함께 꺼진다.
// 재사용은 그 맵을 만들 때의 보정·카메라 높이·구역을 그대로 쓴다(입력한 높이는 쓰지 않는다).

/** 새 맵은 굽기까지 약 13분(15차 실측), 재사용은 카메라 자리만 확인하고 그 맵을 그대로 쓴다(사용자 기준 약 1~2분). */
const NEW_ETA = '기본 · 약 13분';
const REUSE_ETA = '약 1~2분';

const OPTION =
  'flex min-h-16 flex-1 flex-col items-start justify-center gap-1 rounded-lg border px-3.5 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed';
const SELECTED = 'border-primary bg-primary/10 ring-[1.5px] ring-primary ring-inset';
const IDLE = 'border-border bg-card enabled:hover:bg-surface-2';

function Option({
  label,
  eta,
  selected,
  disabled,
  onSelect,
  children,
}: {
  label: string;
  eta: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(OPTION, selected ? SELECTED : IDLE, disabled && 'opacity-60')}
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{eta}</span>
      {children}
    </button>
  );
}

/** 최근 완료 맵 목록(날짜·상태). 고를 수 없는 맵은 꺼지고 이유를 보인다. */
function MapList({
  maps,
  selectedId,
  onSelect,
  disabled,
}: {
  maps: readonly ReuseMapOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="재사용할 맵" className="flex flex-col gap-1.5">
      {maps.map((map) => {
        const selected = map.id === selectedId;
        return (
          <button
            key={map.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || !map.selectable}
            onClick={() => onSelect(map.id)}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed',
              selected ? SELECTED : IDLE,
              !map.selectable && 'opacity-60',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold tabular-nums">
              {map.dateLabel}
              {map.recommended && (
                <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                  추천
                </span>
              )}
            </span>
            <span
              className={cn(
                'text-xs',
                map.selectable ? 'text-muted-foreground' : 'font-semibold text-delay',
              )}
            >
              {map.note}
            </span>
            {map.selectable && map.heightsLabel && (
              <span className="text-xs text-muted-foreground tabular-nums">
                카메라 높이 {map.heightsLabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function SetupModeChoice({
  mode,
  onChange,
  reuse,
  mapId = null,
  onMapChange,
  openMaps = false,
}: {
  /** 지금 고른(또는 기본) 방식. 재사용을 쓸 수 없으면 NEW 다. */
  mode: SetupMode;
  onChange: (mode: SetupMode) => void;
  reuse: ReuseChoiceState;
  /** 재사용으로 시작할 맵(고른 맵, 없으면 추천). 맞는 맵이 없으면 null(S15P31A101-714). */
  mapId?: string | null;
  onMapChange?: (id: string) => void;
  /** 시연 계정: 시점 확인 없이 완료된 맵을 모두 고를 수 있다(features/demo/demoSetup demoReuseOpen). 안내 글에서 「같은 자리인 맵만」을 뺀다. */
  openMaps?: boolean;
}) {
  const reuseDisabled = reuse.checking || reuse.blocked !== null;
  return (
    <Card size="sm" className="shrink-0">
      <CardHeader>
        <CardTitle>
          <h2>맵</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div role="radiogroup" aria-label="맵 방식" className="flex gap-2">
          <Option
            label="새 맵 만들기"
            eta={NEW_ETA}
            selected={mode === 'NEW'}
            disabled={false}
            onSelect={() => onChange('NEW')}
          />
          <Option
            label="이전 맵 재사용"
            eta={reuse.checking ? '확인 중' : REUSE_ETA}
            selected={mode === 'REUSE'}
            disabled={reuseDisabled}
            onSelect={() => onChange('REUSE')}
          >
            {reuse.blocked && (
              <span role="note" aria-label="이전 맵을 쓸 수 없는 이유" className="text-xs">
                <span className="block font-semibold text-delay">{reuse.blocked.what}</span>
                <span className="block text-muted-foreground">{reuse.blocked.how}</span>
              </span>
            )}
            {!reuse.blocked && reuse.note && (
              <span className="text-xs text-muted-foreground">{reuse.note}</span>
            )}
          </Option>
        </div>
        {reuse.maps.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">
              고른 맵을 만들 때의 보정·카메라 높이·구역을 그대로 써요.
              {!openMaps && ' 카메라가 그때와 같은 자리인 맵만 고를 수 있어요.'}
            </p>
            <MapList
              maps={reuse.maps}
              selectedId={mode === 'REUSE' ? mapId : null}
              disabled={mode !== 'REUSE'}
              onSelect={(id) => onMapChange?.(id)}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
