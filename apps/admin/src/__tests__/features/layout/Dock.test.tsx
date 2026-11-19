import { Dock } from '@/features/layout/Dock';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    to,
    children,
    className,
    'aria-label': ariaLabel,
  }: {
    to: string;
    children?: ReactNode;
    className?: string;
    'aria-label'?: string;
  }) => (
    <a href={to} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe('Dock', () => {
  it('하단 메뉴는 작업 관리 · 실시간 관제 · CCTV 관제 순서로 셋뿐이다(히스토리는 작업 관리로 합쳤다)', () => {
    render(<Dock />);
    const nav = screen.getByRole('navigation', { name: '주 메뉴' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      '작업 관리',
      '실시간 관제',
      'CCTV 관제',
    ]);
    // 첫 화면(/)은 작업 관리라 실시간 관제는 /live 다(S15P31A101-665).
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/work', '/live', '/cctv']);
    expect(within(nav).queryByRole('link', { name: '히스토리' })).toBeNull();
  });
});
