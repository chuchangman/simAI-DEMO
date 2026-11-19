import { ALARM_BORDER } from '@/features/events/alarmTone';
import { SEVERITY_LABEL } from '@/features/events/constants';
import type { Zone } from '@/features/zones/types';
import { NAME_INPUT_MAX } from '@/features/zones/zoneForm';
import { zoneDisplayName } from '@/features/zones/zoneName';
import { INPUT_CLASS } from '@/features/zones/zonePanelStyle';
import { isComposing } from '@/lib/imeKey';
import { Button } from '@simai/ui/components/button';
import { Input } from '@simai/ui/components/input';
import { cn } from '@simai/ui/lib/utils';
import { Pencil } from 'lucide-react';
import { useRef, useState } from 'react';

/** 구역 이름 버튼. 행 전체 폭을 쓰고(오른쪽은 연필 자리), 왼쪽 띠가 심각도 색이며, 고른 구역은 바탕이 짙어진다. */
const NAME_BUTTON_CLASS =
  'flex w-full min-w-0 items-center rounded-md border-l-[3px] py-1.5 pl-2 text-left text-[13px] outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-foreground/15 aria-pressed:font-semibold';
/** 이름 버튼 오른쪽 여백: 행 안 오른쪽에 겹친 연필 버튼을 비켜 간다. 연필을 두지 않는 행(열람 계정)은 가장자리 여백만. */
const NAME_PAD_RENAME = 'pr-8';
const NAME_PAD_PLAIN = 'pr-2';

/** 행 안 오른쪽에 겹쳐 놓고, 행에 마우스를 올리거나 포커스가 있을 때(터치 화면은 늘) 보이는 연필 버튼. */
const PENCIL_CLASS =
  'absolute top-1/2 right-0 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100';

/** 이름 입력. Enter 나 포커스를 잃으면 저장하고 Escape 는 저장하지 않고 닫는다. 저장하지 못했으면 입력을 그대로 둔다. */
function NameEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  // Enter·Escape 뒤 입력이 닫히면서 포커스를 잃는 일(blur)이 한 번 더 와도 저장·취소를 다시 하지 않는다.
  const settled = useRef(false);

  const save = async () => {
    if (settled.current) return;
    settled.current = true;
    if (!(await onSave(value))) settled.current = false;
  };
  const cancel = () => {
    settled.current = true;
    onCancel();
  };

  return (
    <Input
      aria-label="구역 이름"
      autoFocus
      value={value}
      maxLength={NAME_INPUT_MAX}
      readOnly={busy}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (isComposing(event.nativeEvent)) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          void save();
        } else if (event.key === 'Escape') {
          // 입력을 닫는 Esc 가 이벤트 상세 닫기 같은 다른 Esc 처리기까지 가지 않게 한다.
          event.stopPropagation();
          cancel();
        }
      }}
      className={INPUT_CLASS}
    />
  );
}

/**
 * 구역 목록의 한 행: 구역을 고르는 버튼과(관리자만) 이름을 그 자리에서 고치는 연필. onRename 이 true 를 돌려주면(저장했거나
 * 바뀐 것이 없으면) 입력을 닫는다.
 */
export function ZoneListRow({
  zone,
  selected,
  canRename,
  busy,
  onOpen,
  onRename,
  onClearNotice,
}: {
  zone: Zone;
  selected: boolean;
  canRename: boolean;
  busy: boolean;
  onOpen: () => void;
  onRename: (zone: Zone, name: string) => Promise<boolean>;
  onClearNotice: () => void;
}) {
  const [editing, setEditing] = useState(false);

  const startEdit = () => {
    onClearNotice();
    setEditing(true);
  };
  const cancelEdit = () => {
    onClearNotice();
    setEditing(false);
  };
  const save = async (name: string) => {
    const closed = await onRename(zone, name);
    if (closed) setEditing(false);
    return closed;
  };

  return (
    <li className="group/row relative">
      {editing ? (
        <NameEditor initial={zone.name} busy={busy} onSave={save} onCancel={cancelEdit} />
      ) : (
        <>
          <button
            type="button"
            aria-pressed={selected}
            onClick={onOpen}
            className={cn(
              NAME_BUTTON_CLASS,
              canRename ? NAME_PAD_RENAME : NAME_PAD_PLAIN,
              ALARM_BORDER[zone.severity],
            )}
          >
            <span className="sr-only">{`${SEVERITY_LABEL[zone.severity]} `}</span>
            <span className="truncate">{zoneDisplayName(zone.name)}</span>
          </button>
          {canRename && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${zoneDisplayName(zone.name)} 이름 고치기`}
              onClick={startEdit}
              className={PENCIL_CLASS}
            >
              <Pencil />
            </Button>
          )}
        </>
      )}
    </li>
  );
}
