// MCP prompts (v5.0.0). A prompt is a user-invokable WORKFLOW TEMPLATE that an MCP client shows as
// a menu (e.g. a slash command), so the user does not have to phrase the request themselves. This
// module is PURE (no I/O, no electron): it only builds the message list a client sends to the model.
// The bridge exposes it via prompts/list + prompts/get. Single source of truth — nothing is
// duplicated in bridge.js (only a name/title list for the offline fallback lives there).

// Wrap a text body into the MCP user-message shape. One helper so every prompt's build() returns the
// identical envelope (the no-dup guard rejects repeated inline object literals).
const userMsg = (text) => [{ role: 'user', content: { type: 'text', text } }];

// Each prompt: { name, title, description, arguments: [{name, description, required?}], build(args) }
// build(args) -> [{ role, content: { type: 'text', text } }]
const PROMPTS = [
  {
    name: 'diagnose_server',
    title: 'Diagnose my server',
    description: 'Run a full health check and explain what is wrong in plain language, with fixes.',
    arguments: [
      { name: 'instance', description: 'instance id (optional; default = the active server)', required: false },
    ],
    build: (a) => userMsg([
      'Check the health of my Minecraft server and explain the result in plain language.',
      a && a.instance ? `Target instance: ${a.instance} (call list_instances if you need the id).` : 'Use the active instance (call list_instances if unsure).',
      'Steps:',
      '1. Call doctor_report (one-shot).',
      '2. Summarise each check with its level (ok / warn / error) and, for anything not ok, what it means.',
      '3. For the top problems, give the concrete fix (the check already carries one).',
      '4. If a fix is a write/destroy action, tell me exactly what it will change and wait for my confirmation before calling apply_fix.',
    ].join('\n')),
  },
  {
    name: 'optimize_for_ram',
    title: 'Tune RAM and performance',
    description: 'Look at current memory, JVM args and metrics, then suggest memory/JVM tuning for my machine.',
    arguments: [
      { name: 'target_gb', description: 'memory to aim for in GB (optional)', required: false },
    ],
    build: (a) => userMsg([
      'Help me tune my server performance.',
      a && a.target_gb ? `I would like to target about ${a.target_gb} GB of RAM.` : 'Look at what I currently have.',
      'Steps:',
      '1. Read get_settings (memoryMin/Max, jvmArgs), get_java_info, and get_metrics_history + check_performance.',
      '2. Tell me if memory is too low (GC pressure / climbing RAM) or too high (wasting host RAM).',
      '3. Suggest memoryMin/MemoryMax and JVM args (e.g. Aikar flags) for my server type and host.',
      '4. If you recommend a change, describe it and ask before calling set_setting.',
    ].join('\n')),
  },
  {
    name: 'explain_last_crash',
    title: 'Explain the last crash',
    description: 'Find the newest crash report, explain the cause in plain language, and suggest a fix.',
    arguments: [],
    build: () => userMsg([
      'My server crashed. Explain why in plain language.',
      'Steps:',
      '1. Call explain_crash (it reads the newest crash report).',
      '2. Summarise the cause for a non-expert: what mod/jar or config is responsible, and the chain of events.',
      '3. Suggest the concrete next step (update/remove a mod, raise memory, change a setting).',
      '4. If relevant, also call analyze_console or check_mod_compat to confirm.',
    ].join('\n')),
  },
  {
    name: 'set_up_paper_for_players',
    title: 'Set up a Paper server',
    description: 'Walk me through preparing a Paper server for a given player count.',
    arguments: [
      { name: 'players', description: 'expected number of players', required: false },
    ],
    build: (a) => userMsg([
      'Help me get a Paper server ready.',
      a && a.players ? `It should handle about ${a.players} players.` : 'It is for a small group.',
      'Note: creating a NEW server folder and choosing the software is GUI-only (I cannot set serverPath over MCP).',
      'Steps:',
      '1. Read get_status + get_settings to see the current folder, Java and memory.',
      '2. Recommend the Minecraft version, memory and key server.properties (view-distance, simulation-distance, max-players) for that player count.',
      '3. Use validate_config to sanity-check the properties, and check_performance after it is running.',
      '4. For any change, tell me first and wait for confirmation before writing it.',
    ].join('\n')),
  },
  {
    name: 'audit_mods',
    title: 'Audit installed mods/plugins',
    description: 'Scan installed content for wrong-loader jars, missing dependencies and conflicts.',
    arguments: [],
    build: () => userMsg([
      'Audit my installed mods and plugins for problems.',
      'Steps:',
      '1. Call list_content and check_mod_compat.',
      '2. Group the findings: wrong loader, client-only mods, missing required dependencies, declared conflicts.',
      '3. For each problem, name the file and the concrete fix (install dependency X, remove Y, disable Z).',
      '4. Offer to fix what is safe (toggle_content / install_from_market) and wait for confirmation.',
    ].join('\n')),
  },
  {
    name: 'safe_modpack_install',
    title: 'Install a modpack safely',
    description: 'Search, resolve a plan, show it to me, then install a modpack in one confirmed batch.',
    arguments: [
      { name: 'query', description: 'modpack name or topic to search for', required: true },
    ],
    build: (a) => userMsg([
      `I want to install a modpack: ${(a && a.query) || '(describe the pack)'}.`,
      'Steps:',
      '1. search_modpacks for it (use the server MC version if known from get_status).',
      '2. plan_modpack to resolve the exact version + dependencies, and show me the plan and any compatibility warnings.',
      '3. Do NOT install anything yet — wait for my confirmation.',
      '4. On my yes, call assemble_modpack with the planned items, then create_backup if the server has a world already.',
    ].join('\n')),
  },
];

function getPrompt(name) { return PROMPTS.find(p => p.name === name) || null; }
// The list form an MCP client sees (no build function).
function promptList() {
  return PROMPTS.map(p => ({ name: p.name, title: p.title, description: p.description, arguments: p.arguments }));
}

module.exports = { PROMPTS, getPrompt, promptList };
