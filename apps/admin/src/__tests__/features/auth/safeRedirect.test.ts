import { safeRedirect } from '@/features/auth/safeRedirect';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'http://localhost:5173';

describe('safeRedirect', () => {
  it('앱 안 경로는 그대로 돌려준다', () => {
    expect(safeRedirect('/zones', ORIGIN)).toBe('/zones');
    expect(safeRedirect('/tbm?layout=3#top', ORIGIN)).toBe('/tbm?layout=3#top');
  });

  it('비었거나 다른 사이트로 나가는 값은 / 로 바꾼다', () => {
    expect(safeRedirect(undefined, ORIGIN)).toBe('/');
    expect(safeRedirect('', ORIGIN)).toBe('/');
    expect(safeRedirect('//evil.example', ORIGIN)).toBe('/');
    expect(safeRedirect('/\\evil.example', ORIGIN)).toBe('/');
    expect(safeRedirect('https://evil.example', ORIGIN)).toBe('/');
    expect(safeRedirect('javascript:alert(1)', ORIGIN)).toBe('/');
  });

  it('브라우저가 지우는 탭·줄바꿈·제어 문자를 끼운 값도 막는다', () => {
    expect(safeRedirect('/\t/evil.example', ORIGIN)).toBe('/');
    expect(safeRedirect('/\n/evil.example', ORIGIN)).toBe('/');
    expect(safeRedirect('/\r/evil.example', ORIGIN)).toBe('/');
    expect(safeRedirect('/\0/evil.example', ORIGIN)).toBe('/');
  });

  it('점 경로를 풀면 //host 가 되는 값도 막는다', () => {
    expect(safeRedirect('/.//evil.example', ORIGIN)).toBe('/');
    expect(safeRedirect('/..//evil.example', ORIGIN)).toBe('/');
    expect(safeRedirect('/a/..//evil.example', ORIGIN)).toBe('/');
    expect(safeRedirect('/%2e//evil.example', ORIGIN)).toBe('/');
    expect(safeRedirect('/zones/../tbm', ORIGIN)).toBe('/tbm');
  });

  it('로그인 화면으로 되돌아가지 않는다', () => {
    expect(safeRedirect('/login', ORIGIN)).toBe('/');
    expect(safeRedirect('/login/', ORIGIN)).toBe('/');
    expect(safeRedirect('/login?redirect=%2F', ORIGIN)).toBe('/');
  });
});
