/** 입력기(한글 등)가 조합 중일 때 keydown 의 keyCode. */
const IME_KEY_CODE = 229;

/** 입력기가 글자를 조합하는 중에 눌린 키인지. 이때의 Enter·Escape 는 조합을 끝내는 키라 동작으로 보지 않는다. */
export const isComposing = (event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>) =>
  event.isComposing || event.keyCode === IME_KEY_CODE;
