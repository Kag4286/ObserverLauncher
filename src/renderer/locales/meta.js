// locales/meta.js — split from locales.js (lines 1-12); load FIRST.
// ObserverLauncher i18n — window.LOCALES + LOCALES_META.
// Adding a language: add a dictionary with the same keys as `en` and an entry in LOCALES_META.
// Missing keys automatically fall back to English (see t() in app.js).
window.LOCALES_META = [
  { code: 'en', name: 'English' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'es', name: 'Español' },
  { code: 'pt-BR', name: 'Português (BR)' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh-CN', name: '简体中文' },
];
window.LOCALES = {};
