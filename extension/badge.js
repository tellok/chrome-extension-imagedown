import { t } from './i18n.js';
// Only the filtered background page snapshot determines the toolbar count.
export function imageBadge(items, total) {
  const ready = items.filter(item => item.previewStatus === 'ready' && !item.previewPending).length;
  const failed = items.filter(item => item.previewStatus === 'error' && !item.previewPending).length;
  return {
    text: ready > 999 ? '999+' : String(ready),
    title: t(`ImageTaken · 成功加载 {0} 张\n当前筛选识别 {1} 张 · 预览失败 {2} 张\n页面共识别 {3} 张 · 点击打开图片库`, ready, items.length, failed, total),
  };
}

export function createBadgeBinding(snapshot) {
  let timer, port, last = '';
  return function reportBadge() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const { sourceTabId, panelTabId } = snapshot();
      const binding = { sourceTabId: sourceTabId ?? null, panelTabId: panelTabId ?? null };
      const fingerprint = JSON.stringify(binding);
      if (fingerprint === last) return;
      last = fingerprint;
      try {
        if (!port) {
          port = chrome.runtime.connect({ name: 'panel-image-badge' });
          port.onDisconnect.addListener(() => { port = null; last = ''; reportBadge(); });
        }
        port.postMessage(binding);
      } catch { port = null; last = ''; }
    }, 80);
  };
}
