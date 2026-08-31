// main entry — initialises all site modules
import { initI18n, applyTranslations, currentLocale } from './i18n.js';
import { initTheme } from './theme.js';
import { initRender } from './render.js';
import { initMockup } from './mockup.js';
import { initUI } from './ui.js';
import { initEffects } from './effects.js';

async function boot() {
  const safe = (fn, name) => {
    try { fn(); } catch (err) { console.error(`[boot] ${name} failed:`, err); }
  };

  try { await initI18n(); } catch (err) { console.error('i18n init failed:', err); }

  safe(initTheme, 'initTheme');
  safe(initRender, 'initRender');
  safe(initMockup, 'initMockup');
  safe(initUI, 'initUI');
  safe(initEffects, 'initEffects');

  // Fallback: if the compare table is still empty (e.g. initRender didn't run),
  // render it directly so the section is never blank.
  if (document.getElementById('cmpTable') && !document.querySelector('#cmpTable table')) {
    safe(initRender, 'initRenderFallback');
  }

  document.dispatchEvent(new Event('site:ready'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
