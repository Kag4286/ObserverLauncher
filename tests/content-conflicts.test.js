// Unit tests for scanContentConflicts (v6.1.0).
// Verifies detection of duplicate mods, loader mismatches, missing deps, incompatibilities, and client-only mods.
const assert = require('assert');
const path = require('path');
const Module = require('module');

let pass = 0;
function ok(name, cond, detail) {
  assert(cond, `FAIL: ${name}${detail ? ' -> ' + detail : ''}`);
  console.log(`PASS ${name}`);
  pass++;
}

// Mock openJar to avoid real zip creation on disk
const mockJars = {};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './jar-read.js' && parent && parent.filename && parent.filename.endsWith('content-conflicts.js')) {
    return {
      openJar: (filePath) => {
        const base = path.basename(filePath);
        if (mockJars[base]) {
          return {
            read: (entry) => {
              const res = mockJars[base][entry];
              if (res != null) return { ok: true, content: res };
              return { ok: false };
            },
          };
        }
        throw new Error(`Mock jar not found: ${base}`);
      },
    };
  }
  return origLoad.apply(this, arguments);
};

const { scanContentConflicts } = require('../src/main/content-conflicts.js');

(async () => {
  // 1. All clean scenario
  {
    mockJars['cloth-config-1.0.jar'] = {
      'META-INF/neoforge.mods.toml': 'modId="cloth_config"\nversion="1.0"\n',
    };
    mockJars['jei-1.0.jar'] = {
      'META-INF/neoforge.mods.toml': 'modId="jei"\nversion="1.0"\n[[dependencies.jei]]\nmodId="cloth_config"\nmandatory=true\n',
    };

    const res = await scanContentConflicts('/mock/root', {
      files: { mods: ['cloth-config-1.0.jar', 'jei-1.0.jar'], plugins: [] },
      server: { mc: '1.21.1', loader: 'neoforge' },
    });

    ok('clean mods return ok=true', res.ok === true);
    ok('no issues in clean scan', res.issues.length === 0);
    ok('scannedCount matches', res.scannedCount === 2);
  }

  // 2. Duplicate mod detection (same modId in two different jars)
  {
    mockJars['jei-v1.jar'] = {
      'META-INF/neoforge.mods.toml': 'modId="jei"\nversion="1.0"\n',
    };
    mockJars['jei-v2.jar'] = {
      'META-INF/neoforge.mods.toml': 'modId="jei"\nversion="2.0"\n',
    };

    const res = await scanContentConflicts('/mock/root', {
      files: { mods: ['jei-v1.jar', 'jei-v2.jar'], plugins: [] },
      server: { mc: '1.21.1', loader: 'neoforge' },
    });

    ok('duplicates report ok=false', res.ok === false);
    ok('duplicate found in duplicates array', res.duplicates.length === 1 && res.duplicates[0].id === 'jei');
    ok('duplicate lists both files', res.duplicates[0].files.includes('jei-v1.jar') && res.duplicates[0].files.includes('jei-v2.jar'));
    const dupIssues = res.issues.filter(i => i.type === 'duplicate');
    ok('duplicate issues recorded for both files', dupIssues.length === 2);
  }

  // 3. Loader mismatch (Fabric jar in a NeoForge server)
  {
    mockJars['fabric-mod.jar'] = {
      'fabric.mod.json': JSON.stringify({ id: 'fabric_only', version: '1.0' }),
    };

    const res = await scanContentConflicts('/mock/root', {
      files: { mods: ['fabric-mod.jar'], plugins: [] },
      server: { mc: '1.21.1', loader: 'neoforge' },
    });

    ok('loader mismatch reports ok=false', res.ok === false);
    const mm = res.issues.find(i => i.type === 'loader-mismatch');
    ok('loader mismatch issue identified', !!mm && mm.declaredLoader === 'fabric' && mm.serverLoader === 'neoforge');
  }

  // 4. Missing required dependency
  {
    mockJars['requires-dep.jar'] = {
      'META-INF/neoforge.mods.toml': 'modId="my_mod"\nversion="1.0"\n[[dependencies.my_mod]]\nmodId="missing_library"\nmandatory=true\n',
    };

    const res = await scanContentConflicts('/mock/root', {
      files: { mods: ['requires-dep.jar'], plugins: [] },
      server: { mc: '1.21.1', loader: 'neoforge' },
    });

    ok('missing dependency reports ok=false', res.ok === false);
    ok('missingDependencies array populated', res.missingDependencies.length === 1 && res.missingDependencies[0].modId === 'missing_library');
    const mi = res.issues.find(i => i.type === 'missing-dep');
    ok('missing-dep issue details set', !!mi && mi.requiredModId === 'missing_library');
  }

  // 5. Incompatibility / conflict
  {
    mockJars['mod-a.jar'] = {
      'META-INF/neoforge.mods.toml': 'modId="mod_a"\nversion="1.0"\n[[dependencies.mod_a]]\nmodId="mod_b"\ntype="incompatible"\nreason="Cannot co-exist"\n',
    };
    mockJars['mod-b.jar'] = {
      'META-INF/neoforge.mods.toml': 'modId="mod_b"\nversion="1.0"\n',
    };

    const res = await scanContentConflicts('/mock/root', {
      files: { mods: ['mod-a.jar', 'mod-b.jar'], plugins: [] },
      server: { mc: '1.21.1', loader: 'neoforge' },
    });

    ok('conflict reports ok=false', res.ok === false);
    ok('conflicts array contains conflict with mod_b', res.conflicts.length === 1 && res.conflicts[0].modId === 'mod_b');
    const ci = res.issues.find(i => i.type === 'conflict');
    ok('conflict issue has reason', !!ci && ci.conflictingModId === 'mod_b' && ci.reason === 'Cannot co-exist');
  }

  // 6. Client-only mod detection
  {
    mockJars['client-hud.jar'] = {
      'fabric.mod.json': JSON.stringify({ id: 'client_hud', version: '1.0', environment: 'client' }),
    };

    const res = await scanContentConflicts('/mock/root', {
      files: { mods: ['client-hud.jar'], plugins: [] },
      server: { mc: '1.21.1', loader: 'fabric' },
    });

    const co = res.issues.find(i => i.type === 'client-only');
    ok('client-only mod recognized', !!co && co.fileName === 'client-hud.jar');
  }

  // 7. Cross-patch compatible mod (1.16.4 mod on 1.16.5 server) -> NO mc-incompatible issue
  {
    mockJars['appleskin-mc1.16.4.jar'] = {
      'META-INF/mods.toml': 'modId="appleskin"\nversion="0.8.1"\n[[dependencies.appleskin]]\nmodId="minecraft"\nmandatory=true\nversionRange="[1.16.4, 1.16.5]"\n',
    };

    const res = await scanContentConflicts('/mock/root', {
      files: { mods: ['appleskin-mc1.16.4.jar'], plugins: [] },
      server: { mc: '1.16.5', loader: 'forge' },
    });

    ok('1.16.4 mod with [1.16.4, 1.16.5] range on 1.16.5 server has ok=true', res.ok === true);
    ok('no mc-incompatible issue for 1.16.4 mod on 1.16.5 server', !res.issues.some(i => i.type === 'mc-incompatible'));
  }

  // 8. Incompatible mod (mod declares 1.18 on 1.20.1 server)
  {
    mockJars['old-mod-1.18.jar'] = {
      'META-INF/mods.toml': 'modId="old_mod"\nversion="1.0"\n[[dependencies.old_mod]]\nmodId="minecraft"\nmandatory=true\nversionRange="[1.18, 1.19)"\n',
    };

    const res = await scanContentConflicts('/mock/root', {
      files: { mods: ['old-mod-1.18.jar'], plugins: [] },
      server: { mc: '1.20.1', loader: 'forge' },
    });

    ok('1.18 mod on 1.20.1 server reports ok=false', res.ok === false);
    const mi = res.issues.find(i => i.type === 'mc-incompatible');
    ok('mc-incompatible issue found', !!mi && mi.serverMc === '1.20.1');
  }

  console.log(`\n${pass} passed, 0 failed`);
})();
