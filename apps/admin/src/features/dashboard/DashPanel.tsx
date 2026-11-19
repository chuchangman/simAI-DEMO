import { Card } from '@simai/ui/components/card';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** 목록 카드: 머리줄(아이콘·제목·개수)과 그 아래 본문. */
export function DashPanel({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="min-h-0 min-w-0 gap-0 rounded-[12px] py-0 text-[15px] leading-[22px] ring-0">
      <div className="flex min-h-[52px] w-full flex-none items-center gap-3 border-b border-border px-4 py-3">
        <h2>
          <span className="flex items-center gap-2 text-[15px] leading-[22px] font-bold">
            <Icon aria-hidden className="size-[18px] text-point-soft" />
            {title}
          </span>
        </h2>
        {count !== undefined && (
          <span className="ml-auto font-mono text-[13px] text-muted-foreground">{count}</span>
        )}
      </div>
      {children}
    </Card>
  );
}
