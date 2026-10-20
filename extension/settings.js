export const TITLE_CLEANUP_KEY = 'settings:auto-clean-title';
export const READY_FIRST_KEY = 'settings:ready-first';

export async function loadReadyFirst() {
  return (await chrome.storage.local.get(READY_FIRST_KEY))[READY_FIRST_KEY] === true;
}

export async function loadTitleCleanup() {
  return (await chrome.storage.local.get(TITLE_CLEANUP_KEY))[TITLE_CLEANUP_KEY] === true;
}

// Preserve ordinary bracketed text; only remove bracketed faces with both
// recognizable eyes and a mouth, plus emoji (including joined sequences).
export function cleanTitle(title) {
  return title
    .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/gu, '')
    .replace(/[\u200D\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu, '')
    .replace(/[（(][^()（）\n]{1,32}[)）]/gu, face =>
      !/[\p{Script=Han}]|[A-Za-z]{2,}/u.test(face) && /[°ಠಥ^＾;；•￣≧≦ＴTツ눈╥˘´`]/u.test(face) && /[ω▽∀Дд益_﹏皿ヘ︿ロ⌣ᴗoＯo口]/u.test(face) ? '' : face)
    .replace(/(?<![\p{L}\p{N}])[:;=][-^']?[)DPp]/gu, '')
    .replace(/\s+/gu, ' ').trim();
}
