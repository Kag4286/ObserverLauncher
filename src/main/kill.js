// Shared process-tree kill (extracted from app-lifecycle.js so both graceful
// quit AND force-stop use the same implementation).
const { execFileSync } = require('child_process');

// Terminates a process AND its children. On Windows taskkill /T /F handles the
// whole tree (needed when the server runs under cmd.exe via run.bat — killing
// only cmd.exe would orphan java.exe). On POSIX, SIGTERM to the direct child;
// callers that need the java descendant as well resolve it via
// platform.findJavaDescendant() first (see server-lifecycle force-stop).
function killTree(pid) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(pid, 'SIGTERM');
  } catch {}
}

module.exports = { killTree };
