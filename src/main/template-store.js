// template-store.js — user-defined server templates (v6.0.0 G5).
//
// WHY: the built-in TEMPLATES in templates.js are static, hardcoded bundles. G5 lets a user capture
// their CURRENT server config (software, memory, server.properties) as a named template and apply
// it to a new server later. Stored in <dataDir>/templates.json (never inside a server folder).
// The shape matches validateTemplate() in templates.js so a user template is a drop-in.
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./data-dir.js');
const { writeFileAtomic } = require('./fs-utils.js');

function filePath() { return path.join(dataDir(), 'templates.json'); }

// Read all user templates. Returns [] on any error / missing file. Never throws.
function listUserTemplates() {
  try {
    const arr = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    if (!Array.isArray(arr)) return [];
    return arr.filter(t => t && t.id && t.name);
  } catch { return []; }
}

function writeAll(list) {
  try { fs.mkdirSync(dataDir(), { recursive: true }); writeFileAtomic(filePath(), JSON.stringify(list, null, 2)); return { ok: true }; }
  catch (e) { return { ok: false, error: e?.message || 'Could not save templates.' }; }
}

// Capture the current server config as a template.
//   input: { name, software, version?, memoryGB, port, properties }
// Returns { ok, template } or { ok:false, error }.
function saveTemplate(input) {
  const t = input || {};
  const name = String(t.name || '').trim();
  if (!name) return { ok: false, error: 'Give the template a name.' };
  const id = 'user-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) + '-' + Date.now().toString(36);
  const properties = (t.properties && typeof t.properties === 'object') ? t.properties : {};
  const template = {
    id,
    name,
    description: String(t.description || '').trim() || ('Saved from a server on ' + new Date().toISOString().slice(0, 10)),
    software: String(t.software || 'vanilla').toLowerCase(),
    version: String(t.version || 'latest'),
    memoryGB: Math.max(1, Math.min(64, Number(t.memoryGB) || 4)),
    port: Math.max(1, Math.min(65535, Number(t.port) || 25565)),
    plugins: [],
    configOverrides: properties,
    user: true,
    savedAt: Date.now(),
  };
  // Validate against the SAME rules as a built-in template.
  const { validateTemplate } = require('./templates.js');
  const v = validateTemplate(template);
  if (!v.ok) return { ok: false, error: (v.errors || []).join(', ') };
  const list = listUserTemplates();
  // Replace a user template with the same name (re-saving updates it) so the list does not fill up.
  const idx = list.findIndex(x => String(x.name).toLowerCase() === name.toLowerCase());
  if (idx >= 0) { template.id = list[idx].id; list[idx] = template; } else list.push(template);
  const w = writeAll(list);
  if (!w.ok) return w;
  return { ok: true, template };
}

// Delete a user template by id. Returns { ok }.
function deleteTemplate(id) {
  const key = String(id || '');
  const list = listUserTemplates();
  const next = list.filter(t => t.id !== key);
  if (next.length === list.length) return { ok: false, error: 'No such template.' };
  return writeAll(next);
}

// Find a user template by id.
function findUserTemplate(id) {
  return listUserTemplates().find(t => t.id === String(id || '')) || null;
}

module.exports = { listUserTemplates, saveTemplate, deleteTemplate, findUserTemplate, filePath };
