import { parseEnv } from '@/lib/parseEnv';
import { describe, expect, it } from 'vitest';

const valid = {
  VITE_API_BASE_URL: 'http://localhost:8080',
  VITE_STOMP_URL: 'ws://localhost:8080/ws',
};

describe('parseEnv', () => {
  it('http(s)·ws(s) 주소를 받는다', () => {
    expect(parseEnv(valid)).toEqual({
      ...valid,
      VITE_API_MOCK: false,
      VITE_API_REAL: [],
      VITE_CCTV_PREVIEW_URL: 'ws://127.0.0.1:47032',
    });
    expect(
      parseEnv({
        VITE_API_BASE_URL: 'https://simai.example',
        VITE_STOMP_URL: 'wss://simai.example/ws',
      }),
    ).toBeTruthy();
  });

  it('값이 없으면 이름을 담아 멈춘다', () => {
    expect(() => parseEnv({ VITE_API_BASE_URL: valid.VITE_API_BASE_URL })).toThrow(
      /VITE_STOMP_URL/,
    );
  });

  it('스킴이 틀리면 멈춘다', () => {
    expect(() => parseEnv({ ...valid, VITE_STOMP_URL: 'http://localhost:8080/ws' })).toThrow(
      /ws\(s\) 주소/,
    );
    expect(() => parseEnv({ ...valid, VITE_API_BASE_URL: 'localhost:8080' })).toThrow(
      /VITE_API_BASE_URL/,
    );
  });

  it('API mock 여부는 true·false 만 받고 없으면 끈다', () => {
    expect(parseEnv({ ...valid, VITE_API_MOCK: 'true' }).VITE_API_MOCK).toBe(true);
    expect(parseEnv({ ...valid, VITE_API_MOCK: 'false' }).VITE_API_MOCK).toBe(false);
    expect(parseEnv(valid).VITE_API_MOCK).toBe(false);
    for (const value of ['yes please', '1', 'on', 'TRUE']) {
      expect(() => parseEnv({ ...valid, VITE_API_MOCK: value })).toThrow(/VITE_API_MOCK/);
    }
  });

  it('API 주소를 비우면 같은 출처로 부른다(운영 빌드도 받는다)', () => {
    const sameOrigin = { ...valid, VITE_API_BASE_URL: '' };
    expect(parseEnv(sameOrigin).VITE_API_BASE_URL).toBe('');
    expect(
      parseEnv(
        { VITE_API_BASE_URL: '', VITE_STOMP_URL: 'wss://simai.example/ws' },
        { production: true },
      ).VITE_API_BASE_URL,
    ).toBe('');
    expect(() => parseEnv({ VITE_STOMP_URL: valid.VITE_STOMP_URL })).toThrow(/VITE_API_BASE_URL/);
  });

  it('CCTV 미리보기 주소는 같은 노트북의 ws 주소만 받고 비우면 기본 포트다', () => {
    expect(parseEnv({ ...valid, VITE_CCTV_PREVIEW_URL: '' }).VITE_CCTV_PREVIEW_URL).toBe(
      'ws://127.0.0.1:47032',
    );
    expect(
      parseEnv({ ...valid, VITE_CCTV_PREVIEW_URL: 'ws://localhost:47100' }).VITE_CCTV_PREVIEW_URL,
    ).toBe('ws://localhost:47100');
    // 운영 빌드(https 화면)에서도 루프백 ws 는 받는다(영상은 노트북 밖으로 나가지 않는다)
    expect(
      parseEnv(
        { ...valid, VITE_API_BASE_URL: '', VITE_STOMP_URL: 'wss://simai.example/ws' },
        { production: true },
      ).VITE_CCTV_PREVIEW_URL,
    ).toBe('ws://127.0.0.1:47032');
    for (const value of [
      'ws://192.168.0.10:47032',
      'ws://simai.live:47032',
      'http://127.0.0.1:47032',
    ]) {
      expect(() => parseEnv({ ...valid, VITE_CCTV_PREVIEW_URL: value })).toThrow(
        /VITE_CCTV_PREVIEW_URL/,
      );
    }
  });

  it('실서버 경로는 /api/… 를 쉼표로 나눠 받고 없으면 비운다', () => {
    expect(parseEnv(valid).VITE_API_REAL).toEqual([]);
    expect(parseEnv({ ...valid, VITE_API_REAL: '' }).VITE_API_REAL).toEqual([]);
    expect(parseEnv({ ...valid, VITE_API_REAL: '/api/auth' }).VITE_API_REAL).toEqual(['/api/auth']);
    expect(
      parseEnv({ ...valid, VITE_API_REAL: ' /api/auth , /api/events,' }).VITE_API_REAL,
    ).toEqual(['/api/auth', '/api/events']);
    for (const value of [
      'api/auth',
      '/auth',
      '/api/',
      '/api/auth/',
      '/api/*',
      'http://x/api/auth',
    ]) {
      expect(() => parseEnv({ ...valid, VITE_API_REAL: value })).toThrow(/VITE_API_REAL/);
    }
  });

  it('API 주소에 ? 나 # 가 있으면 멈춘다(뒤에 붙는 /api/… 가 쿼리로 들어간다)', () => {
    for (const value of ['http://localhost:8080?x=1', 'http://localhost:8080/?', 'http://h/#a']) {
      expect(() => parseEnv({ ...valid, VITE_API_BASE_URL: value })).toThrow(
        /VITE_API_BASE_URL: \? 나 #/,
      );
    }
  });

  it('운영 빌드에서 원격 주소는 https·wss 만 받는다', () => {
    const remote = {
      VITE_API_BASE_URL: 'http://simai.example',
      VITE_STOMP_URL: 'ws://simai.example/ws',
    };
    expect(() => parseEnv(remote, { production: true })).toThrow(/VITE_API_BASE_URL: 운영 빌드/);
    expect(() => parseEnv(remote, { production: true })).toThrow(/VITE_STOMP_URL: 운영 빌드/);
    expect(parseEnv(remote)).toBeTruthy();
    expect(
      parseEnv(
        { VITE_API_BASE_URL: 'https://simai.example', VITE_STOMP_URL: 'wss://simai.example/ws' },
        { production: true },
      ),
    ).toBeTruthy();
  });

  it('운영 빌드라도 내 PC(localhost)는 http·ws 를 받는다', () => {
    expect(parseEnv(valid, { production: true })).toBeTruthy();
    expect(
      parseEnv(
        { VITE_API_BASE_URL: 'http://127.0.0.1:8080', VITE_STOMP_URL: 'ws://[::1]:8080/ws' },
        { production: true },
      ),
    ).toBeTruthy();
  });
});
