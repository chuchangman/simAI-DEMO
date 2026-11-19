import {
  cropImageStyle,
  CroppedPhoto,
  opinionLabel,
  opinionLine,
  safeBox,
  ZoneOpinionBlock,
} from '@/features/setup/ZoneOpinionView';
import { zoneAiOpinionSchema, type ZoneAiOpinion } from '@/features/zones/types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// 변경 의심 구역 AI 의견 칸(S15P31A101-631): 배지·한 줄·전후 크롭 썸네일·크게 보기.

const opinion = (patch: Record<string, unknown> = {}): ZoneAiOpinion =>
  zoneAiOpinionSchema.parse({
    status: 'OPINION',
    reason: null,
    recommended_action: 'REMOVE',
    rationale: '단상 위 상자가 치워져 바닥만 남았습니다.',
    confidence: 0.7,
    camera_id: 'cam_A',
    before: { image_url: 'https://storage.test/before.jpg', crop_box_norm: [0.25, 0.5, 0.75, 1] },
    after: { image_url: 'https://storage.test/after.jpg', crop_box_norm: [0.25, 0.5, 0.75, 1] },
    image_expires_at_ms: 1,
    ...patch,
  });

const noOpinion = (reason: string, patch: Record<string, unknown> = {}) =>
  opinion({ status: 'NO_OPINION', reason, recommended_action: null, rationale: null, ...patch });

afterEach(cleanup);

describe('ZoneOpinionView', () => {
  it('배지 글과 한 줄: 권고·의견 없음 사유·대기 중', () => {
    expect(opinionLabel(opinion())).toBe('삭제 권고');
    expect(opinionLabel(opinion({ recommended_action: 'KEEP' }))).toBe('유지 권고');
    expect(opinionLabel(opinion({ recommended_action: 'MODIFY' }))).toBe('수정 권고');
    expect(opinionLabel(noOpinion('NOT_VISIBLE'))).toBe('AI 의견 없음');
    expect(opinionLine(noOpinion('NOT_VISIBLE'))).toContain('카메라가 없습니다');
    expect(opinionLine(noOpinion('SOMETHING_NEW'))).toBeNull();
    expect(opinionLabel(opinion({ status: 'PENDING' }))).toBe('AI 의견 준비 중');
    // 계약 밖 권고 값은 버린다(의견 없음처럼 보인다)
    expect(
      zoneAiOpinionSchema.parse({ status: 'OPINION', recommended_action: 'DELETE' })
        .recommended_action,
    ).toBeNull();
  });

  it('크롭 박스: 0~1 밖·뒤집힌 박스는 사진 전체, 스타일은 크롭이 틀을 채우게 키운다', () => {
    expect(safeBox(null)).toEqual([0, 0, 1, 1]);
    expect(safeBox([0.5, 0.1, 0.4, 0.9])).toEqual([0, 0, 1, 1]);
    expect(safeBox([0, 0, 1.2, 1])).toEqual([0, 0, 1, 1]);
    expect(cropImageStyle([0.25, 0.5, 0.75, 1])).toEqual({
      width: '200%',
      height: '200%',
      left: '-50%',
      top: '-100%',
    });
  });

  it('사진 주소가 없으면 사진 없음을 보인다', () => {
    render(<CroppedPhoto photo={{ image_url: null, crop_box_norm: null }} alt="이전" />);
    expect(screen.getByText('사진 없음')).toBeTruthy();
  });

  it('의견 칸: 배지·한 줄·전후 썸네일, 누르면 크게 보기 창이 열리고 닫힌다', () => {
    render(
      <ZoneOpinionBlock zoneName="중앙 단상" opinion={opinion()} cameraIds={['cam_A', 'cam_B']} />,
    );
    expect(screen.getByText('삭제 권고')).toBeTruthy();
    expect(screen.getByText('단상 위 상자가 치워져 바닥만 남았습니다.')).toBeTruthy();
    const before = screen.getByAltText('이전 세팅 · 카메라 1') as HTMLImageElement;
    expect(before.src).toBe('https://storage.test/before.jpg');
    expect(before.style.left).toBe('-50%');
    expect((screen.getByAltText('이번 세팅 · 카메라 1') as HTMLImageElement).src).toBe(
      'https://storage.test/after.jpg',
    );

    fireEvent.click(screen.getByRole('button', { name: '중앙 단상 전후 사진 크게 보기' }));
    const dialog = screen.getByRole('dialog', { name: '중앙 단상 전후 사진' });
    expect(within(dialog).getAllByRole('img')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('의견 없음이어도 사진이 있으면 전후 사진은 보이고, 사진이 없으면 썸네일 단추가 없다', () => {
    const { unmount } = render(
      <ZoneOpinionBlock zoneName="개구부" opinion={noOpinion('VLM_FAILED')} />,
    );
    expect(screen.getByText('AI 의견 없음')).toBeTruthy();
    expect(screen.getByText('AI 응답을 받지 못했습니다')).toBeTruthy();
    expect(screen.getByRole('button', { name: '개구부 전후 사진 크게 보기' })).toBeTruthy();
    unmount();
    render(
      <ZoneOpinionBlock
        zoneName="개구부"
        opinion={noOpinion('NO_PREVIOUS_FRAMES', { camera_id: null, before: null, after: null })}
      />,
    );
    expect(screen.queryByRole('button', { name: /크게 보기/ })).toBeNull();
    expect(screen.getByText('이전 세팅 사진이 없습니다')).toBeTruthy();
  });
});
