// product finder: reads products/catalog.json, switches category and filters in the page
(() => {
  const PANEL = { amoled: 'AMOLED', tft: 'TFT', lcd: 'LCD', oled: 'OLED', epd: 'EPD' };
  const SHAPE = { round: 'Round', rect: 'Rect' };

  const uniq = (values) => [...new Set(values)];
  // short lists read best by how common they are, long ones in their own order
  const byUse = (values) => {
    const seen = new Map();
    values.forEach((v) => seen.set(v, (seen.get(v) || 0) + 1));
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  };
  const byInch = (values) => uniq(values).sort((a, b) => parseFloat(a) - parseFloat(b));
  const byName = (values) => uniq(values).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  // a repo with two interfaces (spi_i80) must answer to either one
  const ifacesOf = (row) =>
    Array.isArray(row.interfaces) && row.interfaces.length
      ? row.interfaces
      : String(row.interface || '').split(/[_ ]/).filter(Boolean);

  // which filters a category offers, and how each one reads its rows;
  // a category with no entry here is searched but not filtered
  const FACETS = {
    displays: [
      { key: 'panel', label: 'Panel', cols: 2, of: (r) => [r.panel], sort: byUse, text: (v) => PANEL[v] || v.toUpperCase() },
      { key: 'shape', label: 'Shape', cols: 2, of: (r) => [r.shape], sort: byUse, text: (v) => SHAPE[v] || v },
      { key: 'iface', label: 'Interface', cols: 3, of: ifacesOf, sort: byUse, text: (v) => v.toUpperCase() },
      { key: 'size', label: 'Size', cols: 4, even: true, of: (r) => [r.size], sort: byInch, text: (v) => `${v}"` },
      { key: 'ic', label: 'Driver', cols: 3, of: (r) => [r.ic], sort: byName, text: (v) => v.toUpperCase() },
    ],
  };

  const box = document.querySelector('#q');
  const cards = document.querySelector('#cards');
  const tally = document.querySelector('#tally');
  const reset = document.querySelector('#reset');
  const lede = document.querySelector('#lede');
  const catRow = document.querySelector('#cats');
  const filterRow = document.querySelector('#filters');
  if (!box || !cards || !catRow || !filterRow) return;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  const mark = (node, on) => {
    node.classList.toggle('is-on', on);
    node.setAttribute('aria-pressed', String(on));
  };

  let items = [];
  let groups = [];
  let cat = 'displays';
  const cats = new Map();
  const picked = {};
  const menus = {};

  const label = (key) => cats.get(key)?.label || key;
  // 'Core Boards' names the group, 'Core Board' names one card
  const one = (key) => label(key).replace(/s$/, '');
  const inCat = (row) => cat === 'all' || row.category === cat;
  const facets = () => FACETS[cat] || [];

  const searchable = (row) =>
    [
      row.repo,
      row.title,
      row.summary,
      label(row.category),
      PANEL[row.panel] || row.panel,
      SHAPE[row.shape] || row.shape,
      row.size,
      row.resolution,
      row.ic,
      ...ifacesOf(row),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

  function fits(row) {
    if (!inCat(row)) return false;
    const words = box.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hay = searchable(row);
    if (!words.every((w) => hay.includes(w))) return false;
    return facets().every((f) => {
      const chosen = picked[f.key];
      return !chosen || !chosen.size || f.of(row).some((v) => chosen.has(v));
    });
  }

  function screenPreview(row) {
    const stage = el('span', 'screen-preview');
    const shape = SHAPE[row.shape] ? row.shape : 'rect';
    const [rw, rh] = String(row.resolution || '').split('x').map(Number);
    const maxW = 66;
    const maxH = 66;
    let width = maxW;
    let height = maxH;

    if (shape === 'round') {
      width = height = 64;
    } else if (rw > 0 && rh > 0) {
      const scale = Math.min(maxW / rw, maxH / rh);
      width = Math.max(12, Math.round(rw * scale));
      height = Math.max(12, Math.round(rh * scale));
    }

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'screen-diagram');
    svg.setAttribute('viewBox', '0 0 92 90');
    const draw = (tag, cls, attrs, text) => {
      const node = document.createElementNS(NS, tag);
      node.setAttribute('class', cls);
      Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
      if (text != null) node.textContent = text;
      svg.append(node);
      return node;
    };

    // Centre the complete engineering figure, including the vertical
    // dimension line on its left. This keeps narrow portrait screens from
    // appearing pinned to the right edge.
    const x = (102 - width) / 2;
    const right = x + width;
    const y = 50 - height / 2;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const topDim = y - 10;
    const leftDim = x - 10;

    // faint construction axes
    draw('line', 'sketch-axis', { x1: x - 4, y1: cy, x2: right + 3, y2: cy });
    draw('line', 'sketch-axis', { x1: cx, y1: y - 4, x2: cx, y2: y + height + 4 });

    if (shape === 'round') {
      const radius = width / 2;
      draw('circle', 'sketch-ghost', { cx: cx + 0.8, cy: cy - 0.4, r: radius + 0.4 });
      draw('circle', 'sketch-outline', { cx, cy, r: radius });
      draw('circle', 'sketch-active', { cx, cy, r: radius - 3 });
    } else {
      const radius = 4;
      draw('rect', 'sketch-ghost', {
        x: x + 0.8, y: y - 0.6, width, height, rx: radius + 1,
      });
      draw('rect', 'sketch-outline', { x, y, width, height, rx: radius });
      draw('rect', 'sketch-active', {
        x: x + 3, y: y + 3, width: width - 6, height: height - 6,
        rx: Math.max(1, radius - 1),
      });
    }

    // engineering-sketch dimensions: extension lines, arrows and pixel labels
    draw('line', 'sketch-dim-guide', { x1: x, y1: y - 3, x2: x, y2: topDim - 2 });
    draw('line', 'sketch-dim-guide', { x1: right, y1: y - 3, x2: right, y2: topDim - 2 });
    draw('line', 'sketch-dim', { x1: x, y1: topDim, x2: right, y2: topDim });
    draw('path', 'sketch-arrow', {
      d: `M ${x + 3} ${topDim - 2} L ${x} ${topDim} L ${x + 3} ${topDim + 2}
          M ${right - 3} ${topDim - 2} L ${right} ${topDim} L ${right - 3} ${topDim + 2}`,
    });
    draw('text', 'sketch-label', { x: cx, y: topDim - 2.5, 'text-anchor': 'middle' }, rw || '');

    draw('line', 'sketch-dim-guide', { x1: x - 3, y1: y, x2: leftDim - 2, y2: y });
    draw('line', 'sketch-dim-guide', { x1: x - 3, y1: y + height, x2: leftDim - 2, y2: y + height });
    draw('line', 'sketch-dim', { x1: leftDim, y1: y, x2: leftDim, y2: y + height });
    draw('path', 'sketch-arrow', {
      d: `M ${leftDim - 2} ${y + 3} L ${leftDim} ${y} L ${leftDim + 2} ${y + 3}
          M ${leftDim - 2} ${y + height - 3} L ${leftDim} ${y + height} L ${leftDim + 2} ${y + height - 3}`,
    });
    draw('text', 'sketch-label', {
      x: leftDim - 3, y: cy, 'text-anchor': 'middle',
      transform: `rotate(-90 ${leftDim - 3} ${cy})`,
    }, rh || '');

    stage.title = `${SHAPE[shape]} screen · ${row.resolution}`;
    stage.setAttribute('aria-hidden', 'true');
    stage.append(svg);
    return stage;
  }

  function specIcon(kind) {
    const icon = el('span', 'spec-icon');
    const paths = {
      resolution:
        '<path d="M7 3H3v4M17 7V3h-4M13 17h4v-4M3 13v4h4"/><path d="M7 10h6M10 7v6"/>',
      interface:
        '<rect x="5" y="5" width="10" height="10" rx="1.5"/><path d="M7 2v3M10 2v3M13 2v3M7 15v3M10 15v3M13 15v3M2 7h3M2 10h3M2 13h3M15 7h3M15 10h3M15 13h3"/><path d="M8 8h4v4H8z"/>',
      driver:
        '<path d="M10 2.5 18 6.5 10 10.5 2 6.5 10 2.5Z"/><path d="m3 10.5 7 3.5 7-3.5M3 14l7 3.5 7-3.5"/>',
    };
    icon.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${paths[kind]}</svg>`;
    return icon;
  }

  function displaySpec(kind, text) {
    const row = el('span', 'display-spec-row');
    row.append(specIcon(kind), el('span', 'display-spec-text', text));
    return row;
  }

  function displayCard(row) {
    const identity = el('span', 'display-identity');
    identity.append(
      el('span', 'display-size', `${row.size}"`),
      el('span', 'display-panel', PANEL[row.panel] || row.panel.toUpperCase())
    );

    const specs = el('span', 'display-specs');
    specs.append(
      displaySpec('resolution', row.resolution.replace('x', ' × ')),
      displaySpec('interface', ifacesOf(row).map((x) => x.toUpperCase()).join(' / ')),
      displaySpec('driver', row.ic.toUpperCase())
    );

    const copy = el('span', 'display-copy');
    copy.append(identity, specs);
    const main = el('span', 'display-main');
    main.append(copy, screenPreview(row));
    return [main];
  }

  function otherCard(row) {
    const top = el('span', 'card-top');
    top.append(el('span', 'model', row.title || row.repo), el('span', 'tag', one(row.category)));

    const parts = [top];
    if (row.interface) parts.push(el('span', 'specs', row.interface));
    if (row.summary) parts.push(el('span', 'blurb', row.summary));
    return parts;
  }

  function card(row) {
    const link = el('a', 'card');
    if (row.category === 'displays') link.classList.add('display-card');
    link.href = row.url;
    link.target = '_blank';
    link.rel = 'noopener';
    // the name is clipped in the card, so keep it readable on hover
    link.title = row.repo;
    link.append(...(row.category === 'displays' ? displayCard(row) : otherCard(row)));
    if (row.category !== 'displays') link.append(el('span', 'repo', row.repo));
    return link;
  }

  const anyPicked = () =>
    box.value.trim() !== '' || facets().some((f) => picked[f.key] && picked[f.key].size);

  function keepUrl() {
    const p = new URLSearchParams();
    if (cat !== 'displays') p.set('cat', cat);
    const q = box.value.trim();
    if (q) p.set('q', q);
    facets().forEach((f) => {
      const chosen = picked[f.key];
      if (chosen && chosen.size) p.set(f.key, [...chosen].join(','));
    });
    const query = p.toString();
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
  }

  function render() {
    const scope = items.filter(inCat);
    const found = scope.filter(fits);
    cards.classList.toggle('is-display-grid', cat === 'displays');
    const noun = cat === 'all' ? 'products' : label(cat).toLowerCase();
    tally.textContent =
      found.length === scope.length
        ? `${scope.length} ${noun}`
        : `${found.length} of ${scope.length} ${noun}`;
    reset.hidden = !anyPicked();

    cards.replaceChildren();
    if (!found.length) {
      cards.append(el('p', 'empty', 'Nothing matches. Try a model, a size or a driver name.'));
    } else {
      found.forEach((row) => cards.append(card(row)));
    }
    keepUrl();
  }

  function show(key, on) {
    const ui = menus[key];
    ui.panel.hidden = !on;
    ui.btn.setAttribute('aria-expanded', String(on));
    ui.root.classList.toggle('is-open', on);
    ui.panel.style.removeProperty('--shift');
    if (!on) return;

    // slide the panel back inside the window when it hangs over an edge;
    // clientWidth, not innerWidth, so a scrollbar cannot hide the panel's edge
    const GAP = 12;
    const room = document.documentElement.clientWidth;
    const r = ui.panel.getBoundingClientRect();
    let shift = Math.min(0, room - GAP - r.right);
    if (r.left + shift < GAP) shift = GAP - r.left;
    if (shift) ui.panel.style.setProperty('--shift', `${Math.round(shift)}px`);
  }

  const shut = () => Object.keys(menus).forEach((key) => show(key, false));

  function badge(key) {
    const ui = menus[key];
    const n = picked[key].size;
    ui.num.hidden = n === 0;
    ui.num.textContent = n || '';
    ui.root.classList.toggle('has-pick', n > 0);
  }

  // one dropdown per facet of the current category, rebuilt whenever it changes
  function buildFilters() {
    Object.keys(menus).forEach((key) => delete menus[key]);
    filterRow.replaceChildren();

    facets().forEach((f) => {
      const values = f.sort(items.filter(inCat).flatMap(f.of).filter(Boolean));
      if (values.length < 2) return;

      const root = el('div', 'pick');
      const btn = el('button', 'pick-btn');
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');
      const num = el('span', 'num');
      num.hidden = true;
      btn.append(el('span', null, f.label), num);
      btn.insertAdjacentHTML(
        'beforeend',
        '<svg class="caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>'
      );

      const panel = el('div', 'pick-menu');
      panel.hidden = true;
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-label', f.label);
      panel.style.setProperty('--cols', f.cols);
      if (f.even) panel.classList.add('chips-even');

      const opts = [];
      values.forEach((value) => {
        const opt = el('button', 'opt', f.text(value));
        opt.type = 'button';
        mark(opt, picked[f.key].has(value));
        opt.addEventListener('click', () => {
          if (picked[f.key].has(value)) picked[f.key].delete(value);
          else picked[f.key].add(value);
          mark(opt, picked[f.key].has(value));
          badge(f.key);
          render();
        });
        opts.push(opt);
        panel.append(opt);
      });

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const opening = panel.hidden;
        shut();
        if (opening) show(f.key, true);
      });

      root.append(btn, panel);
      filterRow.append(root);
      menus[f.key] = { root, btn, num, panel, opts };
      badge(f.key);
    });
  }

  function buildCats() {
    catRow.replaceChildren();
    const all = [{ key: 'all', label: 'All', count: items.length }, ...cats.values()];
    all.forEach((entry) => {
      const chip = el('button', 'cat');
      chip.type = 'button';
      chip.append(el('span', null, entry.label), el('span', 'cat-n', String(entry.count)));
      chip.setAttribute('aria-pressed', String(entry.key === cat));
      chip.classList.toggle('is-on', entry.key === cat);
      chip.addEventListener('click', () => {
        if (cat === entry.key) return;
        cat = entry.key;
        // filters belong to the category that offered them
        groups.forEach((key) => picked[key].clear());
        [...catRow.children].forEach((node, i) => {
          const on = all[i].key === cat;
          node.classList.toggle('is-on', on);
          node.setAttribute('aria-pressed', String(on));
        });
        buildFilters();
        render();
      });
      catRow.append(chip);
    });
  }

  function readUrl() {
    const p = new URLSearchParams(location.search);
    const wanted = p.get('cat');
    if (wanted && (wanted === 'all' || cats.has(wanted))) cat = wanted;
    box.value = p.get('q') || '';
    groups.forEach((key) => {
      (p.get(key) || '').split(',').filter(Boolean).forEach((v) => picked[key].add(v));
    });
  }

  box.addEventListener('input', render);
  reset.addEventListener('click', () => {
    box.value = '';
    facets().forEach((f) => {
      picked[f.key].clear();
      menus[f.key]?.opts.forEach((opt) => mark(opt, false));
      if (menus[f.key]) badge(f.key);
    });
    render();
    box.focus();
  });

  // clicking anywhere else, or pressing escape, folds the panels away
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pick')) shut();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') shut();
  });
  // a resize would leave an open panel measured against the old window
  addEventListener('resize', shut);

  fetch('catalog.json')
    .then((r) => r.json())
    .then((data) => {
      items = data.items || [];
      (data.categories || []).forEach((c) => cats.set(c.key, c));
      groups = uniq(Object.values(FACETS).flat().map((f) => f.key));
      groups.forEach((key) => (picked[key] = new Set()));

      lede.textContent = `${items.length} products · specs and examples in each repository`;
      readUrl();
      buildCats();
      buildFilters();
      render();
    })
    .catch(() => {
      tally.textContent = '';
      cards.replaceChildren(el('p', 'empty', 'The catalogue failed to load. Please reload the page.'));
    });
})();
