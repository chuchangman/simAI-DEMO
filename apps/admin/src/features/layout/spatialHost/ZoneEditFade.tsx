import { cn } from '@simai/ui/lib/utils';

const TONE = 'from-primary/20 via-primary/7 to-transparent dark:from-primary/26 dark:via-primary/9';

// 네 가장자리에서 안쪽으로 옅어지는 띠(위·아래는 높이 14%, 왼쪽·오른쪽은 너비 12%).
const EDGES = [
  'inset-x-0 top-0 h-[14%] bg-linear-to-b',
  'inset-x-0 bottom-0 h-[14%] bg-linear-to-t',
  'inset-y-0 left-0 w-[12%] bg-linear-to-r',
  'inset-y-0 right-0 w-[12%] bg-linear-to-l',
];

/** 구역 편집 화면임을 알리는 가장자리 번짐. 클릭을 막지 않고 상단 바 아래부터 깐다. */
export function ZoneEditFade() {
  return (
    <div
      aria-hidden
      data-testid="zone-edit-fade"
      className="pointer-events-none absolute top-[56px] right-0 bottom-0 left-0 z-[2]"
    >
      {EDGES.map((edge) => (
        <div key={edge} className={cn('absolute', edge, TONE)} />
      ))}
    </div>
  );
}
