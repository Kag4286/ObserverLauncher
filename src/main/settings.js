const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const { writeFileAtomic } = require('./fs-utils.js');

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function defaultMemoryGB() {
  const totalGB = os.totalmem() / (1024 ** 3);
  const max = Math.max(2, Math.min(8, Math.floor(totalGB / 2)));
  const min = Math.max(1, Math.min(2, Math.floor(max / 2)));
  return { min, max };
}
const { migrate, latestVersion } = require('./migrations.js');

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    const migrated = migrate(raw);
    // auto-save if migrated to new version
    if (migrated.version !== raw.version) {
      try { saveSettings(migrated); } catch {}
    }
    return migrated;
  } catch {
    const { min, max } = defaultMemoryGB();
    return { version: latestVersion, serverPath: '', javaPath: '', memoryMin: min, memoryMax: max, jvmArgs: '', autoEula: true, onboarded: false, autoRestart: false, autoRestartMaxAttempts: 3, autoRestartDelaySeconds: 5, autoBackupMinutes: 0, locale: 'en' };
  }
}
function saveSettings(settings) {
  const withVersion = { ...settings, version: latestVersion };
  writeFileAtomic(settingsPath(), JSON.stringify(withVersion, null, 2));
}
module.exports = { settingsPath, defaultMemoryGB, loadSettings, saveSettings };
