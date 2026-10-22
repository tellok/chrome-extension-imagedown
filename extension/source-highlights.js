// One renderer per source document, in the extension isolated world.
(() => {
  if (globalThis.__imageTakenHighlights) return;
  const sessions = new Map(), ended = new Set(), boxes = new Map(), owned = new WeakSet();
  let host, root, frame = 0, expiry;
  const owns = node => !!node && (owned.has(node) || (node.getRootNode?.() === root && !!root));
  function clearDrawing() {
    cancelAnimationFrame(frame); frame = 0;
    clearTimeout(expiry); expiry = null;
    host?.remove(); host = root = null; boxes.clear();
  }
  function ensureHost() {
    if (host?.isConnected) return;
    host?.remove(); boxes.clear();
    host = document.createElement('div'); owned.add(host);
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important;';
    root = host.attachShadow({ mode: 'closed' });
    document.documentElement.append(host);
  }
  function sweep() {
    clearTimeout(expiry);
    const now = Date.now();
    for (const [id, session] of sessions) if (session.deadline <= now) { sessions.delete(id); ended.add(id); }
    if (!sessions.size) { clearDrawing(); return; }
    expiry = setTimeout(sweep, Math.max(1, Math.min(...[...sessions.values()].map(session => session.deadline)) - now));
  }
  function paint() {
    frame = 0;
    if (![...sessions.values()].some(session => session.targets.length)) {
      host?.remove(); host = root = null; boxes.clear(); return;
    }
    const elements = new Set(), rectangles = new Map();
    for (const session of sessions.values()) for (const target of session.targets) {
      if (elements.has(target.element)) continue;
      try {
        if (!target.valid()) continue;
        const element = target.element, style = getComputedStyle(element);
        if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || style.visibility !== 'visible') continue;
        const rect = element.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) continue;
        elements.add(element); rectangles.set(element, rect);
      } catch { /* A detached or inaccessible target has no drawable position. */ }
    }
    if (rectangles.size) ensureHost();
    for (const [element, box] of boxes) if (!rectangles.has(element)) { box.remove(); boxes.delete(element); }
    for (const [element, rect] of rectangles) {
      let box = boxes.get(element);
      if (!box) { box = document.createElement('div'); owned.add(box); root.append(box); boxes.set(element, box); }
      const css = `all:initial;position:fixed;box-sizing:border-box;pointer-events:none;border:2px solid #ff0000;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
      if (box.style.cssText !== css && box.dataset.geometry !== css) { box.style.cssText = css; box.dataset.geometry = css; }
    }
    if (!rectangles.size && host) { host.remove(); host = root = null; }
    frame = requestAnimationFrame(paint);
  }
  function receive(message) {
    const { session: id, sequence, operation } = message;
    if (typeof id !== 'string' || !Number.isSafeInteger(sequence) || sequence < 0 || ended.has(id)) return false;
    const previous = sessions.get(id);
    if (previous && sequence < previous.sequence) return false;
    if (operation === 'release') { sessions.delete(id); ended.add(id); sweep(); return true; }
    if (operation === 'renew') {
      if (!previous || previous.deadline <= Date.now() || sequence !== previous.sequence) return false;
      previous.deadline = Date.now() + 15000; sweep(); return true;
    }
    if (operation !== 'update' || !Array.isArray(message.ids) || (previous && sequence <= previous.sequence)) return false;
    const targets = globalThis.__imageTaken?.targets(message.ids) || [];
    sessions.set(id, { sequence, targets, deadline: Date.now() + 15000 });
    sweep(); if (!frame) paint(); return true;
  }
  function reset() { for (const id of sessions.keys()) ended.add(id); sessions.clear(); clearDrawing(); }
  globalThis.__imageTakenHighlights = { receive, owns, snapshot: () => ({
    sessions: sessions.size, active: !!frame, host: !!host?.isConnected,
    rectangles: [...boxes.values()].map(box => {
      const r = box.getBoundingClientRect(), s = getComputedStyle(box);
      return { x: r.x, y: r.y, width: r.width, height: r.height, border: s.borderTopWidth, color: s.borderTopColor, pointerEvents: s.pointerEvents };
    }),
  }) };
  window.addEventListener('pagehide', reset);
})();
