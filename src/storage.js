// Local persistence: chrome.storage.local inside the extension, localStorage fallback when the
// page is opened outside Chrome extension context (used only for development previews).
const area = globalThis.chrome?.storage?.local;

export async function get(key, def) {
  if (area) return (await area.get(key))[key] ?? def;
  const v = localStorage.getItem('lf:' + key);
  return v == null ? def : JSON.parse(v);
}

export async function set(key, value) {
  if (area) return area.set({ [key]: value });
  localStorage.setItem('lf:' + key, JSON.stringify(value));
}

export const DEFAULT_SETTINGS = { lang: 'fr', theme: 'light', psiKey: '', usePsi: true, autoAudit: true };
