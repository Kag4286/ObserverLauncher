// templates.js — server templates: a named bundle of {software, version, memory, port, plugins,
// configOverrides} that turns 'make me a survival server' into one command (v3.0.0 Phase D).
//
// WHY: creating a server today means the wizard (software+version) THEN installing plugins THEN
// editing server.properties — three separate flows. A template captures the whole intent so the CLI
// (`observer init --template survival-5`) or an AI can reproduce a known-good server in one step.
//
// This module is PURE (no I/O, no Electron): it only defines templates, validates them, and resolves
// a template into an ordered PLAN of steps expressed as existing-tool calls. The caller (CLI / wizard)
// executes the plan with the tools it already has — no new low-level code (see docs/v3.0.0-plan.md D2).

// Template shape:
//   { id, name, description, software, version, memoryGB, port, plugins:[{id,kind,source}], configOverrides:{k:v} }
const TEMPLATES = [
  {
    id: 'survival-5',
    name: 'Survival (up to 5 players)',
    description: 'Paper survival server, 4 GB RAM, sensible view distance, no plugins.',
    software: 'paper',
    version: 'latest',
    memoryGB: 4,
    port: 25565,
    plugins: [],
    configOverrides: { 'view-distance': '8', 'simulation-distance': '6', 'max-players': '5', 'online-mode': 'true', 'difficulty': 'normal' },
  },
  {
    id: 'creative-build',
    name: 'Creative build world',
    description: 'Paper creative server with WorldEdit for fast building, 4 GB RAM.',
    software: 'paper',
    version: 'latest',
    memoryGB: 4,
    port: 25565,
    plugins: [{ id: 'worldedit', kind: 'plugin', source: 'modrinth' }],
    configOverrides: { 'gamemode': 'creative', 'force-gamemode': 'true', 'spawn-protection': '0', 'view-distance': '10' },
  },
  {
    id: 'modded-performance',
    name: 'Modded performance (Fabric)',
    description: 'Fabric server with a performance mod trio (lithium, ferritecore, krypton), 6 GB RAM.',
    software: 'fabric',
    version: 'latest',
    memoryGB: 6,
    port: 25565,
    plugins: [
      { id: 'lithium', kind: 'mod', source: 'modrinth' },
      { id: 'ferritecore', kind: 'mod', source: 'modrinth' },
      { id: 'krypton', kind: 'mod', source: 'modrinth' },
    ],
    configOverrides: { 'view-distance': '10', 'simulation-distance': '8', 'max-players': '10' },
  },
];

// All template ids, for the CLI / wizard picker.
function listTemplates() {
  return TEMPLATES.map(t => ({ id: t.id, name: t.name, description: t.description, software: t.software, version: t.version, memoryGB: t.memoryGB, port: t.port }));
}

// Look up a template by id (case-insensitive). Returns a deep-ish copy or null.
function resolveTemplate(id) {
  const key = String(id || '').trim().toLowerCase();
  const t = TEMPLATES.find(x => x.id === key);
  if (!t) return null;
  return { ...t, plugins: (t.plugins || []).map(p => ({ ...p })), configOverrides: { ...(t.configOverrides || {}) } };
}

// Validate a template object. Returns { ok, errors:[] }. PURE — used by the test and by init.
const VALID_SOFTWARE = ['vanilla', 'paper', 'purpur', 'folia', 'velocity', 'fabric', 'forge', 'neoforge', 'spigot', 'leaf'];
const VALID_KINDS = ['plugin', 'mod', 'datapack'];
function validateTemplate(t) {
  const errors = [];
  if (!t || typeof t !== 'object') return { ok: false, errors: ['template must be an object'] };
  if (!t.id || typeof t.id !== 'string') errors.push('id is required');
  if (!VALID_SOFTWARE.includes(t.software)) errors.push(`unknown software "${t.software}"`);
  if (!Number.isInteger(t.memoryGB) || t.memoryGB < 1 || t.memoryGB > 64) errors.push('memoryGB must be an integer 1..64');
  if (!Number.isInteger(t.port) || t.port < 1 || t.port > 65535) errors.push('port must be an integer 1..65535');
  for (const [i, p] of (t.plugins || []).entries()) {
    if (!p || !p.id) errors.push(`plugins[${i}].id is required`);
    if (p && p.kind && !VALID_KINDS.includes(p.kind)) errors.push(`plugins[${i}].kind "${p.kind}" is invalid`);
  }
  if (t.configOverrides && typeof t.configOverrides !== 'object') errors.push('configOverrides must be an object');
  return { ok: errors.length === 0, errors };
}

// Resolve a template into an ordered PLAN of steps, each expressed as an existing-tool call.
// The caller executes them in order (CLI prints them; an AI runs the tools). PURE.
function templatePlan(template) {
  const t = typeof template === 'string' ? resolveTemplate(template) : template;
  if (!t) return null;
  const v = validateTemplate(t);
  if (!v.ok) return { ok: false, errors: v.errors };
  const steps = [];
  // 1) software: the wizard downloads the server jar (wizard:create / same adapters).
  steps.push({ step: 'install_software', tool: 'wizard:create', args: { software: t.software, version: t.version || 'latest' } });
  // 2) plugins/mods from the marketplace (install_from_market).
  for (const p of t.plugins || []) {
    steps.push({ step: 'install_content', tool: 'install_from_market', args: { id: p.id, kind: p.kind || 'plugin', source: p.source || 'modrinth' } });
  }
  // 3) server.properties overrides (set_property is one key per call; the caller may batch).
  for (const [k, val] of Object.entries(t.configOverrides || {})) {
    steps.push({ step: 'set_property', tool: 'set_property', args: { key: k, value: String(val) } });
  }
  // 4) memory: set_setting memoryMin/Max to the template's GB.
  steps.push({ step: 'set_memory', tool: 'set_setting', args: { key: 'memoryMax', value: t.memoryGB } });
  steps.push({ step: 'set_memory', tool: 'set_setting', args: { key: 'memoryMin', value: Math.max(1, Math.floor(t.memoryGB / 2)) } });
  return { ok: true, template: t, steps };
}

module.exports = { TEMPLATES, listTemplates, resolveTemplate, validateTemplate, templatePlan };
