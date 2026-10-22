
// Passive invalidation only: never reads pixels or requests image URLs.
(() => {
  if (globalThis.__imageTakenBadgeObserver) {
    globalThis.__imageTakenBadgeObserver.notify();
    return;
  }
  let timer: number | undefined, resources: PerformanceObserver, stopped = false;
  const observers: MutationObserver[] = [];
  const roots = new WeakSet<Node>();
  const notify = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
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
  function observe(root: Document | ShadowRoot) {
    if (roots.has(root)) return;
    roots.add(root);
    const discover = (node: Node) => {
      if (globalThis.__imageTakenHighlights?.owns(node)) return;
      if (node instanceof Element && node.shadowRoot) observe(node.shadowRoot);
      for (const child of (node instanceof Element || node instanceof Document || node instanceof ShadowRoot) ? node.querySelectorAll('*') : []) if (child.shadowRoot) observe(child.shadowRoot);
    };
    const observer = new MutationObserver(changes => {
      let realChange = false;
      for (const change of changes) {
        if (globalThis.__imageTakenHighlights?.owns(change.target)) continue;
        const nodes = [...change.addedNodes, ...change.removedNodes];
        if (change.type === 'childList' && nodes.length && nodes.every(node => globalThis.__imageTakenHighlights?.owns(node))) continue;
        realChange = true;
        for (const node of change.addedNodes) discover(node);
      }
      if (realChange) notify();
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
      if (list.getEntries().some(entry => entry instanceof PerformanceResourceTiming && ['img', 'css', 'image'].includes(entry.initiatorType))) notify();
    });
    resources.observe({ type: 'resource', buffered: true });
  } catch { /* DOM load events still cover ordinary image updates. */ }
  window.addEventListener('pageshow', notify);
  notify();
})();
