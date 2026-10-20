import { t } from './i18n.js';
import { cleanTitle } from './settings.js';

export function bindTitleEditor(container, { onChange }) {
  const display = container.querySelector('#title-display');
  const text = container.querySelector('#page-title');
  const form = container.querySelector('form');
  const input = container.querySelector('textarea');
  const cancel = container.querySelector('#cancel-title');
  let page = '', original = t('未命名页面'), value = original, customized = false, editing = false;
  let rawTitle = original, autoClean = false;

  function render() {
    text.textContent = value;
    display.title = t(`{0}\n点击编辑下载文件夹标题`, value);
    display.hidden = editing;
    form.hidden = !editing;
    onChange(value);
  }
  function finish(adopt) {
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
  form.addEventListener('submit', event => { event.preventDefault(); finish(true); display.focus(); });
  cancel.addEventListener('click', () => { finish(false); display.focus(); });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); finish(false); display.focus(); }
    else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(true); display.focus(); }
  });
  container.ownerDocument.addEventListener('pointerdown', event => {
    if (editing && !container.contains(event.target)) finish(true);
  }, true);
  container.addEventListener('focusout', event => {
    if (editing && event.relatedTarget && !container.contains(event.relatedTarget)) finish(true);
  });
  return {
    get value() { return value; },
    localize() { display.title = t(`{0}\n点击编辑下载文件夹标题`, value); },
    commit() { finish(true); },
    setPage(tab) {
      const key = `${tab.id}:${tab.url}`;
      const changed = key !== page;
      page = key;
      rawTitle = tab.title?.trim() || t('未命名页面');
      original = (autoClean ? cleanTitle(rawTitle) : rawTitle) || t('未命名页面');
      if (changed || !customized) { value = original; customized = false; }
      editing = false;
      render();
    },
    setCleanup(enabled) {
      autoClean = enabled;
      original = (autoClean ? cleanTitle(rawTitle) : rawTitle) || t('未命名页面');
      if (!customized && !editing) { value = original; render(); }
    },
    setDisabled(disabled) {
      for (const control of container.querySelectorAll('button,textarea')) control.disabled = disabled;
    },
  };
}
