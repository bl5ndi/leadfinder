import { t, setLang, applyI18n } from './src/i18n.js';
import { get, DEFAULT_SETTINGS } from './src/storage.js';

const settings = { ...DEFAULT_SETTINGS, ...(await get('settings', {})) };
setLang(settings.lang);
document.documentElement.dataset.theme = settings.theme;
applyI18n();

const all = Object.values(await get('biz', {}));
const k = {
  total: all.length,
  noSite: all.filter(b => b.category === 'none').length,
  priority: all.filter(b => b.score >= 80).length,
  contacted: all.filter(b => ['contacted', 'discussion', 'client'].includes(b.status)).length,
};
document.getElementById('kpis').innerHTML = Object.entries(k)
  .map(([key, n]) => `<div class="kpi k-${key}"><span>${t('kpi.' + key)}</span><b>${n}</b></div>`).join('');

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
  window.close();
});
