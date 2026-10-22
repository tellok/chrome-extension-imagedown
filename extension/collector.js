// Runs in response to panel scans or passive badge updates, in the extension's isolated world, once in each frame.
(() => {
  if (globalThis.__imageTaken) return;
  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_PIXELS = 24_000_000;
  const MAX_ITEMS = 4000;
  let records = new Map();
  const history = [];
  let revision = 0;

  function absolute(value) {
    if (!value || typeof value !== 'string') return null;
    try {
      const url = new URL(value, document.baseURI);
      return /^(https?:|blob:|data:)$/.test(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  // A data URL's internal commas are part of the URL, not srcset separators.
  function srcsetURLs(input) {
    const urls = [];
    let rest = input.trim();
    while (rest) {
      rest = rest.replace(/^[\s,]+/, '');
      const match = rest.match(/^\S+/);
      if (!match) break;
      let url = match[0];
      rest = rest.slice(url.length);
      if (url.endsWith(',')) url = url.replace(/,+$/, '');
      else {
        let depth = 0, end = rest.length;
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === '(') depth++;
          if (rest[i] === ')') depth--;
          if (rest[i] === ',' && depth === 0) { end = i + 1; break; }
        }
        rest = rest.slice(end);
      }
      if (url) urls.push(url);
    }
    return urls;
  }

  function pixels(element, thumbnail = false) {
    const width = element.naturalWidth || element.width?.baseVal?.value || element.width;
    const height = element.naturalHeight || element.height?.baseVal?.value || element.height;
    if (!width || !height || width * height > MAX_PIXELS) throw new Error('尺寸超出像素读取范围');
    const scale = thumbnail ? Math.min(1, 240 / Math.max(width, height)) : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(element, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/png'); // May throw SecurityError (tainted canvas).
    if (data === 'data:,' || data.length > MAX_BYTES * 4 / 3 + 1024) throw new Error('图片数据超过 20 MiB');
    return data;
  }

  // These references stay in the owning isolated world, never in scan messages.
  function occurrence(element, source, url) {
    const node = element;
    const target = node.matches('picture > source') ? [...node.parentElement.children].find(child => child instanceof HTMLImageElement) : node;
    if (!target) return null;
    const svgMarkup = source === 'svg' ? node.outerHTML : '';
    return { element: target, valid: () => {
      if (!node.isConnected || !target.isConnected || node.ownerDocument !== document) return false;
      if (source === 'canvas') return node.width > 0 && node.height > 0;
      if (source === 'svg') return node.outerHTML === svgMarkup;
      if (source === 'poster') return absolute(node.poster) === url;
      if (source === 'link') return absolute(node.href) === url;
      if (source === 'svg-image') return absolute(node.getAttribute('href') || node.getAttribute('xlink:href')) === url;
      if (source === 'css' || source === 'pseudo') {
        return (source === 'css' ? [null] : ['::before', '::after']).some(pseudo => {
          const style = getComputedStyle(node, pseudo);
          if (pseudo && ['none', 'normal'].includes(style.content)) return false;
          return ['backgroundImage', 'listStyleImage', 'maskImage', 'borderImageSource', 'content'].some(property =>
            [...style[property].matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)]
              .some(match => absolute(match[1] || match[2] || match[3]) === url));
        });
      }
      if (node.matches('picture > source') && node.parentElement !== target.parentElement) return false;
      const values = [node.currentSrc, node.getAttribute('src'), ...['data-src', 'data-original', 'data-lazy-src', 'data-url'].map(key => node.getAttribute(key)),
        ...['srcset', 'data-srcset'].flatMap(key => srcsetURLs(node.getAttribute(key) || ''))];
      return values.some(value => absolute(value) === url);
    } };
  }

  function scan(xpath = '', excludedSelectors = '', passive = false) {
    const selectors = excludedSelectors.split('\n').map(value => value.trim()).filter(Boolean);
    try { for (const selector of selectors) document.querySelector(selector); }
    catch { return { error: 'CSS 排除选择器无效：请检查每行的选择器语法' }; }
    const excluded = element => selectors.some(selector => element.matches(selector) || element.closest(selector));
    let roots = [document];
    if (xpath) {
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        roots = [];
        for (let i = 0; i < result.snapshotLength; i++) {
          const node = result.snapshotItem(i);
          if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) {
            return { error: 'XPath 必须匹配 DOM 元素或文档节点' };
          }
          roots.push(node);
        }
      } catch { return { error: 'XPath 无效：请粘贴 DevTools 复制的 XPath（不是 $x(...) 命令）' }; }
    }
    const matchedRoots = roots.length;
    // Collapse overlapping matches so nested SVG/Canvas nodes are collected once.
    roots = roots.filter((node, i) => !roots.some((parent, j) => j !== i && parent.contains(node)));
    const visited = new Set();
    if (!passive) revision++;
    const scanRecords = new Map();
    if (!passive) records = scanRecords;
    const byURL = new Map();
    let previewBytes = 0;
    let snapshotBytes = 0;
    let urlBytes = 0;
    let truncated = false;
    const collectedAt = new Date().toISOString();
    const add = (value, source, element, extra = {}) => {
      const url = absolute(value);
      if (!url) return;
      const previous = byURL.get(url);
      if (previous) {
        if (!passive && element && !previous.occurrences.some(entry => entry.node === element && entry.source === source)) {
          const match = occurrence(element, source, url);
          if (match) previous.occurrences.push({ ...match, node: element, source });
        }
        if (!previous.sources.includes(source)) previous.sources.push(source);
        if (extra.loaded && !previous.loaded) Object.assign(previous, {
          loaded: true, element, width: extra.width || 0, height: extra.height || 0, preview: extra.preview || '',
          previewIssue: extra.previewIssue || '',
        });
        if (!previous.preview && extra.preview) Object.assign(previous, { preview: extra.preview, previewIssue: '', element });
        return previous;
      }
      // Keep the per-frame serialization safely below Chrome's message limit.
      if (byURL.size >= MAX_ITEMS || urlBytes + url.length > 12 * 1024 * 1024) { truncated = true; return; }
      urlBytes += url.length;
      const id = `${revision}:${byURL.size}`;
      const rect = element?.getBoundingClientRect();
      const record = {
        id, url, sources: [source], element,
        occurrences: [],
        width: extra.width || 0, height: extra.height || 0,
        loaded: !!extra.loaded, preview: extra.preview || '', previewIssue: extra.previewIssue || '',
        bytes: extra.snapshot ? Math.max(0, Math.floor(extra.snapshot.split(',')[1].length * 3 / 4) - (extra.snapshot.endsWith('==') ? 2 : extra.snapshot.endsWith('=') ? 1 : 0)) : null,
        sizeSource: extra.snapshot ? 'Canvas PNG 快照大小' : '',
        kind: extra.kind || '', snapshot: extra.snapshot || '',
        position: rect ? Math.round(rect.top + scrollY) : Number.MAX_SAFE_INTEGER,
        alt: (element?.getAttribute('alt') || '').slice(0, 200),
        sourcePageUrl: location.href,
        originalTitle: [element?.getAttribute('title'), element?.getAttribute('alt'),
          element instanceof SVGSVGElement ? element.querySelector('title')?.textContent : ''].find(value => value?.trim()) || '',
        collectedAt,
        sourceReference: element ? `${element.localName}${element.id ? `#${element.id}` : ''}` : source,
      };
      if (!passive && element) {
        const match = occurrence(element, source, url);
        if (match) record.occurrences.push({ ...match, node: element, source });
      }
      byURL.set(url, record);
      scanRecords.set(id, record);
      return record;
    };
    const walk = (root) => {
      for (const el of [...(root.nodeType === Node.ELEMENT_NODE ? [root] : []), ...root.querySelectorAll('*')]) {
        if (visited.has(el)) continue;
        visited.add(el);
        if (globalThis.__imageTakenHighlights?.owns(el) || excluded(el)) continue;
        // A picture's sources belong to its img; excluded images must not return via srcset.
        if (el.matches('picture > source') && [...el.parentElement.children].some(child => child instanceof HTMLImageElement && excluded(child))) continue;
        if (el instanceof HTMLImageElement) {
          const current = el.currentSrc || el.src;
          const loaded = el.complete && el.naturalWidth > 0;
          let preview = '';
          let previewIssue = loaded ? 'budget' : 'not-loaded';
          if (!passive && loaded && previewBytes < 6 * 1024 * 1024) {
            try { preview = pixels(el, true); previewBytes += preview.length; previewIssue = ''; }
            catch (error) { previewIssue = error.name === 'SecurityError' ? 'cross-origin' : 'unavailable'; }
          }
          add(current, 'img', el, { loaded, width: el.naturalWidth, height: el.naturalHeight, preview, previewIssue });
          if (el.getAttribute('src')) add(el.src, 'src', el);
          for (const attr of ['data-src', 'data-original', 'data-lazy-src', 'data-url']) {
            const value = el.getAttribute(attr);
            if (value) add(value, 'lazy', el);
          }
          for (const attr of ['srcset', 'data-srcset']) {
            for (const url of srcsetURLs(el.getAttribute(attr) || '')) add(url, 'srcset', el);
          }
        }
        if (el.matches('picture > source')) {
          for (const url of srcsetURLs(el.getAttribute('srcset') || '')) add(url, 'srcset', el);
        }
        if (el instanceof HTMLCanvasElement && el.width && el.height) {
          let snapshot = '', preview = '';
          if (!passive) try {
            const data = pixels(el);
            if (snapshotBytes + data.length <= 32 * 1024 * 1024) {
              snapshot = data; snapshotBytes += data.length;
            }
            if (previewBytes < 6 * 1024 * 1024) { preview = pixels(el, true); previewBytes += preview.length; }
          } catch { /* Still show unreadable canvases. */ }
          // Fragment gives each canvas its own stable URL within this scan.
          add(`${location.href.split('#')[0]}#__imagetaken_canvas_${byURL.size}`, 'canvas', el,
            { loaded: !passive, width: el.width, height: el.height, kind: 'canvas', snapshot, preview });
        }
        if (el instanceof SVGSVGElement && !el.parentElement?.closest('svg')) {
          const clone = el.cloneNode(true);
          const originalChildren = [...el.querySelectorAll('*')];
          [...clone.querySelectorAll('*')].forEach((child, i) => { if (excluded(originalChildren[i])) child.remove(); });
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          const data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
          add(data, 'svg', el, { loaded: true, width: el.width.baseVal.value, height: el.height.baseVal.value });
        }
        if (el.matches('svg image')) add(el.getAttribute('href') || el.getAttribute('xlink:href'), 'svg-image', el);
        if (el.matches('video[poster]')) add(el.poster, 'poster', el);
        if (el.matches('a[href]') && /\.(avif|png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#]|$)/i.test(el.href)) add(el.href, 'link', el);
        for (const pseudo of [null, '::before', '::after']) {
          const style = getComputedStyle(el, pseudo);
          if (pseudo && (style.content === 'none' || style.content === 'normal')) continue;
          for (const property of ['backgroundImage', 'listStyleImage', 'maskImage', 'borderImageSource', 'content']) {
            const value = style[property];
            if (!value || !value.includes('url(')) continue;
            for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) {
              add(match[1] || match[2] || match[3], pseudo ? 'pseudo' : 'css', el);
            }
          }
        }
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    for (const root of roots) walk(root);
    for (const entry of performance.getEntriesByType('resource')) {
      if (entry.initiatorType === 'img' || /\.(avif|png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#]|$)/i.test(entry.name)) {
        const record = xpath || selectors.length ? byURL.get(entry.name) : add(entry.name, 'resource');
        const bodySize = entry.decodedBodySize || entry.encodedBodySize;
        if (record && bodySize > 0 && !(entry.responseStatus >= 400)) {
          record.bytes = bodySize;
          record.sizeSource = '浏览器资源记录中的响应体大小（非像素内存或含响应头的传输量）';
        }
      }
    }
    // The side panel and expanded tab may be open at once. A new scan must not
    // immediately invalidate another view's page-only Blob/Canvas references.
    if (!passive) {
      history.push(records);
      if (history.length > 3) history.shift();
    }
    return {
      title: document.title, url: location.href, truncated, matchedRoots,
      items: [...scanRecords.values()].map(({ element, snapshot, occurrences, ...item }) => item),
    };
  }

  async function asData(blob, method) {
    if (!blob.size || blob.size > MAX_BYTES) throw new Error('图片为空或超过 20 MiB 的数据读取上限');
    if (!blob.type.startsWith('image/')) throw new Error('响应不是图片');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('无法读取图片数据'));
      reader.readAsDataURL(blob);
    });
    return { dataUrl, method, bytes: blob.size, mime: blob.type };
  }

  async function read(id, { refresh = false, preview = false } = {}) {
    const record = records.get(id) || history.find(generation => generation.has(id))?.get(id);
    if (!record) return { error: '页面已重新扫描，请刷新图片列表' };
    const { url, element } = record;
    const errors = [];
    try {
      if (record.kind === 'canvas') {
        if (!record.snapshot) throw new Error('Canvas 受跨域保护或超过尺寸 / 快照预算上限');
        return { dataUrl: record.snapshot, method: 'canvas', mime: 'image/png' };
      }
      if (url.startsWith('data:')) {
        if (!/^data:image\//i.test(url) || url.length > MAX_BYTES * 4 / 3) throw new Error('无效或过大的图片数据');
        return { dataUrl: url, method: 'embedded' };
      }
      // Preview retries can use already decoded pixels without a network
      // request. File downloads keep the original-byte-first path below so
      // animated GIFs and other source formats are not replaced with PNGs.
      if (preview && element instanceof HTMLImageElement && element.complete && element.naturalWidth &&
          (element.currentSrc || element.src) === url) {
        try { return { dataUrl: pixels(element, true), method: 'decoded-pixels', mime: 'image/png' }; }
        catch (error) { errors.push(error.message); }
      }
      const fetchImage = async (cache) => {
        const response = await fetch(url, {
          cache, mode: cache === 'only-if-cached' ? 'same-origin' : 'cors',
          credentials: 'include', signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // Bound the stream before serialization, including responses without Content-Length.
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) throw new Error('图片超过 20 MiB');
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        return new Blob(chunks, { type: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' });
      };
      if ((!refresh || preview) && new URL(url).origin === location.origin && !url.startsWith('blob:')) {
        try { return await asData(await fetchImage('only-if-cached'), 'page-cache'); }
        catch (error) { errors.push(error.message); }
      }
      // Blob URLs are readable only in their owning page/storage partition.
      try { return await asData(await fetchImage(refresh ? 'reload' : 'force-cache'), url.startsWith('blob:') ? 'page-blob' : 'page-fetch'); }
      catch (error) { errors.push(error.message); }
      if (element instanceof HTMLImageElement && element.complete && element.naturalWidth &&
          (element.currentSrc || element.src) === url) {
        try { return { dataUrl: pixels(element), method: 'decoded-pixels', mime: 'image/png' }; }
        catch (error) { errors.push(error.message); }
      }
    } catch (error) { errors.push(error.message); }
    return { error: [...new Set(errors)].join('；') || '页面无法读取原图数据' };
  }
  const resource = id => {
    const record = records.get(id) || history.find(generation => generation.has(id))?.get(id);
    return record ? { url: record.url } : null;
  };
  const targets = ids => ids.flatMap(id => (records.get(id) || history.find(generation => generation.has(id))?.get(id))?.occurrences || []);
  globalThis.__imageTaken = { scan, read, resource, targets };
})();
