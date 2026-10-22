
// Keep selection gestures independent of preview loading and card actions.
export function bindGallerySelection(gallery: HTMLElement, { selected, disabled, onChange }: { selected: Set<string>; disabled: () => boolean; onChange: () => void }) {
  const doc = gallery.ownerDocument;
  const win = doc.defaultView || window; if (!win) throw new Error('Missing window');
  const controls = 'button, input, label, a, select, textarea';
  const selectable = (card: HTMLElement) => card.dataset.previewFailed !== 'true';
  let gesture: Gesture | null = null;
  let frame = 0;
  let suppressClick = false;
  const box = doc.createElement('div');
  box.className = 'selection-box';
  box.hidden = true;
  box.setAttribute('aria-hidden', 'true');
  doc.body.append(box);

  function sync() {
    for (const card of gallery.querySelectorAll<HTMLElement>('.card')) {
      if (!selectable(card)) selected.delete(card.dataset.key || '');
      const checked = selected.has(card.dataset.key || '');
      card.classList.toggle('selected', checked);
      const input = card.querySelector('input'); if (input) input.checked = checked;
    }
    onChange();
  }

  function paint() {
    if (!gesture?.active) return;
    const { startX, startY, x, y, initial, toggle } = gesture;
    const endX = x + win.scrollX, endY = y + win.scrollY;
    const left = Math.min(startX, endX), top = Math.min(startY, endY);
    const right = Math.max(startX, endX), bottom = Math.max(startY, endY);
    Object.assign(box.style, {
      left: `${left - win.scrollX}px`, top: `${top - win.scrollY}px`,
      width: `${right - left}px`, height: `${bottom - top}px`,
    });
    let changed = false;
    for (const card of gallery.querySelectorAll<HTMLElement>('.card')) {
      const rect = card.getBoundingClientRect();
      const hit = rect.right + win.scrollX > left && rect.left + win.scrollX < right &&
        rect.bottom + win.scrollY > top && rect.top + win.scrollY < bottom;
      const key = card.dataset.key || '';
      const checked = selectable(card) && (hit ? (toggle ? !initial.has(key) : true) : initial.has(key));
      if (checked !== selected.has(key)) {
        if (checked) selected.add(key); else selected.delete(key);
        changed = true;
      }
    }
    if (changed) sync();
  }

  function autoScroll() {
    if (!gesture?.active) return;
    const footerTop = doc.querySelector('footer')?.getBoundingClientRect().top ?? win.innerHeight;
    const bottom = Math.min(win.innerHeight, footerTop);
    const speed = gesture.y < 40 ? -Math.min(18, (40 - gesture.y) / 2) :
      gesture.y > bottom - 40 ? Math.min(18, (gesture.y - bottom + 40) / 2) : 0;
    if (speed) {
      const before = win.scrollY;
      win.scrollBy(0, speed);
      if (win.scrollY !== before) paint();
    }
    frame = win.requestAnimationFrame(autoScroll);
  }

  function finish(restore = false) {
    if (!gesture) return;
    const previous = gesture;
    gesture = null;
    win.cancelAnimationFrame(frame);
    box.hidden = true;
    gallery.classList.remove('selecting');
    if (gallery.hasPointerCapture(previous.id)) gallery.releasePointerCapture(previous.id);
    if (previous.active) {
      // Pointer capture retargets the following click to the gallery.
      suppressClick = true;
      if (restore) {
        selected.clear();
        for (const key of previous.initial) selected.add(key);
        sync();
      }
    }
  }

  gallery.addEventListener('click', (event) => {
    if (suppressClick && event.detail > 0) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (disabled() || (event.target instanceof Element ? event.target : gallery).closest(controls)) return;
    const card = (event.target instanceof Element ? event.target : gallery).closest<HTMLElement>('.card');
    if (!card || !selectable(card)) return;
    const key = card.dataset.key || '';
    if (selected.has(key)) selected.delete(key); else selected.add(key);
    sync();
  }, true);

  gallery.addEventListener('pointerdown', (event) => {
    suppressClick = false;
    if (gesture || event.button !== 0 || event.pointerType !== 'mouse' || disabled() || (event.target instanceof Element ? event.target : gallery).closest(controls)) return;
    gesture = {
      id: event.pointerId, startX: event.clientX + win.scrollX, startY: event.clientY + win.scrollY,
      x: event.clientX, y: event.clientY, initial: new Set(selected),
      toggle: event.ctrlKey || event.metaKey, active: false,
    };
  });
  win.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (disabled()) { finish(); return; }
    gesture.x = event.clientX; gesture.y = event.clientY;
    if (!gesture.active) {
      if (Math.hypot(event.clientX + win.scrollX - gesture.startX, event.clientY + win.scrollY - gesture.startY) < 5) return;
      gesture.active = true;
      gallery.setPointerCapture(gesture.id);
      gallery.classList.add('selecting');
      box.hidden = false;
      frame = win.requestAnimationFrame(autoScroll);
    }
    event.preventDefault();
    paint();
  }, { passive: false });
  win.addEventListener('pointerup', (event) => {
    if (gesture?.id !== event.pointerId) return;
    if (gesture.active) { gesture.x = event.clientX; gesture.y = event.clientY; paint(); }
    finish();
  });
  win.addEventListener('pointercancel', (event) => { if (gesture?.id === event.pointerId) finish(true); });
  gallery.addEventListener('lostpointercapture', () => finish());
  gallery.addEventListener('dragstart', (event) => event.preventDefault());
  win.addEventListener('blur', () => finish(true));
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && gesture) { event.preventDefault(); finish(true); }
  });
  // A render can replace cards while previews load or filters change.
  return () => finish();
}

interface Gesture { id: number; startX: number; startY: number; x: number; y: number; initial: Set<string>; toggle: boolean; active: boolean }
