/* global localStorage, window, document */
// Se ejecuta antes del primer dibujo para evitar un destello del tema opuesto.
(() => {
  let preference = 'system';
  try {
    const saved = localStorage.getItem('umlforge.theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch {
    /* El almacenamiento puede estar restringido. */
  }
  const theme =
    preference === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
