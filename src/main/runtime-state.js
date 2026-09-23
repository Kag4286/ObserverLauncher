// v2.0.0 (M3): persistent process identity for orphan cleanup.
//
// The live server process is only tracked in memory (ctx.serverProcess). If the
// app crashes, that object is gone and a leftover java process becomes an orphan
// nobody can find. This module records { pid, processStartedAt, serverPath } per
// instance to userData/runtime.json on spawn and clears it on exit, so the next
// launch can detect and deal with an orphan (Phase A step 6).
//
// Kept SEPARATE from settings.json on purpose: settings:save rewrites the whole
// file from renderer state, so a pid stored there would race and be lost.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { writeFileAtomic } = require('./fs-utils.js');

const runtimePath = () => path.join(app.getPath('userData'), 'runtime.json');

function readAll() {
  try {
    const o = JSON.parse(fs.readFileSync(runtimePath(), 'utf8'));
    if (o && typeof o === 'object' && o.processes && typeof o.processes === 'object') return o;
  } catch {}
  return { processes: {} };
}

function writeAll(state) {
  try { writeFileAtomic(runtimePath(), JSON.stringify(state, null, 2)); } catch {}
}

function setInstanceProcess(instanceId, info) {
  if (!info || !info.pid) return;
  const s = readAll();
  s.processes[String(instanceId || 'default')] = {
    pid: Number(info.pid),
    processStartedAt: Number.isFinite(info.processStartedAt) ? info.processStartedAt : null,
    serverPath: info.serverPath || '',
    updatedAt: Date.now(),
  };
  writeAll(s);
}

// M8: keep the last known status on the record so orphan cleanup can pick a tier after a crash
// (stopped -> t1 auto-kill; running/starting -> t2 ask). No-op when there is no record for the id.
function setInstanceStatus(instanceId, status) {
  const key = String(instanceId || 'default');
  const s = readAll();
  if (s.processes[key]) { s.processes[key].status = String(status || 'stopped'); s.processes[key].updatedAt = Date.now(); writeAll(s); }
}

function clearInstanceProcess(instanceId) {
  const key = String(instanceId || 'default');
  const s = readAll();
  if (s.processes[key]) { delete s.processes[key]; writeAll(s); }
}

function getInstanceProcess(instanceId) {
  const s = readAll();
  return s.processes[String(instanceId || 'default')] || null;
}

function listInstanceProcesses() {
  const s = readAll();
  return Object.entries(s.processes).map(([instanceId, p]) => ({ instanceId, ...p }));
}

module.exports = { runtimePath, setInstanceProcess, setInstanceStatus, clearInstanceProcess, getInstanceProcess, listInstanceProcesses };
