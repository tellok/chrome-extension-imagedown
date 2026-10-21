// Passive invalidation only: never reads pixels or requests image URLs.
(() => {
  if (globalThis.__imageTakenBadgeObserver) {
    globalThis.__imageTakenBadgeObserver.notify();
    return;
  }
  let timer, resources, stopped = false;
  const observers = [];
  const roots = new WeakSet();
  const notify = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        chrome.runtime.sendMessage({ type: 'page-images-changed' }).catch(stop);
      } catch { stop(); }
    }, 500);
  };
  function stop() {
    stopped = true;
    clearTimeout(timer);
    for (const observer of observers) observer.disconnect();
    resources?.disconnect();
    document.removeEventListener('load', notify, true);
    document.removeEventListener('error', notify, true);
    window.removeEventListener('pageshow', notify);
  }
  function observe(root) {
    if (roots.has(root)) return;
    roots.add(root);
    const discover = node => {
      if (node.shadowRoot) observe(node.shadowRoot);
      for (const child of node.querySelectorAll?.('*') || []) if (child.shadowRoot) observe(child.shadowRoot);
    };
    const observer = new MutationObserver(changes => {
      for (const change of changes) for (const node of change.addedNodes) discover(node);
      notify();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'srcset', 'href', 'data-src', 'data-original', 'data-lazy-src', 'data-url', 'data-srcset', 'class', 'style', 'id', 'alt'] });
    observers.push(observer);
    discover(root);
    root.addEventListener('load', notify, true);
    root.addEventListener('error', notify, true);
  }
  globalThis.__imageTakenBadgeObserver = { notify };
  observe(document);
  try {
    resources = new PerformanceObserver(list => {
      if (list.getEntries().some(entry => ['img', 'css', 'image'].includes(entry.initiatorType))) notify();
    });
    resources.observe({ type: 'resource', buffered: true });
  } catch { /* DOM load events still cover ordinary image updates. */ }
  window.addEventListener('pageshow', notify);
  notify();
})();
