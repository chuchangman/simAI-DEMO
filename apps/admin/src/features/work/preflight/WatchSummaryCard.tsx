import { useWatchBindingsList } from '@/features/watch/useWatch';
import { linkKeyOf, watchesOfLinkKey, watchSummaryRows } from '@/features/watch/watchStatus';
import { useLinkAlive } from '@/hooks/useLinkAlive';
import { useRealtimeStore } from '@/store/realtime.store';
import type { ViewerHealthPayload } from '@simai/contracts';
import { Badge } from '@simai/ui/components/badge';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@simai/ui/components/card';
import { cn } from '@simai/ui/lib/utils';
import { useMemo } from 'react';

// 작업 전 확인의 '워치' 카드(S15P31A101-692): 등록된 워치마다 표시 이름 · 기기 · 연결, 현장의 사람과 짝지어졌으면 그 표시.
// 연결은 /topic/health 의 watches(정본), 이름은 watch_names, 짝지음은 배정 조회(GET /api/watch-bindings)다. 시작을 막지 않는다.
// health 는 1초마다 새 객체라 연결·이름은 글자 키로만 구독한다(배터리·시각 변화로 다시 그리지 않게).

type WatchNames = ViewerHealthPayload['watch_names'];

export function WatchSummaryCard() {
  const alive = useLinkAlive();
  const linkKey = useRealtimeStore((s) => (alive ? linkKeyOf(s.health?.payload.watches) : ''));
  const registered = useRealtimeStore((s) =>
    alive ? (s.health?.payload.watches?.registered ?? null) : null,
  );
  const namesKey = useRealtimeStore((s) =>
    alive ? JSON.stringify(s.health?.payload.watch_names ?? []) : '[]',
  );
  const { bindings } = useWatchBindingsList();
  const rows = useMemo(
    () => watchSummaryRows(watchesOfLinkKey(linkKey), JSON.parse(namesKey) as WatchNames, bindings),
    [linkKey, namesKey, bindings],
  );
  const connected = rows.filter((row) => row.connected).length;
  const unknown = registered === null && rows.length === 0;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2>워치</h2>
        </CardTitle>
        {rows.length > 0 && (
          <CardAction>
            <Badge variant="outline" className="rounded-[4px]">
              {`연결 ${connected}/${rows.length}`}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {unknown && <p className="text-muted-foreground">워치 상태를 아직 모릅니다.</p>}
        {!unknown && rows.length === 0 && (
          <p className="text-muted-foreground">등록된 워치가 없습니다.</p>
        )}
        {rows.length > 0 && (
          <ul aria-label="워치 목록" className="flex flex-col divide-y divide-border">
            {rows.map((row) => (
              <li key={row.deviceId} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                <b className="min-w-0 truncate">{row.name ?? '이름 없음'}</b>
                <span className="min-w-0 truncate text-muted-foreground">{row.deviceId}</span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  {row.connected && row.bound && (
                    <span className="text-muted-foreground">사람 연결됨</span>
                  )}
                  <span
                    className={cn('font-medium', row.connected ? 'text-ok' : 'text-destructive')}
                  >
                    {row.connected ? '연결됨' : '끊김'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {connected < rows.length && (
          <p className="text-muted-foreground">끊긴 워치는 전원과 와이파이 연결을 확인하세요.</p>
        )}
      </CardContent>
    </Card>
  );
}
