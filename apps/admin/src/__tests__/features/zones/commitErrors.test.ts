import { CommitBlockedError, commitErrorText } from '@/features/zones/commitErrors';
import { ApiError } from '@/lib/http';
import { describe, expect, it } from 'vitest';

const ZONE_CHANGED =
  '그 사이 다른 버전이 저장되어 최신 구역을 다시 받았습니다. 확인한 뒤 다시 저장하세요.';
const SURFACE_CHANGED =
  '그 사이 다른 버전이 저장되어 최신 작업면을 다시 받았습니다. 확인한 뒤 다시 저장하세요.';
const OUTCOME_UNKNOWN =
  '저장됐는지 확인하지 못해 최신 구역을 다시 받았습니다. 확인한 뒤 다시 시도하세요.';
const FALLBACK = '저장하지 못했습니다. 다시 시도하세요.';
const FORBIDDEN = '구역을 저장할 권한이 없습니다.';
const POLYGON = '바닥 다각형이 꼬였거나 넓이가 없어 저장하지 못했습니다.';

describe('commitErrorText: 서버 오류 이름(code)을 먼저 본다', () => {
  it.each([
    [400, 'INVALID_POLYGON', POLYGON],
    [400, 'INVALID_Z_RANGE', '높이 범위가 맞지 않아 저장하지 못했습니다(최저 < 최고).'],
    [400, 'INVALID_STATIC_OBJECT', '작업면 값이 올바르지 않아 저장하지 못했습니다.'],
    [400, 'INVALID_SURFACE_ZONE', '작업면만 구역에 이을 수 있습니다.'],
    [400, 'INVALID_ZONE_COMMIT', '저장 요청이 올바르지 않습니다.'],
    [409, 'CONCURRENT_EDIT', ZONE_CHANGED],
    [
      409,
      'SURFACE_ZONE_TAKEN',
      '이 구역에 이미 다른 작업면이 이어져 있거나 작업면이 다른 구역에 이어져 있습니다. 새로 받은 값을 확인하세요.',
    ],
    [404, 'ZONE_NOT_FOUND', '이미 없거나 보관된 구역입니다. 목록을 다시 받았습니다.'],
    [404, 'STATIC_OBJECT_NOT_FOUND', '이미 없거나 보관된 작업면입니다. 목록을 다시 받았습니다.'],
    [409, 'SITE_NOT_SINGLE', '현장이 하나로 정해지지 않아 저장할 수 없습니다.'],
  ])('%i %s 는 그 이름의 문구다', (status, code, text) => {
    expect(commitErrorText(new ApiError(status, { code }))).toBe(text);
  });

  it('같은 409 라도 이름이 다르면 문구가 다르고, 이름이 없거나 모르는 409·404 는 일반 문구다', () => {
    const taken = commitErrorText(new ApiError(409, { code: 'SURFACE_ZONE_TAKEN' }));
    const concurrent = commitErrorText(new ApiError(409, { code: 'CONCURRENT_EDIT' }));
    expect(taken).not.toBe(concurrent);
    for (const status of [409, 404]) {
      expect(commitErrorText(new ApiError(status))).toBe(FALLBACK);
      expect(commitErrorText(new ApiError(status, { code: 'SOMETHING_NEW' }))).toBe(FALLBACK);
    }
  });

  it('이름이 상태보다 먼저다(403 이어도 아는 이름이면 그 문구)', () => {
    expect(commitErrorText(new ApiError(403, { code: 'INVALID_POLYGON' }))).toBe(POLYGON);
  });

  it('서버가 자체 문구를 줘도 보이지 않는다', () => {
    const error = new ApiError(400, { code: 'UNKNOWN_CODE', serverMessage: '내부 SQL 오류 …' });
    expect(commitErrorText(error)).toBe(FALLBACK);
  });
});

describe('commitErrorText: 이름이 없거나 모를 때', () => {
  it('403 은 권한 문구다(이름이 없어도, 모르는 이름이어도)', () => {
    expect(commitErrorText(new ApiError(403))).toBe(FORBIDDEN);
    expect(commitErrorText(new ApiError(403, { code: 'FORBIDDEN' }))).toBe(FORBIDDEN);
  });

  it.each([
    ['NETWORK', 0],
    ['TIMEOUT', 0],
    ['INVALID_RESPONSE', 200],
  ] as const)('%s 는 저장됐는지 모른다고 알린다', (kind, status) => {
    expect(commitErrorText(new ApiError(status, { kind }))).toBe(OUTCOME_UNKNOWN);
  });

  it('그 밖의 오류 상태는 일반 문구다(서버 오류·로그인 만료 포함)', () => {
    for (const status of [400, 401, 500, 503]) {
      expect(commitErrorText(new ApiError(status))).toBe(FALLBACK);
    }
  });

  it('ApiError 가 아닌 오류도 일반 문구다', () => {
    for (const error of [new Error('boom'), new TypeError('x'), 'text', 42, null, undefined]) {
      expect(commitErrorText(error)).toBe(FALLBACK);
    }
  });
});

describe('CommitBlockedError', () => {
  it.each([
    ['zone', 'CHANGED', ZONE_CHANGED],
    ['zone', 'UNCHECKED', '최신 구역을 확인하지 못해 저장하지 않았습니다. 다시 시도하세요.'],
    ['surface', 'CHANGED', SURFACE_CHANGED],
    ['surface', 'UNCHECKED', '최신 작업면을 확인하지 못해 저장하지 않았습니다. 다시 시도하세요.'],
  ] as const)('%s %s 는 대상·이유별 문구다', (target, reason, text) => {
    expect(commitErrorText(new CommitBlockedError(target, reason))).toBe(text);
  });

  it('대상·이유·원인을 담고 Error 다', () => {
    const cause = new ApiError(0, { kind: 'NETWORK' });
    const error = new CommitBlockedError('surface', 'UNCHECKED', { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'CommitBlockedError',
      target: 'surface',
      reason: 'UNCHECKED',
    });
    expect(error.cause).toBe(cause);
  });
});
