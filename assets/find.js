// product finder: reads products/catalog.json, switches category and filters in the page
(() => {
  const PANEL = { amoled: 'AMOLED', tft: 'TFT', lcd: 'LCD', oled: 'OLED', epd: 'EPD' };

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

  function displayCard(row) {
    const top = el('span', 'card-top');
    top.append(
      el('span', 'size', `${row.size}"`),
      el('span', 'tag', PANEL[row.panel] || row.panel.toUpperCase())
    );

    const specs = el('span', 'specs');
    specs.append(
      el('span', null, row.resolution.replace('x', ' × ')),
      el('span', null, ifacesOf(row).map((x) => x.toUpperCase()).join(' / ')),
      el('span', null, row.ic.toUpperCase())
    );
    return [top, specs];
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
    link.href = row.url;
    link.target = '_blank';
    link.rel = 'noopener';
    // the name is clipped in the card, so keep it readable on hover
    link.title = row.repo;
    link.append(...(row.category === 'displays' ? displayCard(row) : otherCard(row)));
    link.append(el('span', 'repo', row.repo));
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
