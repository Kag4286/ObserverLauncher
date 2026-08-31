// i18n module — loads JSON translations and applies data-i18n attributes
const SUPPORTED_LOCALES = ['en', 'vi', 'es', 'pt-BR', 'de', 'ru', 'zh-CN'];
const LOCALE_NAMES = {
  en: 'English',
  vi: 'Tiếng Việt',
  es: 'Español',
  'pt-BR': 'Português (BR)',
  de: 'Deutsch',
  ru: 'Русский',
  'zh-CN': '简体中文',
};
const LOCALE_LANG_ATTR = {
  en: 'en', vi: 'vi', es: 'es', 'pt-BR': 'pt-BR', de: 'de', ru: 'ru', 'zh-CN': 'zh-CN',
};

const translations = {};
let currentLocale = localStorage.getItem('locale') || 'en';
if (!SUPPORTED_LOCALES.includes(currentLocale)) currentLocale = 'en';

async function loadLocale(locale) {
  if (translations[locale]) return translations[locale];
  const res = await fetch(`assets/i18n/${locale}.json`);
  if (!res.ok) throw new Error(`Failed to load i18n/${locale}.json`);
  const data = await res.json();
  translations[locale] = data;
  return data;
}

function getTranslation(locale, key) {
  const dict = translations[locale] || {};
  if (dict[key] !== undefined) return dict[key];
  const enDict = translations['en'] || {};
  return enDict[key] !== undefined ? enDict[key] : key;
}

function applyToElement(el, locale) {
  const key = el.getAttribute('data-i18n');
  if (key) {
    el.textContent = getTranslation(locale, key);
  }
  const htmlKey = el.getAttribute('data-i18n-html');
  if (htmlKey) {
    el.innerHTML = getTranslation(locale, htmlKey);
  }
  const phKey = el.getAttribute('data-i18n-ph');
  if (phKey) {
    el.setAttribute('placeholder', getTranslation(locale, phKey));
  }
}

function applyTranslations(locale) {
  currentLocale = locale;
  document.documentElement.lang = LOCALE_LANG_ATTR[locale] || 'en';
  const selector = document.getElementById('langSelect');
  if (selector) selector.value = locale;
  const els = document.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-ph]');
  console.log(`[i18n] applying locale "${locale}" to ${els.length} elements`);
  els.forEach(el => applyToElement(el, locale));
  document.dispatchEvent(new CustomEvent('i18n:applied', { detail: { locale } }));
}

async function switchLanguage(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) locale = 'en';
  try {
    await loadLocale(locale);
  } catch (err) {
    console.error(`[i18n] failed to load "${locale}":`, err);
    locale = 'en';
    await loadLocale('en');
  }
  localStorage.setItem('locale', locale);
  applyTranslations(locale);
}

function initLanguageSelector() {
  const selector = document.getElementById('langSelect');
  if (!selector) return;
  // Static options already exist in index.html; do not clear them.
  // Just set the current value and attach the change handler.
  if (!selector.options.length) {
    SUPPORTED_LOCALES.forEach(code => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = LOCALE_NAMES[code] || code;
      selector.appendChild(opt);
    });
  }
  selector.value = currentLocale;
  selector.addEventListener('change', () => switchLanguage(selector.value));
}

export async function initI18n() {
  // always load English as fallback
  await loadLocale('en');
  const stored = localStorage.getItem('locale') || 'en';
  let locale = SUPPORTED_LOCALES.includes(stored) ? stored : 'en';
  try {
    await loadLocale(locale);
  } catch (err) {
    console.error(`[i18n] failed to load stored locale "${locale}":`, err);
    // fall back to English if the stored locale file is missing/invalid
    locale = 'en';
    await loadLocale(locale);
    localStorage.setItem('locale', locale);
  }
  initLanguageSelector();
  applyTranslations(locale);
}

export { currentLocale, applyTranslations, getTranslation, SUPPORTED_LOCALES, LOCALE_NAMES };
