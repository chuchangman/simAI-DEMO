import { DEV_VIEWS, devViewOf, type DevViewKey } from '@/features/viewer3d/dev-harness/devView';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';

interface DevViewSwitcherProps {
  view: DevViewKey;
  onChange: (view: DevViewKey) => void;
}

/** 오른쪽 아래의 작은 개발 보기 선택기. 어느 보기에서든 이것 하나는 남아 돌아갈 수 있게 한다. */
export function DevViewSwitcher({ view, onChange }: DevViewSwitcherProps) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const current = devViewOf(view);

  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) close();
  };

  return (
    <div className="smk-views" data-testid="dev-view-switcher" onKeyDown={handleKeyDown}>
      {open && (
        <div
          id="smk-view-list"
          role="group"
          aria-label="개발 보기 선택"
          className="smk-view-list smk-float"
        >
          {DEV_VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={item.key === view}
              data-view={item.key}
              className="smk-view-item"
              onClick={() => {
                onChange(item.key);
                close();
              }}
            >
              <span className="smk-view-name">{item.label}</span>
              <span className="smk-view-hint">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls="smk-view-list"
        className="smk-view-toggle smk-float"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="smk-view-caption">개발 보기</span>
        <span data-testid="dev-view-current">{current.label}</span>
        {open ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
      </button>
    </div>
  );
}
