import { buildTestH264Stream } from '@/mocks/h264TestStream';

// 개발 서버 클립 mock 이 쓰는 시험 영상. 서버가 주는 원본과 같은 H.264 Annex B 스트림을 코드로 만들어 blob 주소로 둔다.
// 영상 파일은 저장소에 두지 않는다(.gitignore 의 영상 규칙). 프레임 수마다 한 번 만들어 페이지가 열려 있는 동안 쓴다.

const made = new Map<number, string>();

/** 프레임 수가 frames 인 시험 스트림의 blob 주소(`video/h264`, Annex B). */
export function testClipVideo(frames: number): string {
  let url = made.get(frames);
  if (!url) {
    const { data } = buildTestH264Stream({ frames });
    url = URL.createObjectURL(new Blob([data], { type: 'video/h264' }));
    made.set(frames, url);
  }
  return url;
}
