import type { MenuKey } from '@/features/viewer3d/dev-harness/mockUi';
import { MENUS } from '@/features/viewer3d/dev-harness/mockUi';
import { Activity, FileText, LayoutGrid, Monitor, Video, type LucideIcon } from 'lucide-react';

const ICONS: Record<MenuKey, LucideIcon> = {
  monitor: Monitor,
  cctv: Video,
  zones: LayoutGrid,
  tbm: FileText,
  system: Activity,
};

interface MockNavProps {
  menu: MenuKey;
  open: boolean;
  onSelect: (menu: MenuKey) => void;
}

/** FE Dock 과 같은 모양의 하단 메뉴. 누르면 오버레이만 바뀐다. */
export function MockNav({ menu, open, onSelect }: MockNavProps) {
  return (
    <nav aria-label="주 메뉴" className="smk-nav smk-float">
      {MENUS.map(({ key, label }) => {
        const Icon = ICONS[key];
        return (
          <button
            key={key}
            type="button"
            aria-pressed={key === menu && open}
            data-menu={key}
            onClick={() => onSelect(key)}
            className="smk-nav-item"
          >
            <Icon />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
