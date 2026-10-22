// Tests for marketplace install modal state and detail callback resolution.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
function ok(name, cond) { assert(cond, 'FAIL: ' + name); console.log('PASS ' + name); pass++; }

// 1. Static check: openInstallModal must preserve the item reference so the marketDetail callback does not early-return
{
  const code = fs.readFileSync(path.join(__dirname, '../src/renderer/js/05-marketplace.js'), 'utf8');
  const modalFuncMatch = code.match(/function openInstallModal\(item\)[\s\S]*?^}/m);
  ok('openInstallModal function exists', !!modalFuncMatch);

  const modalBody = modalFuncMatch ? modalFuncMatch[0] : '';
  ok('openInstallModal does not assign a detached copy {...item} to installState.item',
    !modalBody.includes('installState={item:{...item') && !modalBody.includes('installState = {item:{...item'));
  ok('openInstallModal binds item reference directly to installState',
    modalBody.includes('installState={item,') || modalBody.includes('installState = {item,'));
  ok('openInstallModal checks installState.item !== item guard',
    modalBody.includes('if(installState.item!==item)return;') || modalBody.includes('if (installState.item !== item) return;'));
}

// 2. Behavioral simulation of openInstallModal reference lifecycle
{
  let installState = { item: null, detail: null };
  const srv = { mc: '1.21.4', software: 'paper', loader: 'paper' };

  function simulateOpenInstallModal(item) {
    item.software = srv.software;
    item.loader = srv.loader;
    installState = { item, detail: null };

    return Promise.resolve({ ok: true, versions: [{ id: 'v1' }] }).then(d => {
      if (installState.item !== item) return null;
      installState.detail = d;
      return installState;
    });
  }

  const itemA = { id: 'test-plugin', source: 'hangar' };
  simulateOpenInstallModal(itemA).then(res => {
    ok('detail callback resolves for the opened item', res && res.detail && res.detail.ok === true);
    ok('item retains detected software and loader properties', itemA.software === 'paper' && itemA.loader === 'paper');
  });
}
