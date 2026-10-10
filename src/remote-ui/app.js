// app.js — the Remote web dashboard. No framework, no bundler (matches the project's plain-script
// ethos). Talks to the SAME remote API the CLI uses: /status, /console, /players, /instances,
// /command. The token is pasted once (from the app's Reveal/Copy) and kept in localStorage; it is
// NEVER put in the URL. i18n is self-contained (7 locales) because this standalone page cannot load
// the app's renderer locale files.
(function () {
  const LOCALES = {
    en: { title: 'Remote', status: 'Status', playersTitle: 'Players', consoleTitle: 'Console',
      commandTitle: 'Command', commandHint: 'Single line', autoRefresh: 'Auto', refresh: 'Refresh',
      send: 'Send', forget: 'Forget token', gateHint: 'Paste your remote token to continue.',
      connect: 'Connect', online: 'Online', whitelist: 'Whitelist', banned: 'Banned', ops: 'Ops',
      running: 'Running', stopped: 'Stopped', starting: 'Starting', stopping: 'Stopping',
      software: 'Software', java: 'Java', path: 'Folder', tps: 'TPS', uptime: 'Uptime',
      badToken: 'That token was not accepted.', netErr: 'Could not reach the server.',
      sent: 'Command sent.', emptyConsole: 'No console output yet.', readOnlyHint: 'Read-only mode is on.',
      noFolder: 'No server folder selected for this instance.',
      start: 'Start', stop: 'Stop', restart: 'Restart', kick: 'Kick',
      confirmStop: 'Stop the server?', confirmRestart: 'Restart the server?', confirmKick: 'Kick {n}?',
      actionDone: 'Done.', actionFailed: 'Action failed.' },
    vi: { title: 'Từ xa', status: 'Trạng thái', playersTitle: 'Người chơi', consoleTitle: 'Console',
      commandTitle: 'Lệnh', commandHint: 'Một dòng', autoRefresh: 'Tự động', refresh: 'Tải lại',
      send: 'Gửi', forget: 'Quên token', gateHint: 'Dán token từ xa để tiếp tục.',
      connect: 'Kết nối', online: 'Đang online', whitelist: 'Whitelist', banned: 'Bị ban', ops: 'Ops',
      running: 'Đang chạy', stopped: 'Đã dừng', starting: 'Đang khởi động', stopping: 'Đang dừng',
      software: 'Phần mềm', java: 'Java', path: 'Thư mục', tps: 'TPS', uptime: 'Thời gian chạy',
      badToken: 'Token không được chấp nhận.', netErr: 'Không kết nối được server.',
      sent: 'Đã gửi lệnh.', emptyConsole: 'Chưa có output console.', readOnlyHint: 'Đang bật chế độ chỉ đọc.',
      noFolder: 'Instance này chưa chọn thư mục server.',
      start: 'Khởi động', stop: 'Dừng', restart: 'Khởi động lại', kick: 'Đuổi',
      confirmStop: 'Dừng server?', confirmRestart: 'Khởi động lại server?', confirmKick: 'Đuổi {n}?',
      actionDone: 'Xong.', actionFailed: 'Thao tác thất bại.' },
    es: { title: 'Remoto', status: 'Estado', playersTitle: 'Jugadores', consoleTitle: 'Consola',
      commandTitle: 'Comando', commandHint: 'Una línea', autoRefresh: 'Auto', refresh: 'Recargar',
      send: 'Enviar', forget: 'Olvidar token', gateHint: 'Pega tu token remoto para continuar.',
      connect: 'Conectar', online: 'En línea', whitelist: 'Lista blanca', banned: 'Baneados', ops: 'Ops',
      running: 'En ejecución', stopped: 'Detenido', starting: 'Iniciando', stopping: 'Deteniendo',
      software: 'Software', java: 'Java', path: 'Carpeta', tps: 'TPS', uptime: 'Activo',
      badToken: 'Ese token no fue aceptado.', netErr: 'No se pudo contactar al servidor.',
      sent: 'Comando enviado.', emptyConsole: 'Aún sin salida de consola.', readOnlyHint: 'El modo solo lectura está activo.',
      noFolder: 'Esta instancia no tiene carpeta de servidor.',
      start: 'Iniciar', stop: 'Detener', restart: 'Reiniciar', kick: 'Expulsar',
      confirmStop: '¿Detener el servidor?', confirmRestart: '¿Reiniciar el servidor?', confirmKick: '¿Expulsar a {n}?',
      actionDone: 'Hecho.', actionFailed: 'La acción falló.' },
    'pt-BR': { title: 'Remoto', status: 'Status', playersTitle: 'Jogadores', consoleTitle: 'Console',
      commandTitle: 'Comando', commandHint: 'Uma linha', autoRefresh: 'Auto', refresh: 'Atualizar',
      send: 'Enviar', forget: 'Esquecer token', gateHint: 'Cole seu token remoto para continuar.',
      connect: 'Conectar', online: 'Online', whitelist: 'Whitelist', banned: 'Banidos', ops: 'Ops',
      running: 'Rodando', stopped: 'Parado', starting: 'Iniciando', stopping: 'Parando',
      software: 'Software', java: 'Java', path: 'Pasta', tps: 'TPS', uptime: 'Ativo',
      badToken: 'Esse token não foi aceito.', netErr: 'Não foi possível acessar o servidor.',
      sent: 'Comando enviado.', emptyConsole: 'Ainda sem saída do console.', readOnlyHint: 'O modo somente leitura está ativo.',
      noFolder: 'Esta instância não tem pasta de servidor.',
      start: 'Iniciar', stop: 'Parar', restart: 'Reiniciar', kick: 'Expulsar',
      confirmStop: 'Parar o servidor?', confirmRestart: 'Reiniciar o servidor?', confirmKick: 'Expulsar {n}?',
      actionDone: 'Pronto.', actionFailed: 'A ação falhou.' },
    de: { title: 'Fern', status: 'Status', playersTitle: 'Spieler', consoleTitle: 'Konsole',
      commandTitle: 'Befehl', commandHint: 'Eine Zeile', autoRefresh: 'Auto', refresh: 'Neu laden',
      send: 'Senden', forget: 'Token vergessen', gateHint: 'Füge dein Remote-Token ein, um fortzufahren.',
      connect: 'Verbinden', online: 'Online', whitelist: 'Whitelist', banned: 'Gebannt', ops: 'Ops',
      running: 'Läuft', stopped: 'Gestoppt', starting: 'Startet', stopping: 'Stoppt',
      software: 'Software', java: 'Java', path: 'Ordner', tps: 'TPS', uptime: 'Laufzeit',
      badToken: 'Dieses Token wurde nicht akzeptiert.', netErr: 'Server nicht erreichbar.',
      sent: 'Befehl gesendet.', emptyConsole: 'Noch keine Konsolenausgabe.', readOnlyHint: 'Der Nur-Lesen-Modus ist aktiv.',
      noFolder: 'Für diese Instanz ist kein Serverordner gewählt.',
      start: 'Starten', stop: 'Stoppen', restart: 'Neustart', kick: 'Kicken',
      confirmStop: 'Server stoppen?', confirmRestart: 'Server neu starten?', confirmKick: '{n} kicken?',
      actionDone: 'Erledigt.', actionFailed: 'Aktion fehlgeschlagen.' },
    ru: { title: 'Удалённо', status: 'Статус', playersTitle: 'Игроки', consoleTitle: 'Консоль',
      commandTitle: 'Команда', commandHint: 'Одна строка', autoRefresh: 'Авто', refresh: 'Обновить',
      send: 'Отправить', forget: 'Забыть токен', gateHint: 'Вставьте удалённый токен, чтобы продолжить.',
      connect: 'Подключить', online: 'Онлайн', whitelist: 'Белый список', banned: 'Забанены', ops: 'Опы',
      running: 'Работает', stopped: 'Остановлен', starting: 'Запуск', stopping: 'Остановка',
      software: 'Софт', java: 'Java', path: 'Папка', tps: 'TPS', uptime: 'Время работы',
      badToken: 'Этот токен не принят.', netErr: 'Не удалось связаться с сервером.',
      sent: 'Команда отправлена.', emptyConsole: 'Пока нет вывода консоли.', readOnlyHint: 'Включён режим только чтения.',
      noFolder: 'Для этого сервера не выбрана папка.',
      start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить', kick: 'Кикнуть',
      confirmStop: 'Остановить сервер?', confirmRestart: 'Перезапустить сервер?', confirmKick: 'Кикнуть {n}?',
      actionDone: 'Готово.', actionFailed: 'Действие не удалось.' },
    'zh-CN': { title: '远程', status: '状态', playersTitle: '玩家', consoleTitle: '控制台',
      commandTitle: '命令', commandHint: '单行', autoRefresh: '自动', refresh: '刷新',
      send: '发送', forget: '清除令牌', gateHint: '粘贴远程令牌以继续。',
      connect: '连接', online: '在线', whitelist: '白名单', banned: '封禁', ops: '管理员',
      running: '运行中', stopped: '已停止', starting: '启动中', stopping: '停止中',
      software: '软件', java: 'Java', path: '文件夹', tps: 'TPS', uptime: '运行时长',
      badToken: '该令牌未被接受。', netErr: '无法连接到服务器。',
      sent: '命令已发送。', emptyConsole: '暂无控制台输出。', readOnlyHint: '只读模式已开启。',
      noFolder: '该实例尚未选择服务器文件夹。',
      start: '启动', stop: '停止', restart: '重启', kick: '踢出',
      confirmStop: '停止服务器？', confirmRestart: '重启服务器？', confirmKick: '踢出 {n}？',
      actionDone: '已完成。', actionFailed: '操作失败。' }
  };
  const $ = s => document.querySelector(s);
  // Escape & < > AND quotes — player names go into HTML attributes (data-kick="..."), so an
  // unescaped quote could break out of the attribute (self-XSS from the user's own whitelist file).
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // pick a locale: exact match, then base language, else English.
  const nav = (navigator.language || 'en');
  const base = nav.toLowerCase();
  let lang = Object.keys(LOCALES).find(k => k.toLowerCase() === base)
    || Object.keys(LOCALES).find(k => k.toLowerCase().split('-')[0] === base.split('-')[0])
    || 'en';
  const t = k => (LOCALES[lang] && LOCALES[lang][k]) || LOCALES.en[k] || k;

  function applyLocale() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    const sel = $('#langSel');
    if (sel) sel.value = lang;
  }

  function buildLangSelect() {
    const sel = $('#langSel'); if (!sel) return;
    sel.innerHTML = Object.keys(LOCALES).map(k => `<option value="${k}">${k}</option>`).join('');
    sel.value = lang;
    sel.onchange = () => { lang = sel.value; applyLocale(); render(); };
  }

  let token = '';
  let state = {};
  let readOnly = true;
  let instances = [];
  let activeInst = '';
  let timer = null;
  let autoInstTimer = null;

  const authHeaders = () => ({ authorization: 'Bearer ' + token });
  const withInst = (path) => path + (activeInst ? (path.includes('?') ? '&' : '?') + 'instance=' + encodeURIComponent(activeInst) : '');

  async function api(path, opts) {
    const res = await fetch(path, { ...(opts || {}), headers: { ...authHeaders(), ...((opts && opts.headers) || {}) } });
    let body = {};
    try { body = await res.json(); } catch {}
    return { status: res.status, body };
  }

  function showGate(msg) {
    $('#gate').hidden = false;
    $('#app').hidden = true;
    const e = $('#gateErr');
    if (msg) { e.hidden = false; e.textContent = msg; } else { e.hidden = true; }
    $('#tokenInput').value = '';
    if (timer) { clearInterval(timer); timer = null; }
    if (autoInstTimer) { clearInterval(autoInstTimer); autoInstTimer = null; }
  }

  async function connect() {
    const cfg = await api('/ui/config');
    // Only a 401 means the token is wrong -> show the gate. A transient 429/500/network blip must
    // NOT kick the user back to the token screen (that was the "gate reappears" bug).
    if (cfg.status === 401) return showGate(t('badToken'));
    if (cfg.status !== 200) return showGate(t('netErr'));
    readOnly = cfg.body && cfg.body.data ? cfg.body.data.readOnly !== false : true;
    $('#gate').hidden = true;
    $('#app').hidden = false;
    await refreshInstances();
    await loadAll();
    startAuto();
  }

  // Fetch the instance list WITHOUT clobbering it on a transient failure (a 429 while polling used
  // to empty the list and remove the picker mid-use).
  async function refreshInstances() {
    try {
      const inst = await api('/instances');
      if (inst.status === 200) instances = (inst.body && inst.body.data && inst.body.data.instances) || [];
    } catch {}
    if (instances.length && !instances.some(i => i.id === activeInst)) activeInst = instances[0].id;
    renderInstancePicker();
  }

  function renderInstancePicker() {
    let picker = $('#instPicker');
    if (!picker) {
      picker = document.createElement('select');
      picker.id = 'instPicker'; picker.className = 'sel';
      const right = document.querySelector('.top-right');
      if (right) right.insertBefore(picker, right.firstChild);
      picker.onchange = () => { activeInst = picker.value; loadAll(); };
    }
    // With 0 or 1 server the picker is pointless, but it stays in the DOM (hidden) so a transient
    // empty list never makes it flicker in and out. The instance choice itself is preserved.
    picker.hidden = instances.length < 2;
    if (instances.length < 2) return;
    picker.innerHTML = instances.map(i => `<option value="${esc(i.id)}">${esc(i.name || i.id)}</option>`).join('');
    picker.value = activeInst;
  }

  async function loadAll() {
    const st = await api(withInst('/status'));
    // Auth is the ONLY reason to re-show the gate. 429/500/offline keep the last good view.
    if (st.status === 401) return showGate(t('badToken'));
    if (st.status !== 200) return;
    state = (st.body && st.body.data && st.body.data.result) || {};
    renderStatus(); updateCmdCard();
    // console/players need a server FOLDER; calling them with none just 500s (and used to spam the
    // app log every few seconds). Skip them and show a hint instead.
    if (!state.serverPath) {
      renderPlayers({});
      $('#console').textContent = t('noFolder');
      return;
    }
    const [pl, co] = await Promise.all([api(withInst('/players')), api(withInst('/console?lines=200'))]);
    if (pl.status === 200) renderPlayers((pl.body && pl.body.data && pl.body.data.result) || {});
    if (co.status === 200) renderConsole((co.body && co.body.data && co.body.data.result) || {});
  }

  function renderStatus() {
    const running = !!state.running;
    const pill = $('#statePill');
    const label = { starting: t('starting'), running: t('running'), stopping: t('stopping'), stopped: t('stopped') }[state.status || (running ? 'running' : 'stopped')] || t('stopped');
    pill.textContent = label;
    pill.className = 'pill' + (state.status === 'running' || running ? ' on' : '');
    const dot = $('#statusDot');
    dot.className = 'dot ' + (state.status === 'running' || running ? 'on' : 'off');
    const rows = [
      [t('software'), state.software || (state.jar || '')],
      [t('java'), (state.java && state.java.version) || (state.javaRequired ? ('needs ' + state.javaRequired) : '')],
      [t('path'), state.serverPath || '']
    ];
    $('#statusKv').innerHTML = rows.filter(r => r[1]).map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('');
  }

  function renderPlayers(p) {
    const groups = [['online', t('online')], ['whitelist', t('whitelist')], ['banned', t('banned')], ['ops', t('ops')]];
    $('#playerCount').textContent = (p.online || []).length;
    const html = groups.map(([key, label]) => {
      const list = Array.isArray(p[key]) ? p[key] : [];
      if (!list.length) return '';
      const names = list.map(x => {
        const nm = typeof x === 'string' ? x : (x.name || '');
        const kick = (key === 'online' && !readOnly) ? `<button class="pl-kick" data-kick="${esc(nm)}">${esc(t('kick'))}</button>` : '';
        return `<span class="pl">${esc(nm)}${kick}</span>`;
      }).join('');
      return `<div class="pl-group"><b>${esc(label)} (${list.length})</b><div class="pl-list">${names}</div></div>`;
    }).join('');
    $('#players').innerHTML = html || `<p class="muted">-</p>`;
  }

  function renderConsole(c) {
    const lines = Array.isArray(c.lines) ? c.lines : [];
    const box = $('#console');
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
    box.textContent = lines.length ? lines.join('\n') : t('emptyConsole');
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function updateCmdCard() {
    // The command box AND the action buttons are gated by the same Read-only switch.
    $('#cmdCard').hidden = readOnly;
    $('#actions').hidden = readOnly;
  }

  // A tiny toast so an action result is VISIBLE (the old code swallowed a {ok:false} envelope whose
  // HTTP status was still 200, so Start looked dead with no message).
  let toastTimer = null;
  function toast(msg, kind) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = String(msg);
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }
  const errText = (body) => {
    const d = (body && body.data) || {};
    return (d && d.error) || (body && body.error) || t('actionFailed');
  };

  // 4.4.0: the four safe remote actions. Whitelisted client-side too; the server re-validates.
  async function runAction(action, name, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    const r = await api('/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, name: name || '', instance: activeInst }) });
    if (r.status === 403) { updateCmdCard(); toast(t('readOnlyHint'), 'err'); return; }
    // The handler wraps its own result: {ok:true,data:{ok:false,error}} on refusal.
    const inner = (r.body && r.body.data) || {};
    if (r.status !== 200 || inner.ok === false) { toast(errText(r.body), 'err'); return; }
    toast(t('actionDone'), 'ok');
    loadAll();
  }

  function startAuto() {
    if (timer) clearInterval(timer);
    // Gentle poll; also skip while the tab is hidden (a background tab should not spend the budget).
    timer = setInterval(() => {
      if (document.hidden) return;
      if ($('#autoRefresh').checked) loadAll();
    }, 4000);
    // Refresh the instance list occasionally too (cheap) so a newly added server shows up.
    if (autoInstTimer) clearInterval(autoInstTimer);
    autoInstTimer = setInterval(() => { if (!document.hidden) refreshInstances(); }, 15000);
  }

  // wire up
  buildLangSelect();
  applyLocale();
  const saved = localStorage.getItem('olRemoteToken');
  if (saved) { token = saved; connect(); } else { showGate(); }

  $('#gateForm').onsubmit = (e) => {
    e.preventDefault();
    token = $('#tokenInput').value.trim();
    if (!token) return;
    localStorage.setItem('olRemoteToken', token);
    connect();
  };
  $('#forgetBtn').onclick = () => { localStorage.removeItem('olRemoteToken'); token = ''; showGate(); };
  $('#refreshBtn').onclick = () => loadAll();
  $('#actStart').onclick = () => runAction('start');
  $('#actStop').onclick = () => runAction('stop', '', t('confirmStop'));
  $('#actRestart').onclick = () => runAction('restart', '', t('confirmRestart'));
  // Delegated kick handler (player chips are rebuilt on every refresh).
  $('#players').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kick]');
    if (b) runAction('kick', b.dataset.kick, t('confirmKick').replace('{n}', b.dataset.kick));
  });
  $('#cmdForm').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#cmdInput');
    const cmd = input.value.trim();
    if (!cmd) return;
    const r = await api('/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: cmd, instance: activeInst }) });
    if (r.status === 403) { updateCmdCard(); toast(t('readOnlyHint'), 'err'); return; }
    const inner = (r.body && r.body.data) || {};
    if (r.status !== 200 || inner.ok === false) { toast(errText(r.body), 'err'); return; }
    input.value = ''; loadAll();
  };
})();
