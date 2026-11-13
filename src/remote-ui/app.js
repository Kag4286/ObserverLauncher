// app.js — the Remote web dashboard 2.0. No framework, no bundler.
// Connects via Bearer-authenticated fetch + SSE live stream (/events) with automatic 4s polling fallback.
(function () {
  const LOCALES = {
    en: { title: 'Remote', status: 'Status', playersTitle: 'Players', consoleTitle: 'Console',
      commandTitle: 'Command', commandHint: 'Single line', autoRefresh: 'Auto', refresh: 'Refresh',
      send: 'Send', forget: 'Forget token', gateHint: 'Paste your remote token to continue.',
      connect: 'Connect', online: 'Online', whitelist: 'Whitelist', banned: 'Banned', ops: 'Ops',
      running: 'Running', stopped: 'Stopped', starting: 'Starting', stopping: 'Stopping',
      software: 'Software', java: 'Java', path: 'Folder', tps: 'TPS', uptime: 'Uptime', cpu: 'CPU', ram: 'RAM',
      live: 'Live', polling: 'Polling', filterPh: 'Filter logs…', clear: 'Clear',
      backupsTitle: 'Backups', createBackup: 'Create backup', noBackups: 'No backups yet.',
      wlAddPh: 'Player name', wlAdd: 'Whitelist +', rm: 'Remove', unban: 'Unban',
      cancel: 'Cancel', confirm: 'Confirm',
      badToken: 'That token was not accepted.', rateLimited: 'Too many failed attempts. Please wait a few minutes.', netErr: 'Could not reach the server.',
      sent: 'Command sent.', emptyConsole: 'No console output yet.', readOnlyHint: 'Read-only mode is on.',
      noFolder: 'No server folder selected for this instance.',
      start: 'Start', stop: 'Stop', forceStop: 'Force stop', restart: 'Restart', kick: 'Kick',
      confirmStop: 'Stop the server?', confirmForceStop: 'Force kill the server process immediately? Unsaved world chunks may be lost.', confirmRestart: 'Restart the server?', confirmKick: 'Kick {n}?',
      confirmBackup: 'Create a world backup now?',
      actionDone: 'Done.', actionFailed: 'Action failed.' },
    vi: { title: 'Từ xa', status: 'Trạng thái', playersTitle: 'Người chơi', consoleTitle: 'Console',
      commandTitle: 'Lệnh', commandHint: 'Một dòng', autoRefresh: 'Tự động', refresh: 'Tải lại',
      send: 'Gửi', forget: 'Quên token', gateHint: 'Dán token từ xa để tiếp tục.',
      connect: 'Kết nối', online: 'Đang online', whitelist: 'Whitelist', banned: 'Bị ban', ops: 'Ops',
      running: 'Đang chạy', stopped: 'Đã dừng', starting: 'Đang khởi động', stopping: 'Đang dừng',
      software: 'Phần mềm', java: 'Java', path: 'Thư mục', tps: 'TPS', uptime: 'Thời gian chạy', cpu: 'CPU', ram: 'RAM',
      live: 'Trực tiếp', polling: 'Đang đồng bộ', filterPh: 'Lọc log…', clear: 'Xóa',
      backupsTitle: 'Sao lưu', createBackup: 'Tạo backup', noBackups: 'Chưa có bản sao lưu.',
      wlAddPh: 'Tên người chơi', wlAdd: 'Thêm WL', rm: 'Gỡ', unban: 'Gỡ ban',
      cancel: 'Hủy', confirm: 'Xác nhận',
      badToken: 'Token không được chấp nhận.', rateLimited: 'Thử sai quá nhiều lần. Vui lòng đợi vài phút.', netErr: 'Không kết nối được server.',
      sent: 'Đã gửi lệnh.', emptyConsole: 'Chưa có output console.', readOnlyHint: 'Đang bật chế độ chỉ đọc.',
      noFolder: 'Instance này chưa chọn thư mục server.',
      start: 'Khởi động', stop: 'Dừng', forceStop: 'Buộc dừng', restart: 'Khởi động lại', kick: 'Đuổi',
      confirmStop: 'Dừng server?', confirmForceStop: 'Buộc tắt tiến trình server ngay lập tức? Dữ liệu thế giới chưa lưu có thể bị mất.', confirmRestart: 'Khởi động lại server?', confirmKick: 'Đuổi {n}?',
      confirmBackup: 'Tạo bản sao lưu thế giới ngay?',
      actionDone: 'Xong.', actionFailed: 'Thao tác thất bại.' },
    es: { title: 'Remoto', status: 'Estado', playersTitle: 'Jugadores', consoleTitle: 'Consola',
      commandTitle: 'Comando', commandHint: 'Una línea', autoRefresh: 'Auto', refresh: 'Recargar',
      send: 'Enviar', forget: 'Olvidar token', gateHint: 'Pega tu token remoto para continuar.',
      connect: 'Conectar', online: 'En línea', whitelist: 'Lista blanca', banned: 'Baneados', ops: 'Ops',
      running: 'En ejecución', stopped: 'Detenido', starting: 'Iniciando', stopping: 'Deteniendo',
      software: 'Software', java: 'Java', path: 'Carpeta', tps: 'TPS', uptime: 'Activo', cpu: 'CPU', ram: 'RAM',
      live: 'En vivo', polling: 'Sondeo', filterPh: 'Filtrar logs…', clear: 'Limpiar',
      backupsTitle: 'Copias', createBackup: 'Crear copia', noBackups: 'Sin copias aún.',
      wlAddPh: 'Nombre del jugador', wlAdd: 'Añadir WL', rm: 'Quitar', unban: 'Desbanear',
      cancel: 'Cancelar', confirm: 'Confirmar',
      badToken: 'Ese token no fue aceptado.', rateLimited: 'Demasiados intentos fallidos. Espera unos minutos.', netErr: 'No se pudo contactar al servidor.',
      sent: 'Comando enviado.', emptyConsole: 'Aún sin salida de consola.', readOnlyHint: 'El modo solo lectura está activo.',
      noFolder: 'Esta instancia no tiene carpeta de servidor.',
      start: 'Iniciar', stop: 'Detener', forceStop: 'Forzar cierre', restart: 'Reiniciar', kick: 'Expulsar',
      confirmStop: '¿Detener el servidor?', confirmForceStop: '¿Matar el proceso del servidor ahora? Se pueden perder datos no guardados.', confirmRestart: '¿Reiniciar el servidor?', confirmKick: '¿Expulsar a {n}?',
      confirmBackup: '¿Crear copia de seguridad ahora?',
      actionDone: 'Hecho.', actionFailed: 'La acción falló.' },
    'pt-BR': { title: 'Remoto', status: 'Status', playersTitle: 'Jogadores', consoleTitle: 'Console',
      commandTitle: 'Comando', commandHint: 'Uma linha', autoRefresh: 'Auto', refresh: 'Atualizar',
      send: 'Enviar', forget: 'Esquecer token', gateHint: 'Cole seu token remoto para continuar.',
      connect: 'Conectar', online: 'Online', whitelist: 'Whitelist', banned: 'Banidos', ops: 'Ops',
      running: 'Rodando', stopped: 'Parado', starting: 'Iniciando', stopping: 'Parando',
      software: 'Software', java: 'Java', path: 'Pasta', tps: 'TPS', uptime: 'Ativo', cpu: 'CPU', ram: 'RAM',
      live: 'Ao vivo', polling: 'Sincronizando', filterPh: 'Filtrar logs…', clear: 'Limpar',
      backupsTitle: 'Backups', createBackup: 'Criar backup', noBackups: 'Nenhum backup ainda.',
      wlAddPh: 'Nome do jogador', wlAdd: 'Adicionar WL', rm: 'Remover', unban: 'Desbanir',
      cancel: 'Cancelar', confirm: 'Confirmar',
      badToken: 'Esse token não foi aceito.', rateLimited: 'Muitas tentativas inválidas. Aguarde alguns minutos.', netErr: 'Não foi possível acessar o servidor.',
      sent: 'Comando enviado.', emptyConsole: 'Ainda sem saída do console.', readOnlyHint: 'O modo somente leitura está ativo.',
      noFolder: 'Esta instância não tem pasta de servidor.',
      start: 'Iniciar', stop: 'Parar', forceStop: 'Forçar parada', restart: 'Reiniciar', kick: 'Expulsar',
      confirmStop: 'Parar o servidor?', confirmForceStop: 'Encerrar o processo à força agora? Dados não salvos podem ser perdidos.', confirmRestart: 'Reiniciar o servidor?', confirmKick: 'Expulsar {n}?',
      confirmBackup: 'Criar backup do mundo agora?',
      actionDone: 'Pronto.', actionFailed: 'A ação falhou.' },
    de: { title: 'Fern', status: 'Status', playersTitle: 'Spieler', consoleTitle: 'Konsole',
      commandTitle: 'Befehl', commandHint: 'Eine Zeile', autoRefresh: 'Auto', refresh: 'Neu laden',
      send: 'Senden', forget: 'Token vergessen', gateHint: 'Füge dein Remote-Token ein, um fortzufahren.',
      connect: 'Verbinden', online: 'Online', whitelist: 'Whitelist', banned: 'Gebannt', ops: 'Ops',
      running: 'Läuft', stopped: 'Gestoppt', starting: 'Startet', stopping: 'Stoppt',
      software: 'Software', java: 'Java', path: 'Ordner', tps: 'TPS', uptime: 'Laufzeit', cpu: 'CPU', ram: 'RAM',
      live: 'Live', polling: 'Abruf', filterPh: 'Logs filtern…', clear: 'Leeren',
      backupsTitle: 'Backups', createBackup: 'Backup erstellen', noBackups: 'Noch keine Backups.',
      wlAddPh: 'Spielername', wlAdd: 'WL +', rm: 'Entfernen', unban: 'Entbannen',
      cancel: 'Abbrechen', confirm: 'Bestätigen',
      badToken: 'Dieses Token wurde nicht akzeptiert.', rateLimited: 'Zu viele Fehlversuche. Bitte kurz warten.', netErr: 'Server nicht erreichbar.',
      sent: 'Befehl gesendet.', emptyConsole: 'Noch keine Konsolenausgabe.', readOnlyHint: 'Der Nur-Lesen-Modus ist aktiv.',
      noFolder: 'Für diese Instanz ist kein Serverordner gewählt.',
      start: 'Starten', stop: 'Stoppen', forceStop: 'Erzwingen', restart: 'Neustart', kick: 'Kicken',
      confirmStop: 'Server stoppen?', confirmForceStop: 'Serverprozess sofort beenden? Ungespeicherte Weltdaten können verloren gehen.', confirmRestart: 'Server neu starten?', confirmKick: '{n} kicken?',
      confirmBackup: 'Jetzt ein Welt-Backup erstellen?',
      actionDone: 'Erledigt.', actionFailed: 'Aktion fehlgeschlagen.' },
    ru: { title: 'Удалённо', status: 'Статус', playersTitle: 'Игроки', consoleTitle: 'Консоль',
      commandTitle: 'Команда', commandHint: 'Одна строка', autoRefresh: 'Авто', refresh: 'Обновить',
      send: 'Отправить', forget: 'Забыть токен', gateHint: 'Вставьте удалённый токен, чтобы продолжить.',
      connect: 'Подключить', online: 'Онлайн', whitelist: 'Белый список', banned: 'Забанены', ops: 'Опы',
      running: 'Работает', stopped: 'Остановлен', starting: 'Запуск', stopping: 'Остановка',
      software: 'Софт', java: 'Java', path: 'Папка', tps: 'TPS', uptime: 'Время работы', cpu: 'CPU', ram: 'RAM',
      live: 'Прямой эфир', polling: 'Опрос', filterPh: 'Фильтр логов…', clear: 'Очистить',
      backupsTitle: 'Бэкапы', createBackup: 'Создать бэкап', noBackups: 'Бэкапов пока нет.',
      wlAddPh: 'Имя игрока', wlAdd: 'В WL +', rm: 'Удалить', unban: 'Разбанить',
      cancel: 'Отмена', confirm: 'Подтвердить',
      badToken: 'Этот токен не принят.', rateLimited: 'Слишком много неверных попыток. Подождите несколько минут.', netErr: 'Не удалось связаться с сервером.',
      sent: 'Команда отправлена.', emptyConsole: 'Пока нет вывода консоли.', readOnlyHint: 'Включён режим только чтения.',
      noFolder: 'Для этого сервера не выбрана папка.',
      start: 'Запустить', stop: 'Остановить', forceStop: 'Убить процесс', restart: 'Перезапустить', kick: 'Кикнуть',
      confirmStop: 'Остановить сервер?', confirmForceStop: 'Принудительно завершить процесс? Несохранённые данные мира могут быть потеряны.', confirmRestart: 'Перезапустить сервер?', confirmKick: 'Кикнуть {n}?',
      confirmBackup: 'Создать резервную копию мира сейчас?',
      actionDone: 'Готово.', actionFailed: 'Действие не удалось.' },
    'zh-CN': { title: '远程', status: '状态', playersTitle: '玩家', consoleTitle: '控制台',
      commandTitle: '命令', commandHint: '单行', autoRefresh: '自动', refresh: '刷新',
      send: '发送', forget: '清除令牌', gateHint: '粘贴远程令牌以继续。',
      connect: '连接', online: '在线', whitelist: '白名单', banned: '封禁', ops: '管理员',
      running: '运行中', stopped: '已停止', starting: '启动中', stopping: '停止中',
      software: '软件', java: 'Java', path: '文件夹', tps: 'TPS', uptime: '运行时长', cpu: 'CPU', ram: 'RAM',
      live: '实时', polling: '轮询', filterPh: '过滤日志…', clear: '清空',
      backupsTitle: '备份', createBackup: '创建备份', noBackups: '暂无备份。',
      wlAddPh: '玩家名称', wlAdd: '加入白名单', rm: '移除', unban: '解封',
      cancel: '取消', confirm: '确认',
      badToken: '该令牌未被接受。', rateLimited: '尝试失败次数过多，请稍候再试。', netErr: '无法连接到服务器。',
      sent: '命令已发送。', emptyConsole: '暂无控制台输出。', readOnlyHint: '只读模式已开启。',
      noFolder: '该实例尚未选择服务器文件夹。',
      start: '启动', stop: '停止', forceStop: '强制停止', restart: '重启', kick: '踢出',
      confirmStop: '停止服务器？', confirmForceStop: '立即强制结束服务器进程？未保存的区块数据可能会丢失。', confirmRestart: '重启服务器？', confirmKick: '踢出 {n}？',
      confirmBackup: '立即创建世界备份？',
      actionDone: '已完成。', actionFailed: '操作失败。' }
  };
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const savedLang = localStorage.getItem('olRemoteLang');
  const nav = (navigator.language || 'en');
  const base = nav.toLowerCase();
  let lang = (savedLang && LOCALES[savedLang])
    ? savedLang
    : (Object.keys(LOCALES).find(k => k.toLowerCase() === base)
      || Object.keys(LOCALES).find(k => k.toLowerCase().split('-')[0] === base.split('-')[0])
      || 'en');
  const t = k => (LOCALES[lang] && LOCALES[lang][k]) || LOCALES.en[k] || k;

  function applyLocale() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    const lf = $('#logFilter'); if (lf) lf.placeholder = t('filterPh');
    const wi = $('#wlInput'); if (wi) wi.placeholder = t('wlAddPh');
    const sel = $('#langSel'); if (sel) sel.value = lang;
    updateStreamBadge();
  }

  function buildLangSelect() {
    const sel = $('#langSel'); if (!sel) return;
    sel.innerHTML = Object.keys(LOCALES).map(k => `<option value="${k}">${k}</option>`).join('');
    sel.value = lang;
    sel.onchange = () => {
      lang = sel.value;
      localStorage.setItem('olRemoteLang', lang);
      applyLocale();
      renderAll();
    };
  }

  let token = '';
  let state = {};
  let metrics = {};
  let lastPlayers = {};
  let consoleLines = [];
  let lastBackups = [];
  let readOnly = true;
  let instances = [];
  let activeInst = localStorage.getItem('olRemoteInst') || '';
  let timer = null;
  let autoInstTimer = null;
  let uptimeTimer = null;
  let sseAbort = null;
  let sseConnected = false;
  let cmdHistory = [];
  let cmdHistIdx = -1;
  try { cmdHistory = JSON.parse(sessionStorage.getItem('olRemoteCmdHist') || '[]') || []; } catch { cmdHistory = []; }

  const authHeaders = () => ({ authorization: 'Bearer ' + token });
  const withInst = (path) => path + (activeInst ? (path.includes('?') ? '&' : '?') + 'instance=' + encodeURIComponent(activeInst) : '');

  async function api(path, opts) {
    const res = await fetch(path, { ...(opts || {}), headers: { ...authHeaders(), ...((opts && opts.headers) || {}) } });
    let body = {};
    try { body = await res.json(); } catch {}
    return { status: res.status, body };
  }

  function updateStreamBadge() {
    const b = $('#streamBadge'); if (!b) return;
    const auto = $('#autoRefresh') ? $('#autoRefresh').checked : true;
    if (!token || $('#app').hidden || !auto) { b.hidden = true; return; }
    b.hidden = false;
    b.textContent = sseConnected ? t('live') : t('polling');
    b.className = 'stream-badge ' + (sseConnected ? 'live' : 'poll');
  }

  function stopStreams() {
    if (sseAbort) { try { sseAbort.abort(); } catch {} sseAbort = null; }
    sseConnected = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (autoInstTimer) { clearInterval(autoInstTimer); autoInstTimer = null; }
    if (uptimeTimer) { clearInterval(uptimeTimer); uptimeTimer = null; }
    updateStreamBadge();
  }

  function showGate(msg) {
    $('#gate').hidden = false;
    $('#app').hidden = true;
    const e = $('#gateErr');
    if (msg) { e.hidden = false; e.textContent = msg; } else { e.hidden = true; }
    $('#tokenInput').value = '';
    stopStreams();
  }

  async function connect() {
    const cfg = await api('/ui/config');
    if (cfg.status === 429) return showGate(t('rateLimited'));
    if (cfg.status === 401) return showGate(t('badToken'));
    if (cfg.status !== 200) return showGate(t('netErr'));
    readOnly = cfg.body && cfg.body.data ? cfg.body.data.readOnly !== false : true;
    $('#gate').hidden = true;
    $('#app').hidden = false;
    await refreshInstances();
    await loadAll();
    startAuto();
  }

  async function refreshInstances() {
    try {
      const inst = await api('/instances');
      if (inst.status === 200) instances = (inst.body && inst.body.data && inst.body.data.instances) || [];
    } catch {}
    if (instances.length && !instances.some(i => i.id === activeInst)) {
      activeInst = instances[0].id;
      localStorage.setItem('olRemoteInst', activeInst);
    }
    renderInstancePicker();
  }

  function renderInstancePicker() {
    let picker = $('#instPicker');
    if (!picker) {
      picker = document.createElement('select');
      picker.id = 'instPicker'; picker.className = 'sel'; picker.setAttribute('aria-label', 'Active server instance');
      const right = document.querySelector('.top-right');
      if (right) right.insertBefore(picker, right.firstChild);
      picker.onchange = () => {
        activeInst = picker.value;
        localStorage.setItem('olRemoteInst', activeInst);
        consoleLines = [];
        loadAll();
        restartSse();
      };
    }
    picker.hidden = instances.length < 2;
    if (instances.length < 2) return;
    picker.innerHTML = instances.map(i => `<option value="${esc(i.id)}">${esc(i.name || i.id)}</option>`).join('');
    picker.value = activeInst;
  }

  async function loadAll() {
    const st = await api(withInst('/status'));
    if (st.status === 429) return showGate(t('rateLimited'));
    if (st.status === 401) return showGate(t('badToken'));
    if (st.status !== 200) return;
    state = (st.body && st.body.data && st.body.data.result) || {};
    renderStatus(); updateCmdCard();
    if (!state.serverPath) {
      lastPlayers = {}; consoleLines = []; lastBackups = [];
      renderPlayers({});
      renderConsole({ lines: [], emptyHint: t('noFolder') });
      renderMetrics({});
      renderBackups([]);
      return;
    }
    const [pl, co, mt, bk] = await Promise.all([
      api(withInst('/players')),
      api(withInst('/console?lines=200')),
      api(withInst('/metrics')),
      api(withInst('/backups')),
    ]);
    if (pl.status === 200) { lastPlayers = (pl.body && pl.body.data && pl.body.data.result) || {}; renderPlayers(lastPlayers); }
    if (co.status === 200) {
      const res = (co.body && co.body.data && co.body.data.result) || {};
      consoleLines = Array.isArray(res.lines) ? res.lines : [];
      renderConsole({ lines: consoleLines });
    }
    if (mt.status === 200) { metrics = (mt.body && mt.body.data && mt.body.data.result) || {}; renderMetrics(metrics); }
    if (bk.status === 200) { lastBackups = ((bk.body && bk.body.data && bk.body.data.result) || {}).backups || []; renderBackups(lastBackups); }
  }

  function fmtUptime(startedAt) {
    if (!startedAt) return '—';
    const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}h ${m}m ${s}s` : (m ? `${m}m ${s}s` : `${s}s`);
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
      [t('software'), state.software || state.jar || state.nativeBinary || ''],
      [t('java'), state.software === 'horizon' ? 'Native Engine' : ((state.java && state.java.version) || (state.javaRequired ? ('needs ' + state.javaRequired) : ''))],
      [t('path'), state.serverPath || '']
    ];
    $('#statusKv').innerHTML = rows.filter(r => r[1]).map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('');
  }

  function renderMetrics(m) {
    const bar = $('#metricsBar'); if (!bar) return;
    const isUp = !!(state.running || m.running);
    bar.hidden = !state.serverPath;
    $('#mTps').textContent = (isUp && m.tps != null) ? Number(m.tps).toFixed(1) : '—';
    $('#mCpu').textContent = (isUp && m.cpu != null) ? `${Math.round(m.cpu)}%` : '—';
    $('#mUptime').textContent = (isUp && m.startedAt) ? fmtUptime(m.startedAt) : '—';
    const maxMb = Number(m.memoryMaxMb) || 0;
    const usedMb = (isUp && m.ram != null) ? Number(m.ram) : 0;
    $('#mRam').textContent = isUp && m.ram != null ? (maxMb ? `${Math.round(usedMb)} / ${Math.round(maxMb)} MB` : `${Math.round(usedMb)} MB`) : '—';
    const pct = (isUp && maxMb > 0) ? Math.min(100, Math.round((usedMb / maxMb) * 100)) : 0;
    $('#mRamFill').style.width = `${pct}%`;
  }

  function renderPlayers(p) {
    const groups = [['online', t('online')], ['whitelist', t('whitelist')], ['banned', t('banned')], ['ops', t('ops')]];
    $('#playerCount').textContent = (p.online || []).length;
    const html = groups.map(([key, label]) => {
      const list = Array.isArray(p[key]) ? p[key] : [];
      if (!list.length) return '';
      const names = list.map(x => {
        const nm = typeof x === 'string' ? x : (x.name || '');
        let btn = '';
        if (!readOnly && nm) {
          if (key === 'online') btn = `<button class="pl-kick" data-act="kick" data-name="${esc(nm)}">${esc(t('kick'))}</button>`;
          else if (key === 'whitelist') btn = `<button class="pl-kick" data-act="whitelist_remove" data-name="${esc(nm)}" title="${esc(t('rm'))}">×</button>`;
          else if (key === 'banned') btn = `<button class="pl-kick" data-act="unban" data-name="${esc(nm)}">${esc(t('unban'))}</button>`;
        }
        return `<span class="pl">${esc(nm)}${btn}</span>`;
      }).join('');
      return `<div class="pl-group"><b>${esc(label)} (${list.length})</b><div class="pl-list">${names}</div></div>`;
    }).join('');
    $('#players').innerHTML = html || `<p class="muted">-</p>`;
  }

  function renderConsole(c) {
    const box = $('#console'); if (!box) return;
    const lines = Array.isArray(c && c.lines) ? c.lines : consoleLines;
    const q = ($('#logFilter') ? $('#logFilter').value : '').trim().toLowerCase();
    const filtered = q ? lines.filter(l => String(l).toLowerCase().includes(q)) : lines;
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
    if (!filtered.length) {
      box.textContent = (c && c.emptyHint) || t('emptyConsole');
      return;
    }
    box.innerHTML = filtered.map(line => {
      const s = String(line);
      let cls = 'con-line';
      if (/\b(ERROR|FATAL|Exception)\b/i.test(s)) cls += ' con-err';
      else if (/\bWARN(ING)?\b/i.test(s)) cls += ' con-warn';
      else if (/^\[Observer\]/i.test(s)) cls += ' con-info';
      return `<span class="${cls}">${esc(s)}</span>`;
    }).join('');
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function renderBackups(list) {
    const box = $('#backupsList'); if (!box) return;
    if (!Array.isArray(list) || !list.length) {
      box.innerHTML = `<p class="muted" style="margin:0">${esc(t('noBackups'))}</p>`;
      return;
    }
    box.innerHTML = list.slice(0, 10).map(b => {
      const sz = b.size ? `${(b.size / (1024 * 1024)).toFixed(1)} MB` : '';
      const dt = b.mtime ? new Date(b.mtime).toLocaleString() : '';
      return `<div class="bk-row"><code>${esc(b.name)}</code><span class="bk-meta">${esc([sz, dt].filter(Boolean).join(' • '))}</span></div>`;
    }).join('');
  }

  function renderAll() {
    renderStatus();
    renderMetrics(metrics);
    renderPlayers(lastPlayers);
    renderConsole({ lines: consoleLines });
    renderBackups(lastBackups);
  }

  function updateCmdCard() {
    $('#cmdCard').hidden = readOnly;
    $('#actions').hidden = readOnly;
    if ($('#wlForm')) $('#wlForm').hidden = readOnly;
    if ($('#createBackupBtn')) $('#createBackupBtn').hidden = readOnly;
  }

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

  // In-page accessible confirm dialog (replaces window.confirm for mobile WebView compatibility).
  function confirmAction(msg) {
    if (!msg) return Promise.resolve(true);
    const dlg = $('#confirmDlg');
    if (!dlg) return Promise.resolve(window.confirm(msg));
    const prevFocus = document.activeElement;
    $('#confirmMsg').textContent = msg;
    dlg.hidden = false;
    $('#confirmOk').focus();
    return new Promise(resolve => {
      const close = (ok) => {
        dlg.hidden = true;
        document.removeEventListener('keydown', onKey);
        dlg.onclick = null;
        try { if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus(); } catch {}
        resolve(ok);
      };
      const onKey = (e) => { if (e.key === 'Escape') close(false); };
      dlg.onclick = (e) => { if (e.target === dlg) close(false); };
      $('#confirmOk').onclick = () => close(true);
      $('#confirmCancel').onclick = () => close(false);
      document.addEventListener('keydown', onKey);
    });
  }

  function handleForbidden() {
    readOnly = true;
    updateCmdCard();
    renderPlayers(lastPlayers);
    toast(t('readOnlyHint'), 'err');
  }

  async function runAction(action, name, confirmMsg) {
    if (confirmMsg && !(await confirmAction(confirmMsg))) return;
    const r = await api('/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, name: name || '', instance: activeInst }) });
    if (r.status === 403) { handleForbidden(); return; }
    const inner = (r.body && r.body.data) || {};
    if (r.status !== 200 || inner.ok === false) { toast(errText(r.body), 'err'); return; }
    toast(t('actionDone'), 'ok');
    loadAll();
  }

  async function startSse() {
    if (sseAbort) { try { sseAbort.abort(); } catch {} sseAbort = null; }
    if (!$('#autoRefresh') || !$('#autoRefresh').checked || !token || $('#app').hidden) return;
    const ac = new AbortController();
    sseAbort = ac;
    try {
      const res = await fetch(withInst('/events'), { headers: authHeaders(), signal: ac.signal });
      if (res.status === 401) { showGate(t('badToken')); return; }
      if (!res.ok || !res.body) throw new Error('SSE unavailable');
      sseConnected = true;
      updateStreamBadge();
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let evName = 'message';
      let evData = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || '';
        for (const l of lines) {
          if (!l) {
            if (evData) handleSseEvent(evName, evData);
            evName = 'message'; evData = '';
          } else if (l.startsWith('event:')) evName = l.slice(6).trim();
          else if (l.startsWith('data:')) evData += (evData ? '\n' : '') + l.slice(5).trim();
        }
      }
    } catch {}
    sseConnected = false;
    updateStreamBadge();
  }

  async function syncMeta() {
    if (!state.serverPath) return;
    const [pl, bk] = await Promise.all([api(withInst('/players')), api(withInst('/backups'))]);
    if (pl.status === 200) { lastPlayers = (pl.body && pl.body.data && pl.body.data.result) || {}; renderPlayers(lastPlayers); }
    if (bk.status === 200) { lastBackups = ((bk.body && bk.body.data && bk.body.data.result) || {}).backups || []; renderBackups(lastBackups); }
  }

  function handleSseEvent(type, raw) {
    let p; try { p = JSON.parse(raw); } catch { return; }
    if (type === 'log' && p.text != null) {
      const line = p.time ? `[${p.time}] ${p.text}` : String(p.text);
      consoleLines.push(line);
      if (consoleLines.length > 500) consoleLines.shift();
      renderConsole({ lines: consoleLines });
    } else if (type === 'state') {
      state.status = p.status; state.running = !!p.running;
      metrics.running = !!p.running;
      if (!p.running) metrics.startedAt = 0;
      else if (p.startedAt !== undefined) metrics.startedAt = p.startedAt;
      renderStatus(); renderMetrics(metrics);
      if (!p.running) syncMeta();
    } else if (type === 'metrics') {
      const prevCount = Array.isArray(lastPlayers.online) ? lastPlayers.online.length : -1;
      metrics = { ...metrics, ...p };
      renderMetrics(metrics);
      if (typeof p.players === 'number' && p.players !== prevCount) syncMeta();
    }
  }

  function restartSse() {
    sseConnected = false;
    updateStreamBadge();
    if ($('#autoRefresh') && $('#autoRefresh').checked) startSse();
  }

  function startAuto() {
    stopStreams();
    startSse();
    let tick = 0;
    timer = setInterval(() => {
      if (document.hidden || !$('#autoRefresh').checked) return;
      tick++;
      if (!sseConnected) {
        loadAll();
        if (tick % 3 === 0) startSse();
      } else if (tick % 3 === 0) {
        syncMeta();
      }
    }, 4000);
    autoInstTimer = setInterval(() => { if (!document.hidden) refreshInstances(); }, 15000);
    uptimeTimer = setInterval(() => {
      if (!document.hidden && state.running && metrics.startedAt && $('#mUptime')) {
        $('#mUptime').textContent = fmtUptime(metrics.startedAt);
      }
    }, 1000);
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
  $('#autoRefresh').onchange = () => {
    if ($('#autoRefresh').checked) startSse();
    else { if (sseAbort) try { sseAbort.abort(); } catch {} sseConnected = false; updateStreamBadge(); }
  };
  $('#logFilter')?.addEventListener('input', () => renderConsole({ lines: consoleLines }));
  $('#clearLogBtn')?.addEventListener('click', () => { consoleLines = []; renderConsole({ lines: [] }); });
  $('#actStart').onclick = () => runAction('start');
  $('#actStop').onclick = () => runAction('stop', '', t('confirmStop'));
  $('#actForceStop')?.addEventListener('click', () => runAction('force_stop', '', t('confirmForceStop')));
  $('#actRestart').onclick = () => runAction('restart', '', t('confirmRestart'));
  $('#createBackupBtn')?.addEventListener('click', () => runAction('backup', '', t('confirmBackup')));
  $('#wlForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#wlInput');
    const name = inp.value.trim();
    if (!name) return;
    inp.value = '';
    runAction('whitelist_add', name);
  });
  $('#players').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, name = b.dataset.name;
    const confirmMsg = act === 'kick' ? t('confirmKick').replace('{n}', name) : '';
    runAction(act, name, confirmMsg);
  });
  $('#cmdInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && cmdHistory.length) {
      e.preventDefault();
      cmdHistIdx = Math.min(cmdHistory.length - 1, cmdHistIdx + 1);
      $('#cmdInput').value = cmdHistory[cmdHistIdx];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdHistIdx = Math.max(-1, cmdHistIdx - 1);
      $('#cmdInput').value = cmdHistIdx >= 0 ? cmdHistory[cmdHistIdx] : '';
    }
  });
  $('#cmdForm').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#cmdInput');
    const cmd = input.value.trim();
    if (!cmd) return;
    const r = await api('/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: cmd, instance: activeInst }) });
    if (r.status === 403) { handleForbidden(); return; }
    const inner = (r.body && r.body.data) || {};
    if (r.status !== 200 || inner.ok === false) { toast(errText(r.body), 'err'); return; }
    if (cmdHistory[0] !== cmd) {
      cmdHistory.unshift(cmd);
      if (cmdHistory.length > 30) cmdHistory.pop();
      try { sessionStorage.setItem('olRemoteCmdHist', JSON.stringify(cmdHistory)); } catch {}
    }
    cmdHistIdx = -1;
    input.value = '';
    if (!sseConnected) loadAll();
  };
})();
