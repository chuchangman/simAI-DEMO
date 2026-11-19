import { formatBytes } from '@/features/setup/supplement';
import type { SupplementRow, SupplementRowAction } from '@/features/setup/supplementUpload';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { Film, Image as ImageIcon } from 'lucide-react';

// 맵 보강 촬영 파일 목록(세팅 화면 카드와 휴대폰 화면이 같이 쓴다, S15P31A101-607).

const ACTION_LABEL: Record<SupplementRowAction, string> = {
  remove: '빼기',
  cancel: '취소',
  retry: '다시 올리기',
  dismiss: '지우기',
};

export function SupplementUploadList({
  rows,
  rejected,
  onAction,
  removingMediaId,
  large = false,
}: {
  rows: readonly SupplementRow[];
  rejected: readonly { fileName: string; reason: string }[];
  onAction: (row: SupplementRow, action: SupplementRowAction) => void;
  removingMediaId: string | null;
  /** 휴대폰: 누르기 쉽게 크게 그린다. */
  large?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rejected.length > 0 && (
        <ul aria-label="올리지 않은 파일" className="flex flex-col gap-1 text-xs">
          {rejected.map((r, i) => (
            <li key={`${r.fileName}-${i}`} className="text-muted-foreground">
              <span className="font-medium text-foreground">{r.fileName}</span> · {r.reason}
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">아직 올린 파일이 없습니다</p>
      ) : (
        <ul aria-label="보강 촬영 파일" className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li
              key={row.key}
              className={cn(
                'flex flex-col gap-1 rounded-lg bg-surface-2 px-3',
                large ? 'py-3 text-sm' : 'py-2 text-xs',
              )}
            >
              <div className="flex items-center gap-2">
                {row.kind === 'VIDEO' ? (
                  <Film aria-label="동영상" className="size-4 flex-none text-muted-foreground" />
                ) : (
                  <ImageIcon aria-label="사진" className="size-4 flex-none text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                <span className="flex-none font-mono text-muted-foreground">
                  {formatBytes(row.sizeBytes)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  role="status"
                  className={cn(
                    'min-w-0 flex-1',
                    row.failed ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {row.statusText}
                </span>
                {row.actions.map((action) => (
                  <Button
                    key={action}
                    size={large ? 'default' : 'xs'}
                    variant="secondary"
                    className="bg-surface-3 hover:bg-surface-3/70"
                    disabled={action === 'remove' && row.mediaId === removingMediaId}
                    onClick={() => onAction(row, action)}
                  >
                    {ACTION_LABEL[action]}
                  </Button>
                ))}
              </div>
              {row.progress !== null && (
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={row.progress}
                  aria-label={`${row.name} 올리는 중`}
                  className="h-1.5 overflow-hidden rounded-full bg-surface-3"
                >
                  <div className="h-full bg-primary" style={{ width: `${row.progress}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
