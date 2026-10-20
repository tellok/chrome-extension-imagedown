import { t } from './i18n.js';
export function imageBadge(items, total, scanning = false) {
  const ready = items.filter(item => item.previewStatus === 'ready' && !item.previewPending).length;
  const failed = items.filter(item => item.previewStatus === 'error' && !item.previewPending).length;
  return {
    text: scanning ? '…' : ready > 999 ? '999+' : String(ready),
    title: scanning ? t('ImageTaken · 正在扫描页面图片…') :
      t(`ImageTaken · 成功加载 {0} 张\n当前筛选识别 {1} 张 · 预览失败 {2} 张\n页面共识别 {3} 张 · 点击打开图片库`, ready, items.length, failed, total),
  };
}

export function createBadgeReporter(snapshot) {
  let timer, last = '', queue = Promise.resolve();
  return function reportBadge() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const { tabIds, items, total, scanning } = snapshot();
      if (!tabIds.length) return;
      const badge = imageBadge(items, total, scanning);
      const fingerprint = JSON.stringify({ tabIds, ...badge });
      if (fingerprint === last) return;
      last = fingerprint;
      queue = queue.then(async () => {
        await Promise.allSettled(tabIds.map(async tabId => {
          await Promise.all([
            chrome.action.setBadgeBackgroundColor({ tabId, color: '#DC2626' }),
            chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' }),
            chrome.action.setBadgeText({ tabId, text: badge.text }),
            chrome.action.setTitle({ tabId, title: badge.title }),
          ]);
        }));
      });
    }, 80);
  };
}
