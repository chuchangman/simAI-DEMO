import { loginErrorMessage } from '@/features/auth/loginErrorMessage';
import { ApiError, NETWORK_ERROR } from '@/lib/http';
import { describe, expect, it } from 'vitest';

describe('loginErrorMessage', () => {
  it('401 은 아이디·비밀번호 불일치로 알린다(서버 문구보다 앞선다)', () => {
    expect(loginErrorMessage(new ApiError(401, { serverMessage: 'Bad credentials' }))).toBe(
      '아이디 또는 비밀번호가 맞지 않습니다',
    );
  });

  it('연결 실패·시간 초과는 서버 연결 문구다', () => {
    expect(loginErrorMessage(new ApiError(NETWORK_ERROR))).toBe('서버에 연결할 수 없습니다');
    expect(loginErrorMessage(new ApiError(NETWORK_ERROR, { kind: 'TIMEOUT' }))).toBe(
      '서버에 연결할 수 없습니다',
    );
  });

  it('그 밖의 4xx 는 서버 문구, 5xx·문구 없음·형식이 틀린 응답은 기본 문구다', () => {
    expect(loginErrorMessage(new ApiError(423, { serverMessage: '계정이 잠겼습니다' }))).toBe(
      '계정이 잠겼습니다',
    );
    expect(
      loginErrorMessage(new ApiError(500, { serverMessage: 'NullPointerException at …' })),
    ).toBe('로그인하지 못했습니다');
    expect(loginErrorMessage(new ApiError(500))).toBe('로그인하지 못했습니다');
    expect(loginErrorMessage(new ApiError(200, { kind: 'INVALID_RESPONSE' }))).toBe(
      '로그인하지 못했습니다',
    );
    expect(loginErrorMessage(new Error('boom'))).toBe('로그인하지 못했습니다');
  });
});
