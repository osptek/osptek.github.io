// the topbar is bare at the top of the page and panels itself once scrolled
(() => {
  const bar = document.querySelector('.topbar');
  if (!bar) return;

  const sync = () => bar.classList.toggle('is-stuck', scrollY > 4);
  addEventListener('scroll', sync, { passive: true });
  sync();
})();
