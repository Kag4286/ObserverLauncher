// js/13-bootcheck.js — loads LAST (after 12-wizard.js).
//
// WHY THIS FILE EXISTS: the renderer is classic scripts in numeric load order, with no bundler
// and no module system. If a helper is called during another file's eval before the file that
// defines it has loaded, it throws a ReferenceError and the tab silently goes blank (this shipped
// 3 times: javaMajorOf moved to 12 but called by 07's boot, debounce defined in 08 but called by
// 03 at load, switchTab captured by 02 before 08 defined it). Those failures are invisible to the
// user and hard to report.
//
// This runs once, immediately after every other renderer script has evaluated, and asserts the
// small set of globals that the boot path and each tab depend on actually exist. On success it is
// silent. On failure it logs a clear console error AND shows a fixed banner, so a load-order
// regression becomes loud instead of a blank screen.
//
// NOTE: bare `typeof X` is used per name (NOT eval) because the CSP is script-src 'self' and also
// because top-level `const`/`let` live in the global lexical scope, not on `window`.
(function () {
  var missing = [];

  // Each probe references the identifier directly; a missing one throws ReferenceError, caught
  // here and recorded. Add a probe only for something the boot path or a tab handler truly needs.
  function need(name, ok) { if (!ok) missing.push(name); }

  try { need('javaMajorOf', typeof javaMajorOf !== 'undefined'); } catch { missing.push('javaMajorOf'); }   // 00-core
  try { need('applyLocale', typeof applyLocale === 'function'); } catch { missing.push('applyLocale'); }     // 00-core
  try { need('confirmDialog', typeof confirmDialog === 'function'); } catch { missing.push('confirmDialog'); } // 00-core
  try { need('metricChart', typeof metricChart === 'function'); } catch { missing.push('metricChart'); }     // 00-core
  try { need('switchTab', typeof switchTab === 'function'); } catch { missing.push('switchTab'); }           // 08-shell
  try { need('refreshUI', typeof refreshUI === 'function'); } catch { missing.push('refreshUI'); }           // 07-overview
  try { need('openEd', typeof openEd === 'function'); } catch { missing.push('openEd'); }                     // 01b-editor
  try { need('wmLoad', typeof wmLoad === 'function'); } catch { missing.push('wmLoad'); }                     // 02-worldmap
  try { need('renderProperties', typeof renderProperties === 'function'); } catch { missing.push('renderProperties'); } // 06-properties
  // The preload bridge must exist for anything to work at all.
  if (!window.observer || typeof window.observer.getState !== 'function') missing.push('window.observer');

  if (!missing.length) return;

  try { console.error('[bootcheck] missing renderer globals: ' + missing.join(', ')); } catch {}
  try {
    const b = document.createElement('div');
    b.id = 'bootcheckBanner';
    b.setAttribute('role', 'alert');
    b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;background:#7a1f1f;color:#fff;font:600 13px system-ui,sans-serif;padding:10px 14px;text-align:center';
    b.textContent = 'ObserverLauncher failed to load part of its interface (' + missing.join(', ') + '). Please restart the app. If it keeps happening, report this message.';
    document.body.appendChild(b);
  } catch {}
})();
