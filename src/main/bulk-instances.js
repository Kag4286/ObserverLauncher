// bulk-instances.js — decide which instances a Start-all or Stop-all action should touch (v6.0.0 E2).
//
// WHY: with several self-hosted servers, the common case is to boot them together before
// friends join, and to shut them down when done. Running them SEQUENTIALLY (not in parallel)
// keeps the port + CPU bursts apart and matches how the scheduler fires. The DECISION is pure:
// given the instance list and a status lookup, it returns what to start/stop and what to skip,
// so the IPC handler stays a thin loop and the rules are unit-tested without spawning anything.

// Walk the valid entries once (drop null / no-id entries silently instead of crashing on them).
function eachInstance(instances, fn) {
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || !inst.id) continue;
    fn(inst);
  }
}

// An instance is startable when its folder is present, it has a path, and it is not already in a
// transition. A running instance is skipped (it is already doing what the user asked).
function planStartAll(instances, statusOf) {
  const start = [];
  const skip = [];
  eachInstance(instances, (inst) => {
    const id = inst.id;
    if (inst.missing) { skip.push({ id, reason: 'missing' }); return; }
    if (!inst.serverPath) { skip.push({ id, reason: 'no-path' }); return; }
    const st = String((statusOf && statusOf(id)) || 'stopped');
    if (st === 'running' || st === 'starting' || st === 'stopping') { skip.push({ id, reason: st }); return; }
    start.push(id);
  });
  return { start, skip };
}

// An instance is stoppable when it is running or mid-start. A stopping instance is skipped (the
// stop is already in flight); a stopped instance has nothing to do.
function planStopAll(instances, statusOf) {
  const stop = [];
  const skip = [];
  eachInstance(instances, (inst) => {
    const id = inst.id;
    const st = String((statusOf && statusOf(id)) || 'stopped');
    if (st === 'stopped' || st === 'stopping') { skip.push({ id, reason: st }); return; }
    stop.push(id);
  });
  return { stop, skip };
}

module.exports = { planStartAll, planStopAll };
