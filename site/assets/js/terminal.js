// terminal module — interactive fake terminal in hero
const TERM_LINES = {
  help: 'commands: start · stop · backup · tps · plugins · ls · java · whoami · help · clear',
  start: 'downloading purpur-1.21.4.jar · installing java 21 · opening port 25565 · server started on 0.0.0.0:25565',
  stop: 'server stopped · 0 players online · world saved.',
  backup: 'zipping world (save-off) · wrote backups/world-2026-08-26.zip · save-on',
  tps: 'last 1m: 20.00 · 5m: 19.98 · 15m: 19.94',
  plugins: 'installed: EssentialsX 2.21, LuckPerms 5.4, WorldGuard 7.0',
  ls: 'world/  plugins/  backups/  server.properties  purpur-1.21.4.jar',
  java: 'openjdk 21.0.2 (auto-installed) · required for 1.21.4: 21',
  whoami: 'observer@localhost · no account · no telemetry',
  welcome: 'ObserverLauncher v0.1.0-alpha · type a command or pick one below.',
  unknown: 'unknown command. type "help" for a list.'
};

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initTerminal() {
  const body = document.getElementById('termBody');
  if (!body) return;

  function appendLine(text, cls = '') {
    const line = document.createElement('div');
    line.className = 'term-line' + (cls ? ' ' + cls : '');
    line.innerHTML = `<span class="p">❯</span><span class="c">${text}</span>`;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
  }

  function appendLineTyped(text, cls = '', speed = 22) {
    return new Promise(resolve => {
      const line = document.createElement('div');
      line.className = 'term-line' + (cls ? ' ' + cls : '');
      line.innerHTML = `<span class="p">❯</span><span class="c"></span>`;
      body.appendChild(line);
      const out = line.querySelector('.c');
      let i = 0;
      const tick = () => {
        if (i > text.length) return resolve();
        out.textContent = text.slice(0, i);
        body.scrollTop = body.scrollHeight;
        i++;
        setTimeout(tick, speed);
      };
      tick();
    });
  }

  function renderSuggest() {
    const suggest = body.querySelector('.term-suggest');
    if (suggest) suggest.remove();
    const wrap = document.createElement('div');
    wrap.className = 'term-suggest';
    ['start', 'tps', 'plugins', 'backup'].forEach(cmd => {
      const btn = document.createElement('button');
      btn.textContent = cmd;
      btn.addEventListener('click', () => runCommand(cmd));
      wrap.appendChild(btn);
    });
    body.appendChild(wrap);
  }

  async function runCommand(cmd, { typed = true } = {}) {
    if (typed) {
      await appendLineTyped(cmd, 'ok', 34);
    } else {
      appendLine(cmd, 'ok');
    }
    const key = cmd.trim().toLowerCase();
    if (key === 'clear') {
      body.innerHTML = '';
      return;
    }
    let output = TERM_LINES[key];
    if (key === 'help' || output) {
      if (typed) {
        await appendLineTyped(output || TERM_LINES.help, '', 14);
      } else {
        appendLine(output || TERM_LINES.help);
      }
    } else {
      if (typed) {
        await appendLineTyped(TERM_LINES.unknown, 'w', 18);
      } else {
        appendLine(TERM_LINES.unknown, 'w');
      }
    }
    renderSuggest();
  }

  body.innerHTML = '';
  if (prefersReducedMotion) {
    appendLine(TERM_LINES.welcome);
    renderSuggest();
  } else {
    setTimeout(async () => {
      await appendLineTyped(TERM_LINES.welcome, '', 16);
      renderSuggest();
      // Auto-demo: run a few commands with pauses for a living terminal feel.
      await new Promise(r => setTimeout(r, 900));
      await runCommand('tps', { typed: true });
      await new Promise(r => setTimeout(r, 1300));
      await runCommand('plugins', { typed: true });
    }, 700);
  }

  const input = document.createElement('div');
  input.className = 'term-input';
  input.innerHTML = `<span class="p">❯</span><input type="text" placeholder="type a command..." aria-label="Type a command">`;
  body.appendChild(input);
  const inputEl = input.querySelector('input');
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const cmd = inputEl.value.trim();
      if (cmd) {
        input.remove();
        runCommand(cmd);
        body.appendChild(input);
        inputEl.value = '';
        inputEl.focus();
      }
    }
  });
  inputEl.focus();
}
