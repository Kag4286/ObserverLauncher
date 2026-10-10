// MCP resources (v5.0.0). SINGLE SOURCE OF TRUTH for both the static resource list and the
// RFC 6570 resource TEMPLATES — the bridge (offline fallback) and the server (resolver) both read
// from here, so they cannot drift (the old code had a hardcoded list in bridge.js AND a switch in
// server.js). Pure data + one resolver; no I/O except the delegate `call`.

// Static (fixed-URI) resources an AI can read for context without a tool call.
const STATIC_RESOURCES = [
  { uri: 'observer://server/status', name: 'Server status', description: 'Folder, jar, software, Java, running state.', mimeType: 'application/json' },
  { uri: 'observer://server/properties', name: 'server.properties', description: 'Parsed server.properties.', mimeType: 'application/json' },
  { uri: 'observer://server/console', name: 'Console buffer', description: 'Recent console lines.', mimeType: 'application/json' },
  { uri: 'observer://server/diagnosis', name: 'Health diagnosis', description: 'The doctor health check result.', mimeType: 'application/json' },
  { uri: 'observer://metrics/history', name: 'Metrics history', description: 'Sampled metrics time series (tps/mspt/cpu/ram/players).', mimeType: 'application/json' },
  { uri: 'observer://console/tail', name: 'Console tail', description: 'Last 200 console lines.', mimeType: 'application/json' },
  { uri: 'observer://world/players', name: 'Players', description: 'Online, whitelisted, banned, op and known players.', mimeType: 'application/json' },
  { uri: 'observer://instances', name: 'Instances', description: 'Every server instance (id, name, path, status, active).', mimeType: 'application/json' },
];

// Resource TEMPLATES (RFC 6570). Each maps a concrete URI to an existing read tool + args.
// {uriTemplate, name, description, mimeType, match(uri) -> {tool, args} | null}
const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'observer://instance/{id}/status',
    name: 'Instance status',
    description: 'Status of ONE instance by id (without making it active).',
    mimeType: 'application/json',
    match: (uri) => { const m = uri.match(/^observer:\/\/instance\/([^/]+)\/status$/); return m ? { tool: 'get_instance_snapshot', args: { instance: decodeURIComponent(m[1]) } } : null; },
  },
  {
    uriTemplate: 'observer://instance/{id}/console',
    name: 'Instance console',
    description: 'Console tail of ONE instance by id.',
    mimeType: 'application/json',
    match: (uri) => { const m = uri.match(/^observer:\/\/instance\/([^/]+)\/console$/); return m ? { tool: 'get_instance_snapshot', args: { instance: decodeURIComponent(m[1]), lines: 200 } } : null; },
  },
  {
    uriTemplate: 'observer://instance/{id}/metrics',
    name: 'Instance metrics',
    description: 'Metrics history of ONE instance by id.',
    mimeType: 'application/json',
    match: (uri) => { const m = uri.match(/^observer:\/\/instance\/([^/]+)\/metrics$/); return m ? { tool: 'get_instance_snapshot', args: { instance: decodeURIComponent(m[1]) } } : null; },
  },
  {
    uriTemplate: 'observer://file/{path}',
    name: 'Server file',
    description: 'Read a text file inside the server folder (path-safe).',
    mimeType: 'text/plain',
    match: (uri) => { const m = uri.match(/^observer:\/\/file\/(.+)$/); return m ? { tool: 'read_file', args: { path: decodeURIComponent(m[1]) } } : null; },
  },
];

// Resolve a concrete URI against the static list first, then the templates. Returns
// { tool, args } or null when nothing matches.
function resolveResource(uri) {
  const STATIC_MAP = {
    'observer://server/status': { tool: 'get_status', args: {} },
    'observer://server/properties': { tool: 'get_properties', args: {} },
    'observer://server/console': { tool: 'read_console', args: {} },
    'observer://server/diagnosis': { tool: 'diagnose_server', args: {} },
    'observer://metrics/history': { tool: 'get_metrics_history', args: {} },
    'observer://console/tail': { tool: 'read_console', args: { lines: 200 } },
    'observer://world/players': { tool: 'list_players', args: {} },
    'observer://instances': { tool: 'list_instances', args: {} },
  };
  if (STATIC_MAP[uri]) return STATIC_MAP[uri];
  for (const t of RESOURCE_TEMPLATES) { const hit = t.match(uri); if (hit) return hit; }
  return null;
}

module.exports = { STATIC_RESOURCES, RESOURCE_TEMPLATES, resolveResource };
