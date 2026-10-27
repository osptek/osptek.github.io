// display finder: reads products/catalog.json (one row per model) and filters it in the page
(() => {
  const PANEL = { amoled: 'AMOLED', tft: 'TFT', lcd: 'LCD', rlcd: 'RLCD', oled: 'OLED', epd: 'EPD' };
  const SHAPE = { round: 'Round', rect: 'Rect' };
  const TOUCH = { yes: 'With touch', no: 'No touch' };

  const uniq = (values) => [...new Set(values)];
  // short lists read best by how common they are, long ones in their own order
  const byUse = (values) => {
    const seen = new Map();
    values.forEach((v) => seen.set(v, (seen.get(v) || 0) + 1));
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  };
  const byInch = (values) => uniq(values).sort((a, b) => parseFloat(a) - parseFloat(b));
  const byName = (values) => uniq(values).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  // the filters above the cards, and how each one reads a row
  const FACETS = [
    { key: 'panel', label: 'Panel', cols: 2, of: (r) => [r.panel], sort: byUse, text: (v) => PANEL[v] || v.toUpperCase() },
    { key: 'shape', label: 'Shape', cols: 2, of: (r) => [r.shape], sort: byUse, text: (v) => SHAPE[v] || v },
    { key: 'iface', label: 'Interface', cols: 3, of: (r) => r.interfaces || [], sort: byUse, text: (v) => v.toUpperCase() },
    { key: 'size', label: 'Size', cols: 4, even: true, of: (r) => [r.size], sort: byInch, text: (v) => `${v}"` },
    { key: 'ic', label: 'Driver', cols: 3, of: (r) => [r.driver], sort: byName, text: (v) => v },
    { key: 'touch', label: 'Touch', cols: 1, of: (r) => [r.touch ? 'yes' : 'no'], sort: byUse, text: (v) => TOUCH[v] || v },
  ];

  const box = document.querySelector('#q');
  const cards = document.querySelector('#cards');
  const tally = document.querySelector('#tally');
  const reset = document.querySelector('#reset');
  const lede = document.querySelector('#lede');
  const filterRow = document.querySelector('#filters');
  if (!box || !cards || !filterRow) return;

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
  const picked = {};
  const menus = {};
  FACETS.forEach((f) => (picked[f.key] = new Set()));

  // 'x' reads as a times sign everywhere a dimension is shown
  const dims = (value) => String(value || '').replace(/\s*x\s*/g, ' × ');

  const searchable = (row) =>
    [
      row.id,
      row.repo,
      PANEL[row.panel] || row.panel,
      SHAPE[row.shape] || row.shape,
      row.size,
      row.resolution,
      row.driver,
      row.touch,
      row.touch ? 'touch' : '',
      row.outline,
      row.active_area,
      ...(row.interfaces || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

  function fits(row) {
    const words = box.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hay = searchable(row);
    if (!words.every((w) => hay.includes(w))) return false;
    return FACETS.every((f) => {
      const chosen = picked[f.key];
      return !chosen.size || f.of(row).some((v) => chosen.has(v));
    });
  }

  // '45.8 x 40.2 x 1.5 mm' -> [45.8, 40.2]; the thickness is not drawn
  const twoNums = (value) => {
    const nums = (String(value || '').match(/\d+(?:\.\d+)?/g) || []).map(Number);
    return nums.length >= 2 && nums[0] > 0 && nums[1] > 0 ? nums.slice(0, 2) : null;
  };

  // the sketch is drawn from the module's real outline and active area in mm;
  // the resolution only stands in when neither size was given
  function sizesOf(row) {
    const round = String(row.active_area || '').startsWith('Φ');
    const dia = parseFloat(String(row.active_area || '').replace(/^Φ/, ''));
    let active = round && dia > 0 ? [dia, dia] : twoNums(row.active_area);
    const outline = twoNums(row.outline);
    if (!outline && !active) {
      const res = twoNums(String(row.resolution || '').replace('x', ' '));
      return res && { box: res, active: null, unit: 'px' };
    }
    if (!outline) return { box: active, active: null, unit: 'mm' };

    // some files give the active area turned the other way round from the outline
    const fits = ([w, h]) => w <= outline[0] && h <= outline[1];
    if (active && !fits(active) && fits([active[1], active[0]])) active = [active[1], active[0]];
    return { box: outline, active, unit: 'mm' };
  }

  function screenPreview(row) {
    const stage = el('span', 'screen-preview');
    const shape = SHAPE[row.shape] ? row.shape : 'rect';
    const sizes = sizesOf(row) || { box: [1, 1], active: null, unit: '' };
    const [bw, bh] = sizes.box;
    const maxW = 66;
    const maxH = 66;
    const scale = Math.min(maxW / bw, maxH / bh);
    const width = Math.max(12, bw * scale);
    const height = Math.max(12, bh * scale);

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

    // the active area is drawn to scale and centred, since the files give no
    // offset; one that would not fit (a typo in the file) is shrunk to fit
    let aw = width - 6;
    let ah = height - 6;
    if (sizes.active) {
      const fit = Math.min(1, width / (sizes.active[0] * scale), height / (sizes.active[1] * scale));
      aw = sizes.active[0] * scale * fit;
      ah = sizes.active[1] * scale * fit;
    }

    if (shape === 'round') {
      const radius = Math.min(width, height) / 2;
      draw('circle', 'sketch-ghost', { cx: cx + 0.8, cy: cy - 0.4, r: radius + 0.4 });
      draw('circle', 'sketch-outline', { cx, cy, r: radius });
      draw('circle', 'sketch-active', { cx, cy, r: Math.min(aw, ah, radius * 2) / 2 });
    } else {
      draw('rect', 'sketch-ghost', { x: x + 0.8, y: y - 0.6, width, height, rx: 3 });
      draw('rect', 'sketch-outline', { x, y, width, height, rx: 2 });
      draw('rect', 'sketch-active', { x: cx - aw / 2, y: cy - ah / 2, width: aw, height: ah, rx: 0.5 });
    }

    // engineering-sketch dimensions: extension lines, arrows and outline labels
    const label = (n) => (sizes.unit ? String(Math.round(n * 100) / 100) : '');
    draw('line', 'sketch-dim-guide', { x1: x, y1: y - 3, x2: x, y2: topDim - 2 });
    draw('line', 'sketch-dim-guide', { x1: right, y1: y - 3, x2: right, y2: topDim - 2 });
    draw('line', 'sketch-dim', { x1: x, y1: topDim, x2: right, y2: topDim });
    draw('path', 'sketch-arrow', {
      d: `M ${x + 3} ${topDim - 2} L ${x} ${topDim} L ${x + 3} ${topDim + 2}
          M ${right - 3} ${topDim - 2} L ${right} ${topDim} L ${right - 3} ${topDim + 2}`,
    });
    draw('text', 'sketch-label', { x: cx, y: topDim - 2.5, 'text-anchor': 'middle' }, label(bw));

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
    }, label(bh));

    stage.title = `${SHAPE[shape]} screen · ${label(bw)} × ${label(bh)} ${sizes.unit}`;
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
      touch:
        '<circle cx="10" cy="10" r="2.6"/><path d="M5.4 5.4a6.5 6.5 0 0 0 0 9.2M14.6 5.4a6.5 6.5 0 0 1 0 9.2"/>',
    };
    icon.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${paths[kind]}</svg>`;
    return icon;
  }

  function displaySpec(kind, text) {
    const row = el('span', 'display-spec-row');
    row.append(specIcon(kind), el('span', 'display-spec-text', text));
    return row;
  }

  function card(row) {
    const identity = el('span', 'display-identity');
    identity.append(
      el('span', 'display-size', `${row.size}"`),
      el('span', 'display-panel', PANEL[row.panel] || row.panel.toUpperCase())
    );

    const specs = el('span', 'display-specs');
    specs.append(
      displaySpec('resolution', dims(row.resolution)),
      displaySpec('interface', (row.interfaces || []).map((x) => x.toUpperCase()).join(' / ') || '—'),
      displaySpec('driver', row.driver || '—')
    );
    // most screens have no touch layer, so the row only appears when there is one
    if (row.touch) specs.append(displaySpec('touch', row.touch));

    const copy = el('span', 'display-copy');
    copy.append(identity, specs);
    const main = el('span', 'display-main');
    main.append(copy, screenPreview(row));

    const foot = el('span', 'display-foot');
    foot.append(el('span', 'display-model', row.id));
    const sizes = el('span', 'display-dims');
    if (row.outline) sizes.append(el('span', null, `Outline ${dims(row.outline)}`));
    if (row.active_area) sizes.append(el('span', null, `AA ${dims(row.active_area)}`));
    if (sizes.childElementCount) foot.append(sizes);

    const link = el('a', 'card display-card');
    link.href = row.url;
    link.target = '_blank';
    link.rel = 'noopener';
    // the names are clipped in the card, so keep them readable on hover
    link.title = `${row.repo} / ${row.id}`;
    link.append(main, foot);
    return link;
  }

  const anyPicked = () => box.value.trim() !== '' || FACETS.some((f) => picked[f.key].size);

  function keepUrl() {
    const p = new URLSearchParams();
    const q = box.value.trim();
    if (q) p.set('q', q);
    FACETS.forEach((f) => {
      const chosen = picked[f.key];
      if (chosen.size) p.set(f.key, [...chosen].join(','));
    });
    const query = p.toString();
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
  }

  function render() {
    const found = items.filter(fits);
    tally.textContent =
      found.length === items.length
        ? `${items.length} displays`
        : `${found.length} of ${items.length} displays`;
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

  // one dropdown per facet
  function buildFilters() {
    filterRow.replaceChildren();

    FACETS.forEach((f) => {
      const values = f.sort(items.flatMap(f.of).filter(Boolean));
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

  function readUrl() {
    const p = new URLSearchParams(location.search);
    box.value = p.get('q') || '';
    FACETS.forEach((f) => {
      (p.get(f.key) || '').split(',').filter(Boolean).forEach((v) => picked[f.key].add(v));
    });
  }

  box.addEventListener('input', render);
  reset.addEventListener('click', () => {
    box.value = '';
    FACETS.forEach((f) => {
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
      lede.textContent = `${items.length} models in ${data.repos || 0} series · datasheets and code in each repository`;
      readUrl();
      buildFilters();
      render();
    })
    .catch(() => {
      tally.textContent = '';
      cards.replaceChildren(el('p', 'empty', 'The catalogue failed to load. Please reload the page.'));
    });
})();
