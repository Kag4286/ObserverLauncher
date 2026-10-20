// The install window's version select starts with NO options. Before this was fixed, its custom
// dropdown was an empty box on screen under a VERSION heading, and clicking it portalled an
// empty panel to <body> where it outlived the modal it belonged to.
//
// The rule now: a select with no options shows no dropdown, and the dropdown comes back as soon
// as the options arrive. A failing search must also report itself instead of spinning forever.
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers');

let app, win, userDataDir;

test.beforeAll(async () => {
  ({ app, win, userDataDir } = await launchApp());
  const modal = win.locator('#onboardingModal');
  if (await modal.isVisible().catch(() => false)) await win.locator('#onboardingClose').click();
});

test.afterAll(async () => { await closeApp(app, userDataDir); });

test('no custom dropdown is visible for a select with no options', async () => {
  const empties = await win.evaluate(() => {
    const out = [];
    document.querySelectorAll('.ol-dd').forEach(d => {
      const sel = d.querySelector('select');
      if (!sel || sel.options.length) return;
      const r = d.getBoundingClientRect();
      out.push({ id: sel.id, visible: r.width > 0 && r.height > 0 });
    });
    return out;
  });
  // The install window's version select is one of them; it must not show a box.
  expect(empties.length).toBeGreaterThan(0);
  for (const d of empties) expect(d.visible, `dropdown for #${d.id} is visible but has no options`).toBe(false);
});

test('a dropdown that gets options later becomes visible', async () => {
  const res = await win.evaluate(() => {
    const sel = document.querySelector('#imVersion');
    const dd = sel.closest('.ol-dd');
    const before = dd.hidden;
    sel.innerHTML = '<option value="1">one</option>';
    if (dd._olSync) dd._olSync();
    return { before, after: dd.hidden, label: dd.querySelector('.ol-dd-label').textContent };
  });
  expect(res.before).toBe(true);
  expect(res.after).toBe(false);
  expect(res.label).toBe('one');
});

test('the dropdown panel cannot outlive the select it belongs to', async () => {
  const res = await win.evaluate(() => {
    const sel = document.querySelector('#imVersion');
    const dd = sel.closest('.ol-dd');
    // Open the panel, then hide the wrapper: the panel is portalled to <body>, so it has to
    // close itself or it stays on screen with no owner.
    dd._olBtn.click();
    const panel = dd._olPanel;
    const openBefore = !panel.hidden;
    dd.hidden = true;
    // The MutationObserver that closes it runs as a microtask.
    return new Promise(resolve => setTimeout(() => resolve({ openBefore, openAfter: !panel.hidden, inBody: panel.parentElement === document.body }), 60));
  });
  expect(res.openBefore).toBe(true);
  expect(res.inBody).toBe(true);
  expect(res.openAfter).toBe(false);
});
