const { execFile } = require('child_process');

function parseJavaVersion(output) { const m = output.match(/version\s+"([^"]+)"/i); return m ? m[1] : 'Detected'; }
// FEATURE: 32-bit Java caps the JVM heap at roughly 2GB no matter what -Xmx is set to (and often
// refuses to start at all above that) — a common source of "server won't start, no clear error" for
// anyone who happens to have an old/32-bit Java on PATH. `java -version` prints "64-Bit Server VM" (or
// "32-Bit ...") on its own output, so this is detected for free from the same call, no extra process.
function parseJavaArch(output) { if (/64-Bit/i.test(output)) return '64-bit'; if (/32-Bit/i.test(output)) return '32-bit'; return 'unknown'; }
function detectJava(javaPath = 'java') { return new Promise(resolve => execFile(javaPath, ['-version'], { windowsHide: true }, (error, stdout, stderr) => { if (error) return resolve({ ok: false, message: error.message }); const combined = stderr + stdout; resolve({ ok: true, version: parseJavaVersion(combined), arch: parseJavaArch(combined), path: javaPath }); })); }
// SYNC: Minecraft switched from 1.x to calendar versioning (26.x). Both schemes must map to a
// minimum Java version or validation silently skips (the old regex only knew 1.x, so a Java 17
// install passed the pre-start check for a 26.x jar and crashed later with an obscure JVM error).
// Verified live against Mojang's version manifest javaVersion field (piston-meta):
//   26.1/26.2 → Java 25 (java-runtime-epsilon), 1.20.5+/1.21.x → Java 21, 1.18+ → 17, 1.17 → 16, older → 8.
function requiredJavaForJar(jar) {
  const s = String(jar || '');
  let m = s.match(/\b1\.(\d{1,2})(?:\.(\d{1,2}))?\b/);
  if (m) {
    const minor = Number(m[1]), patch = Number(m[2] || 0);
    if (minor >= 21) return 21;
    if (minor === 20 && patch >= 5) return 21;
    if (minor >= 18) return 17;
    if (minor >= 17) return 16;
    return 8;
  }
  if (/\b26\.\d{1,2}\b/.test(s)) return 25;
  return null; // unknown scheme — validation skipped rather than guessed
}
function javaMajor(version) { const m = String(version || '').match(/(?:1\.)?(\d+)/); return m ? Number(m[1]) : null; }
// NOTE: findJavaDescendant lives in ./platform/win32.js — a copy of it used to exist here too and
// drifted out of sync. The platform module is the single source of truth for process-tree walking.

// FEATURE: extracted from main.js — needs serverFiles() to check for a runnable jar/launchScript, and
// takes javaInfo explicitly instead of closing over the module-level variable, so this stays testable
// on its own.
function validateStart(settings, javaInfo, serverFilesFn) {
  if (!settings.serverPath || !require('fs').existsSync(settings.serverPath)) return 'Choose a valid server folder first.';
  const info = serverFilesFn(settings.serverPath); if (!info.jar && !info.launchScript) return 'No runnable server .jar or run.bat was found in the selected folder.';
  if (!javaInfo?.ok) return 'Java was not detected. Set a valid Java path in Settings.';
  const required = requiredJavaForJar(info.jar || ''), actual = javaMajor(javaInfo.version); if (required && actual && actual < required) return `${info.jar} needs Java ${required}+; detected Java ${actual}.`;
  // FEATURE: 32-bit Java realistically cannot honor a large -Xmx (it errors out or silently clamps
  // depending on the build) — catch this before spawning instead of letting the process fail with a
  // JVM error that doesn't explain WHY. Custom JVM args are checked for an explicit -Xmx; otherwise the
  // Maximum memory (GB) field is used, matching what startServerInternal actually launches with.
  if (javaInfo.arch === '32-bit') {
    const customArgs = String(settings.jvmArgs || '').trim();
    const xmxMatch = customArgs.match(/-Xmx(\d+)([mMgG])/);
    const requestedGB = xmxMatch ? (Number(xmxMatch[1]) / (xmxMatch[2].toLowerCase() === 'g' ? 1 : 1024)) : Number(settings.memoryMax || 6);
    if (requestedGB > 2) return `Detected 32-bit Java, which cannot reliably allocate more than ~2GB of RAM (requested ${requestedGB}GB). Install 64-bit Java, or lower Maximum memory / your -Xmx to 2GB or less.`;
  }
  return null;
}

module.exports = { parseJavaVersion, detectJava, requiredJavaForJar, javaMajor, validateStart };
