// Pure, lightweight curated Minecraft mod/plugin ecosystem guide for MCP AI assistants.
// Exposed via observer://guides/mod-stacks so LLMs avoid hallucinated slugs, wrong-loader
// recommendations, client-only server installs, and well-known incompatibility traps.

const MOD_CURATION_GUIDE = {
  version: '9.0.1',
  workflow: [
    '1. Inspect the server first: get_status (mc/loader), get_settings (memoryMax), get_java_info, list_content.',
    '2. Confirm mode with the user: "server-only" (vanilla clients can join) vs "client-and-server" (players install matching mods).',
    '3. Use search_marketplace (auto-inherits active server mc/loader/kind) with explicit category and excludeClientOnly:true.',
    '4. Always run plan_modpack before installing: verify resolved versions, auto-added required dependencies, sideRequirement, and planWarnings.',
    '5. Wait for user confirmation, run assemble_modpack, then inspect postInstallCompat / check_mod_compat before start_server.',
  ],
  sideRules: {
    'server-only': 'Modrinth server=required|optional and client=optional|unsupported. Safe for Vanilla clients to join.',
    'both-required': 'Modrinth client=required and server=required|optional. Every player must install matching mods locally.',
    'client-only': 'Modrinth server=unsupported (e.g. Sodium, Iris, Mod Menu, Oculus). NEVER install on a dedicated server.',
  },
  recommendedStacks: {
    fabric: {
      libraries: ['fabric-api', 'fabric-language-kotlin', 'cloth-config', 'architectury-api', 'yacl', 'fzzy-config'],
      serverOptimization: ['lithium', 'ferrite-core', 'krypton', 'c2me-fabric', 'scalablelux'],
      serverUtilities: ['spark', 'chunky', 'servux', 'ledger', 'luckperms', 'voicechat'],
    },
    quilt: {
      libraries: ['qsl', 'fabric-language-kotlin', 'cloth-config', 'architectury-api'],
      serverOptimization: ['lithium', 'ferrite-core', 'krypton'],
      serverUtilities: ['spark', 'chunky', 'luckperms'],
    },
    neoforge: {
      libraries: ['cloth-config', 'architectury-api', 'kotlinforforge', 'fzzy-config', 'balm', 'collective'],
      serverOptimization: ['ferrite-core', 'modernfix', 'radium-reforged', 'chunky'],
      serverUtilities: ['spark', 'chunky', 'luckperms', 'voicechat'],
    },
    forge: {
      libraries: ['cloth-config', 'architectury-api', 'kotlinforforge', 'balm', 'collective'],
      serverOptimization: ['ferrite-core', 'modernfix', 'canary', 'radium-reforged'],
      serverUtilities: ['spark', 'chunky', 'luckperms', 'voicechat'],
    },
    paper: {
      serverOptimization: ['spark', 'chunky'],
      serverUtilities: ['luckperms', 'vault', 'essentialsx', 'viaversion'],
    },
    velocity: {
      serverUtilities: ['luckperms', 'spark', 'viaversion'],
    },
  },
  commonTraps: [
    'Client-only traps: NEVER install sodium, iris, sodium-extra, modmenu, embeddium, rubidium, oculus, or optifine on a dedicated server.',
    'Do not stack competing Lithium ports together (only pick ONE: lithium on Fabric, or canary/radium-reforged on Forge/NeoForge).',
    'Starlight is built into vanilla since Minecraft 1.20.5; only consider it on 1.20.4 or older (or use scalablelux on newer MC if needed).',
    'Always include fabric-api for Fabric servers unless every planned mod explicitly requires zero API hooks.',
    'On Fabric server-only content packs, look for Polymer-based mods (polymer ecosystem) so Vanilla clients do not crash on join.',
    'Always search with search_marketplace instead of guessing Modrinth slugs from memory.',
  ],
};

module.exports = { MOD_CURATION_GUIDE };
