(() => {
  const wrap = document.querySelector('.mark-wrap');
  const hit = document.querySelector('.mark-hit');
  const orbit = document.querySelector('.orbit');
  if (!wrap || !hit || !orbit) return;

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IDLE_SPEED = 42;
  const CHASE = 5;
  // ellipse hugging the mark: radii as a share of its box, so the light only
  // answers the pointer while it is close to the mark
  const REACH_X = 0.68;
  const REACH_Y = 1.15;

  const norm = (a) => ((a % 360) + 360) % 360;

  let angle = 0;
  let aim = null;
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (aim === null) {
      if (!still) angle = norm(angle + IDLE_SPEED * dt);
    } else {
      let diff = norm(aim - angle);
      if (diff > 180) diff -= 360;
      angle = norm(angle + diff * Math.min(1, dt * CHASE));
    }

    orbit.style.setProperty('--light-angle', angle.toFixed(1) + 'deg');
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const r = wrap.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const nx = dx / (r.width * REACH_X);
    const ny = dy / (r.height * REACH_Y);
    const near = nx * nx + ny * ny <= 1;
    aim = near ? norm((Math.atan2(dx, -dy) * 180) / Math.PI) : null;
  }, { passive: true });

  document.addEventListener('pointerleave', () => { aim = null; });

  hit.addEventListener('click', () => wrap.classList.toggle('is-lit'));

  // lit on arrival: wait two frames so the bloom transition actually plays
  requestAnimationFrame(() => {
    requestAnimationFrame(() => wrap.classList.add('is-lit'));
  });

  // the subtitle swaps by scrambling its letters into the next phrase
  const rotator = document.querySelector('.rotator');
  const lines = [...document.querySelectorAll('.phrase')].map((el) =>
    el.textContent.trim()
  );
  if (!rotator || lines.length < 2) return;

  const POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const HOLD = 3600;
  const pick = () => POOL[(Math.random() * POOL.length) | 0];

  const slot = document.createElement('span');
  slot.textContent = lines[0];
  rotator.replaceChildren(slot);

  // each letter starts and stops churning on its own beat, so the line
  // resolves unevenly instead of wiping across; all timings are in ms, which
  // keeps the pace the same on high refresh rate screens
  const LEAD = 520;
  const DWELL = 380;
  const SWAP = 55;

  function scrambleTo(text) {
    const from = slot.textContent;
    const plan = [];
    for (let i = 0; i < Math.max(from.length, text.length); i++) {
      const start = Math.random() * LEAD;
      plan.push({
        from: from[i] || '',
        to: text[i] || '',
        start,
        end: start + DWELL + Math.random() * 560,
        char: '',
        swapped: -Infinity,
      });
    }

    const t0 = performance.now();
    (function step(now) {
      const t = now - t0;
      let settled = 0;
      let line = '';
      for (const c of plan) {
        if (t >= c.end) {
          settled++;
          line += c.to;
        } else if (t >= c.start) {
          // keep the word gaps where they belong while the rest churns
          if (t - c.swapped > SWAP) {
            c.char = c.to === ' ' ? ' ' : pick();
            c.swapped = t;
          }
          line += c.char;
        } else {
          line += c.from;
        }
      }
      slot.textContent = line;
      if (settled < plan.length) requestAnimationFrame(step);
    })(t0);
  }

  let at = 0;
  setInterval(() => {
    at = (at + 1) % lines.length;
    if (still) slot.textContent = lines[at];
    else scrambleTo(lines[at]);
  }, HOLD);
})();

// the category cards ship with the counts of the last build; correct them from
// the catalogue so nobody has to keep the numbers in the markup up to date
(() => {
  const cards = [...document.querySelectorAll('.cat-card[data-cat]')];
  if (!cards.length) return;

  fetch('products/catalog.json')
    .then((r) => r.json())
    .then((data) => {
      const counts = new Map((data.categories || []).map((c) => [c.key, c.count]));
      cards.forEach((card) => {
        const n = counts.get(card.dataset.cat);
        const slot = card.querySelector('.cat-count');
        if (n && slot) slot.textContent = n;
      });
    })
    .catch(() => {});
})();
