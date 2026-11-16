export const THEME_KEY = 'frog-admin-theme';
const choices = new Set(['light', 'dark', 'system']);
export const validTheme = value => choices.has(value) ? value : 'system';
export const resolveTheme = (preference, systemDark) => validTheme(preference) === 'system' ? (systemDark ? 'dark' : 'light') : preference;

function readPreference(window) {
  try { return validTheme(window.localStorage.getItem(THEME_KEY)); }
  catch { return 'system'; }
}

export function initializeTheme(window = globalThis.window, document = globalThis.document) {
  if (!window || !document) return { preference: 'system', resolved: 'light' };
  const preference = readPreference(window);
  const resolved = resolveTheme(preference, !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return { preference, resolved };
}

export function createThemeController({ window = globalThis.window, document = globalThis.document, onChange = () => {} } = {}) {
  let preference = readPreference(window);
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  function apply() {
    const resolved = resolveTheme(preference, !!media?.matches);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    onChange({ preference, resolved });
  }
  function changed() { if (preference === 'system') apply(); }
  function storage(event) { if (event.key === THEME_KEY) { preference = validTheme(event.newValue); apply(); } }
  if (media?.addEventListener) media.addEventListener('change', changed);
  else media?.addListener?.(changed);
  window.addEventListener('storage', storage);
  apply();
  return {
    set(value) {
      preference = validTheme(value);
      try { window.localStorage.setItem(THEME_KEY, preference); } catch { /* Theme remains usable when storage is unavailable. */ }
      apply();
    },
    dispose() {
      if (media?.removeEventListener) media.removeEventListener('change', changed);
      else media?.removeListener?.(changed);
      window.removeEventListener('storage', storage);
    },
  };
}
