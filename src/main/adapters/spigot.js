const path = require('path');
const { download } = require('../http.js');

const BUILDTOOLS_URL = 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar';

// FEATURE: Spigot/CraftBukkit have NO legal pre-built download (Mojang forbids redistributing a
// patched server) — the only official way is to compile it locally with BuildTools.jar, which needs
// Git and can take SEVERAL MINUTES. Unlike the other adapters, the compile is a long-running
// background process that main.js has to keep a handle on (buildProcess) so other actions (starting
// the server, running the wizard again) can be guarded against overlapping with it. This module only
// owns getting BuildTools.jar onto disk and the spawn() arguments — main.js still does the actual
// spawn + stdout/exit wiring, since that's where the shared buildProcess state already lives.
async function fetchBuildTools(serverPath, onProgress) {
  const jarPath = path.join(serverPath, 'BuildTools.jar');
  await download(BUILDTOOLS_URL, jarPath, onProgress);
  return jarPath;
}
function spawnArgs(targetVersion) { return ['-jar', 'BuildTools.jar', '--rev', targetVersion, '--output-dir', '.']; }

module.exports = { fetchBuildTools, spawnArgs };
