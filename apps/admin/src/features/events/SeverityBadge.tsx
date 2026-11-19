import { SEVERITY_LABEL } from '@/features/events/constants';
import type { Severity } from '@/features/events/types';
import { Badge } from '@simai/ui/components/badge';
import { cn } from '@simai/ui/lib/utils';

// 빨강·주황·노랑은 위험 등급에만 쓴다(CONVENTION). 위험 빨강·경고 주황·주의 노랑이고, 위험만 채운다.
// 기호(▲▲ 등)는 색 없이도 등급을 가르는 표시라 화면 낭독기에는 읽히지 않게 한다. 글자는 위험·경고·주의·안내다.
const LOOK: Record<Severity, { glyph: string; className: string }> = {
  CRITICAL: { glyph: '▲▲', className: 'border-sev-critical bg-sev-critical text-background' },
  HIGH: { glyph: '▲', className: 'border-sev-high text-sev-high' },
  CAUTION: { glyph: '!', className: 'border-sev-caution text-sev-caution' },
  INFO: { glyph: 'i', className: 'border-faint text-muted-foreground' },
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const look = LOOK[severity];
  return (
    <Badge variant="outline" className={cn('rounded-[4px] font-bold', look.className, className)}>
      <span aria-hidden>{look.glyph}</span>
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}
