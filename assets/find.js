// product finder: reads displays/catalog.json and filters it in the page
(() => {
  const PANEL = { amoled: 'AMOLED', tft: 'TFT', lcd: 'LCD', oled: 'OLED', epd: 'EPD' };

  const box = document.querySelector('#q');
  const cards = document.querySelector('#cards');
  const tally = document.querySelector('#tally');
  const reset = document.querySelector('#reset');
  const lede = document.querySelector('#lede');
  if (!box || !cards) return;

  // one dropdown per filter, wired up from the markup
  const menus = {};
  document.querySelectorAll('.pick').forEach((root) => {
    menus[root.dataset.group] = {
      root,
      btn: root.querySelector('.pick-btn'),
      num: root.querySelector('.num'),
      panel: root.querySelector('.pick-menu'),
      opts: [],
    };
  });

  const groups = Object.keys(menus);
  const picked = {};
  groups.forEach((g) => (picked[g] = new Set()));
  let items = [];

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  // a repo with two interfaces (spi_i80) must answer to either one
  const ifacesOf = (row) =>
    Array.isArray(row.interfaces) && row.interfaces.length
      ? row.interfaces
      : String(row.interface || '').split('_').filter(Boolean);

  const searchable = (row) =>
    [row.repo, PANEL[row.panel] || row.panel, row.size, row.resolution, row.ic, ...ifacesOf(row)]
      .join(' ')
      .toLowerCase();

  function fits(row) {
    const words = box.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hay = searchable(row);
    if (!words.every((w) => hay.includes(w))) return false;
    if (picked.panel.size && !picked.panel.has(row.panel)) return false;
    if (picked.iface.size && !ifacesOf(row).some((x) => picked.iface.has(x))) return false;
    if (picked.size.size && !picked.size.has(row.size)) return false;
    if (picked.ic.size && !picked.ic.has(row.ic)) return false;
    return true;
  }

  function card(row) {
    const link = el('a', 'card');
    link.href = row.url;
    link.target = '_blank';
    link.rel = 'noopener';
    // the name is clipped in the card, so keep it readable on hover
    link.title = row.repo;

    const top = el('span', 'card-top');
    top.append(el('span', 'size', `${row.size}"`), el('span', 'tag', PANEL[row.panel] || row.panel.toUpperCase()));

    const specs = el('span', 'specs');
    specs.append(
      el('span', null, row.resolution.replace('x', ' × ')),
      el('span', null, ifacesOf(row).map((x) => x.toUpperCase()).join(' / ')),
      el('span', null, row.ic.toUpperCase())
    );

    link.append(top, specs, el('span', 'repo', row.repo));
    return link;
  }

  const anyPicked = () => box.value.trim() !== '' || groups.some((g) => picked[g].size > 0);

  function keepUrl() {
    const p = new URLSearchParams();
    const q = box.value.trim();
    if (q) p.set('q', q);
    for (const group of groups) {
      if (picked[group].size) p.set(group, [...picked[group]].join(','));
    }
    const query = p.toString();
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
  }

  function render() {
    const found = items.filter(fits);
    tally.textContent =
      found.length === items.length
        ? `${items.length} modules`
        : `${found.length} of ${items.length} modules`;
    reset.hidden = !anyPicked();

    cards.replaceChildren();
    if (!found.length) {
      cards.append(el('p', 'empty', 'Nothing matches. Try a size, a resolution or a driver name.'));
    } else {
      found.forEach((row) => cards.append(card(row)));
    }
    keepUrl();
  }

  const mark = (node, on) => {
    node.classList.toggle('is-on', on);
    node.setAttribute('aria-pressed', String(on));
  };

  function badge(group) {
    const ui = menus[group];
    const n = picked[group].size;
    ui.num.hidden = n === 0;
    ui.num.textContent = n || '';
    ui.root.classList.toggle('has-pick', n > 0);
  }

  function options(group, values, label, cols) {
    const ui = menus[group];
    ui.panel.style.setProperty('--cols', cols);
    values.forEach((value) => {
      const opt = el('button', 'opt', label(value));
      opt.type = 'button';
      // filters can arrive already set from the URL
      mark(opt, picked[group].has(value));
      opt.addEventListener('click', () => {
        if (picked[group].has(value)) picked[group].delete(value);
        else picked[group].add(value);
        mark(opt, picked[group].has(value));
        badge(group);
        render();
      });
      ui.opts.push(opt);
      ui.panel.append(opt);
    });
    badge(group);
  }

  function show(group, on) {
    const ui = menus[group];
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

  const shut = () => groups.forEach((g) => show(g, false));

  groups.forEach((group) => {
    menus[group].btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = menus[group].panel.hidden;
      shut();
      if (opening) show(group, true);
    });
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

  const uniq = (values) => [...new Set(values)];
  // short lists read best by how common they are; long ones by their own order
  const byUse = (values) => {
    const seen = new Map();
    values.forEach((v) => seen.set(v, (seen.get(v) || 0) + 1));
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  };
  const byInch = (values) => uniq(values).sort((a, b) => parseFloat(a) - parseFloat(b));
  const byName = (values) => uniq(values).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  function readUrl() {
    const p = new URLSearchParams(location.search);
    box.value = p.get('q') || '';
    for (const group of groups) {
      (p.get(group) || '').split(',').filter(Boolean).forEach((v) => picked[group].add(v));
    }
  }

  box.addEventListener('input', render);
  reset.addEventListener('click', () => {
    box.value = '';
    groups.forEach((g) => {
      picked[g].clear();
      menus[g].opts.forEach((opt) => mark(opt, false));
      badge(g);
    });
    render();
    box.focus();
  });

  readUrl();

  fetch('catalog.json')
    .then((r) => r.json())
    .then((data) => {
      items = data.items || [];
      lede.textContent = `${items.length} display modules · specs and examples in each repository`;
      options('panel', byUse(items.map((r) => r.panel)), (v) => PANEL[v] || v.toUpperCase(), 2);
      options('iface', byUse(items.flatMap(ifacesOf)), (v) => v.toUpperCase(), 3);
      options('size', byInch(items.map((r) => r.size)), (v) => `${v}"`, 4);
      options('ic', byName(items.map((r) => r.ic)), (v) => v.toUpperCase(), 3);
      render();
    })
    .catch(() => {
      tally.textContent = '';
      cards.replaceChildren(el('p', 'empty', 'The catalogue failed to load. Please reload the page.'));
    });
})();
