import { element } from "./guards.js";
import { t } from './i18n.js';
import { cleanTitle } from './settings.js';

export function bindTitleEditor(container: HTMLElement, { onChange }: { onChange: (value: string) => void }) {
  const display = element(container.querySelector('#title-display'), HTMLElement);
  const text = element(container.querySelector('#page-title'), HTMLElement);
  const form = element(container.querySelector('form'), HTMLFormElement);
  const input = element(container.querySelector('textarea'), HTMLTextAreaElement);
  const cancel = element(container.querySelector('#cancel-title'), HTMLButtonElement);
  let page = '', original = t('未命名页面'), value = original, customized = false, editing = false;
  let rawTitle = original, autoClean = false;

  function render() {
    text.textContent = value;
    display.title = t(`{0}\n点击编辑下载文件夹标题`, value);
    display.hidden = editing;
    form.hidden = !editing;
    onChange(value);
  }
  function finish(adopt: boolean) {
    if (!editing) return;
    if (adopt) {
      value = input.value.trim() || original;
      customized = value !== original;
    }
    editing = false;
    render();
  }
  display.addEventListener('click', () => {
    editing = true;
    input.value = value;
    render();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  form.addEventListener('submit', (event) => { event.preventDefault(); finish(true); display.focus(); });
  cancel.addEventListener('click', () => { finish(false); display.focus(); });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); finish(false); display.focus(); }
    else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(true); display.focus(); }
  });
  container.ownerDocument.addEventListener('pointerdown', (event) => {
    if (editing && !(event.target instanceof Node && container.contains(event.target))) finish(true);
  }, true);
  container.addEventListener('focusout', (event) => {
    if (editing && event.relatedTarget && !(event.relatedTarget instanceof Node && container.contains(event.relatedTarget))) finish(true);
  });
  return {
    get value() { return value; },
    localize() { display.title = t(`{0}\n点击编辑下载文件夹标题`, value); },
    commit() { finish(true); },
    setPage(tab: chrome.tabs.Tab) {
      const key = `${tab.id}:${tab.url}`;
      const changed = key !== page;
      page = key;
      rawTitle = tab.title?.trim() || t('未命名页面');
      original = (autoClean ? cleanTitle(rawTitle) : rawTitle) || t('未命名页面');
      if (changed || !customized) { value = original; customized = false; }
      editing = false;
      render();
    },
    setCleanup(enabled: boolean) {
      autoClean = enabled;
      original = (autoClean ? cleanTitle(rawTitle) : rawTitle) || t('未命名页面');
      if (!customized && !editing) { value = original; render(); }
    },
    setDisabled(disabled: boolean) {
      for (const control of container.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button,textarea')) control.disabled = disabled;
    },
  };
}
