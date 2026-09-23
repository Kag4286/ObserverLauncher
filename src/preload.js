const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('observer', {
  getState: () => ipcRenderer.invoke('settings:get'), getFiles: () => ipcRenderer.invoke('files:get'), pickFolder: opts => ipcRenderer.invoke('dialog:server-folder', opts), saveSettings: s => ipcRenderer.invoke('settings:save', s), onboardingComplete: () => ipcRenderer.invoke('onboarding:complete'),
  start: s => ipcRenderer.invoke('server:start', s), stop: () => ipcRenderer.invoke('server:stop'), forceStop: () => ipcRenderer.invoke('server:force-stop'), command: c => ipcRenderer.invoke('server:command', c), openFiles: p => ipcRenderer.invoke('files:open', p), saveProperties: p => ipcRenderer.invoke('properties:save', p), readRawProperties: () => ipcRenderer.invoke('properties:raw-get'), saveRawProperties: content => ipcRenderer.invoke('properties:raw-save', content),
  importContent: type => ipcRenderer.invoke('content:import', type), deleteContent: config => ipcRenderer.invoke('content:delete', config), editorOpen: rel => ipcRenderer.invoke('editor:open', rel), editorSave: payload => ipcRenderer.invoke('editor:save', payload), editorList: () => ipcRenderer.invoke('editor:list'),   createBackup: () => ipcRenderer.invoke('backup:create'), restoreBackup: name => ipcRenderer.invoke('backup:restore', name), deleteBackup: name => ipcRenderer.invoke('backup:delete', name), worldmapLoad: () => ipcRenderer.invoke('worldmap:load'), worldmapSetWaypoints: list => ipcRenderer.invoke('worldmap:waypoints:set', list), worldmapChunks: dim => ipcRenderer.invoke('worldmap:chunks', dim), worldmapBiomes: rect => ipcRenderer.invoke('worldmap:biomes', rect),
  marketVersions: () => ipcRenderer.invoke('market:versions'), marketSearch: query => ipcRenderer.invoke('market:search', query), marketInstall: item => ipcRenderer.invoke('market:install', item), marketDetail: item => ipcRenderer.invoke('market:detail', item), marketOpenExternal: url => ipcRenderer.invoke('market:open-external', url), marketCurseforgeStatus: () => ipcRenderer.invoke('market:curseforge-status'), wizardCreate: config => ipcRenderer.invoke('wizard:create', config), wizardCancel: () => ipcRenderer.invoke('wizard:cancel'), wizardVersions: software => ipcRenderer.invoke('wizard:versions', software), wizardJavaCheck: payload => ipcRenderer.invoke('wizard:java-check', payload), importModpack: () => ipcRenderer.invoke('modpack:import'), exportModpack: () => ipcRenderer.invoke('modpack:export'), verifyBlockedMods: payload => ipcRenderer.invoke('modpack:verify-blocked', payload), installMarketModpack: config => ipcRenderer.invoke('modpack:install-from-market', config), playerRead: uuid => ipcRenderer.invoke('player:read', uuid), playerSave: config => ipcRenderer.invoke('player:save', config), playerWhitelistToggle: config => ipcRenderer.invoke('player:whitelist-toggle', config), playerBanToggle: config => ipcRenderer.invoke('player:ban-toggle', config), playerOpToggle: config => ipcRenderer.invoke('player:op-toggle', config),
  networkInfo: () => ipcRenderer.invoke('network:info'), checkPublicIp: () => ipcRenderer.invoke('network:public-ip'), allowFirewall: port => ipcRenderer.invoke('network:allow-firewall', port), javaAutoInstall: () => ipcRenderer.invoke('java:auto-install'), exportConsole: () => ipcRenderer.invoke('console:export'), pickPlayitFile: () => ipcRenderer.invoke('dialog:playit-file'),
  tunnelStart: provider => ipcRenderer.invoke('tunnel:start', provider), tunnelStop: () => ipcRenderer.invoke('tunnel:stop'), tunnelGet: () => ipcRenderer.invoke('tunnel:get'), tunnelOpenUrl: url => ipcRenderer.invoke('tunnel:open-url', url), onTunnelStatus: cb => ipcRenderer.on('tunnel:status', (_, d) => cb(d)), onTunnelProgress: cb => ipcRenderer.on('tunnel:progress', (_, d) => cb(d)),
  saveManualTunnel: addr => ipcRenderer.invoke('tunnel:set-address', addr),
  // v2.0.0 multi-instance (Phase B backend)
  instancesList: () => ipcRenderer.invoke('instances:list'),
  instanceAdd: payload => ipcRenderer.invoke('instances:add', payload),
  instanceSwitch: id => ipcRenderer.invoke('instances:switch', id),
  instanceRename: payload => ipcRenderer.invoke('instances:rename', payload),
  instanceRemove: id => ipcRenderer.invoke('instances:remove', id),
  instanceSnapshot: id => ipcRenderer.invoke('instances:snapshot', id),
  instanceProbe: folder => ipcRenderer.invoke('instances:probe', folder),
  onLog: cb => ipcRenderer.on('server:log', (_, d) => cb(d)), onState: cb => ipcRenderer.on('server:state', (_, d) => cb(d)), onMetrics: cb => ipcRenderer.on('server:metrics', (_, d) => cb(d)), onLive: cb => ipcRenderer.on('server:live', (_, d) => cb(d)), onFiles: cb => ipcRenderer.on('server:files', (_, d) => cb(d)), onBuildDone: cb => ipcRenderer.on('wizard:build-done', (_, d) => cb(d)), onWizardProgress: cb => ipcRenderer.on('wizard:progress', (_, d) => cb(d)), onJavaProgress: cb => ipcRenderer.on('java:progress', (_, d) => cb(d)), onMarketProgress: cb => ipcRenderer.on('market:progress', (_, d) => cb(d)), onIconsUpdate: cb => ipcRenderer.on('icons:update', (_, d) => cb(d)), onEditorExternal: cb => ipcRenderer.on('editor:external', (_, d) => cb(d)),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  quitInstall: () => ipcRenderer.invoke('app:quit-install'),
  onUpdateAvailable: cb => ipcRenderer.on('app:update-available', (_, d) => cb(d)),
  onUpdateProgress: cb => ipcRenderer.on('app:update-progress', (_, d) => cb(d)),
  onUpdateDownloaded: cb => ipcRenderer.on('app:update-downloaded', (_, d) => cb(d)),
  onUpdateNone: cb => ipcRenderer.on('app:update-none', (_, d) => cb(d)),
  onUpdateError: cb => ipcRenderer.on('app:update-error', (_, d) => cb(d)),
  onMcpConfirmRequest: cb => ipcRenderer.on('mcp:confirm-request', (_, d) => cb(d)),
  onMcpClient: cb => ipcRenderer.on('mcp:client', (_, d) => cb(d)),
  respondMcpConfirm: payload => ipcRenderer.send('mcp:confirm-response', payload),
  // E2E hook: true only under `npm run test:e2e` (env OBSERVER_E2E=1, set by the Playwright
  // helper). The renderer uses it to skip network work during boot so the E2E run stays
  // deterministic and offline. Never true for a normal user launch.
  isE2E: process.env.OBSERVER_E2E === '1'
});
