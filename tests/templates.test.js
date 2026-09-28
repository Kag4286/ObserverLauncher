// templates.test.js — server templates (v3.0.0 Phase D). PURE: no I/O, no Electron.
//
// WHY: a template is a named bundle that turns 'make a survival server' into one command. This locks
// the shipped set, the validator, and the resolve->plan output (the plan is what the CLI/AI executes,
// so its shape must stay stable).
const { listTemplates, resolveTemplate, validateTemplate, templatePlan, TEMPLATES } = require('../src/main/templates.js');
const { getTool } = require('../src/mcp/tools.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));

// 1) the 3 documented templates ship.
const ids = listTemplates().map(t => t.id);
for (const id of ['survival-5', 'creative-build', 'modded-performance']) {
  check('template ships: ' + id, ids.includes(id));
}
check('listTemplates hides internals (no plugins array)', listTemplates().every(t => !('plugins' in t)));

// 2) every shipped template passes its own validator (a broken default must not ship).
for (const t of TEMPLATES) {
  const v = validateTemplate(t);
  check('validates: ' + t.id, v.ok, (v.errors || []).join(', '));
}

// 3) validator rejects garbage.
check('validator rejects non-object', validateTemplate(null).ok === false);
check('validator rejects bad software', validateTemplate({ id: 'x', software: 'nope', memoryGB: 4, port: 25565 }).ok === false);
check('validator rejects bad memory', validateTemplate({ id: 'x', software: 'paper', memoryGB: 0, port: 25565 }).ok === false);
check('validator rejects bad port', validateTemplate({ id: 'x', software: 'paper', memoryGB: 4, port: 99999 }).ok === false);
check('validator rejects bad plugin kind', validateTemplate({ id: 'x', software: 'paper', memoryGB: 4, port: 25565, plugins: [{ id: 'a', kind: 'weird' }] }).ok === false);

// 4) resolveTemplate is case-insensitive + returns a copy (mutating it must not touch the source).
const r = resolveTemplate('Survival-5');
check('resolveTemplate case-insensitive', !!r && r.id === 'survival-5');
check('resolveTemplate unknown -> null', resolveTemplate('does-not-exist') === null);
if (r) {
  r.plugins.push({ id: 'mutant' });
  const fresh = resolveTemplate('survival-5');
  check('resolveTemplate returns a defensive copy', fresh.plugins.length === 0);
}

// 5) plan shape: software step first, then content, then config, then memory.
{
  const plan = templatePlan('creative-build');
  check('plan ok', plan && plan.ok === true, JSON.stringify(plan && plan.errors));
  const steps = plan.steps || [];
  check('plan step 0 installs software', steps[0] && steps[0].step === 'install_software' && steps[0].tool === 'wizard:create');
  check('plan has a content install step', steps.some(s => s.step === 'install_content' && s.tool === 'install_from_market'));
  check('plan has config overrides', steps.some(s => s.step === 'set_property' && s.tool === 'set_property'));
  check('plan sets memory', steps.some(s => s.step === 'set_memory' && s.tool === 'set_setting'));
  check('plan unknown template -> null', templatePlan('nope') === null);
}

// 6) every plan step's tool is REAL — wizard:create is an IPC channel, the rest are MCP tools.
//    Guards against a template referencing a tool that was renamed away.
{
  const ipcChannels = new Set(['wizard:create']);
  const bad = [];
  for (const t of TEMPLATES) {
    const plan = templatePlan(t.id);
    for (const s of plan.steps) {
      if (ipcChannels.has(s.tool)) continue;
      if (!getTool(s.tool)) bad.push(`${t.id}:${s.tool}`);
    }
  }
  check('every plan step tool exists (MCP tool or wizard:create)', bad.length === 0, bad.join(', '));
}

console.log(fail ? `\n${fail} check(s) failed.` : `\nAll templates checks passed (${pass}).`);
process.exit(fail ? 1 : 0);
