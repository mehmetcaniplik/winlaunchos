const { app, BrowserWindow, ipcMain, Menu, shell, globalShortcut, desktopCapturer, screen, clipboard, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { exec } = require('child_process');

// Custom scheme so Finder can show local images/audio/video/pdf in-app.
protocol.registerSchemesAsPrivileged([{ scheme: 'wlmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }]);

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let win;
let kiosk = false;

/* ============================================================
   KIOSK LOCK — fullscreen lock, exit only with Ctrl+Shift+Alt+Esc.
   Does NOT disable Ctrl+Alt+Del / Task Manager (OS-level safety net),
   and does NOT touch WinLogon or Explorer.
   ============================================================ */
function setKiosk(on) {
  kiosk = !!on;
  if (win) {
    if (on) {
      win.setMinimizable(false);
      win.setClosable(false);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setFullScreen(true);
      win.setSkipTaskbar(false);
      win.focus();
      try { globalShortcut.register('Control+Shift+Alt+Escape', () => setKiosk(false)); } catch (e) {}
      // swallow common "exit" shortcuts while locked
      ['Alt+F4', 'Control+W', 'Control+Shift+W', 'F11', 'Control+Q'].forEach(a => { try { globalShortcut.register(a, () => {}); } catch (e) {} });
    } else {
      try { globalShortcut.unregisterAll(); } catch (e) {}
      win.setAlwaysOnTop(false);
      win.setClosable(true);
      win.setMinimizable(true);
      win.setFullScreen(false);
    }
    if (win.webContents) win.webContents.send('kiosk:state', kiosk);
  }
  return kiosk;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    frame: false,
    backgroundColor: '#0b0d13',
    show: false,
    title: 'WinLaunch',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  Menu.setApplicationMenu(null);
  // Allow camera / microphone / notifications for the local app UI.
  try {
    win.webContents.session.setPermissionRequestHandler((wc, permission, cb) => cb(true));
    win.webContents.session.setPermissionCheckHandler(() => true);
  } catch (e) {}
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // While kiosk lock is on, block normal closing.
  win.on('close', (e) => { if (kiosk) e.preventDefault(); });

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
}

// ---- IPC: window controls (safe, only affects THIS app window) ----
ipcMain.handle('win:minimize', () => { if (win) win.minimize(); });
ipcMain.handle('win:toggleFullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.handle('win:close', () => { if (win) win.close(); });
ipcMain.handle('win:isFullscreen', () => win ? win.isFullScreen() : false);

// ---- IPC: enable/disable auto-start at login (safe: Startup/Run only) ----
// This does NOT touch WinLogon or Explorer. It only registers the app to
// open after you log into Windows normally.
function setAutostart(on) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath });
    return true;
  } catch (e) { return false; }
}
ipcMain.handle('system:autostart', (_e, on) => setAutostart(on));
ipcMain.handle('system:autostartStatus', () => {
  try { return app.getLoginItemSettings().openAtLogin; } catch (e) { return false; }
});

// ---- IPC: real system restart (explicit user action only) ----
// Registers auto-start FIRST so WinLaunch comes back after the reboot,
// then issues a normal OS restart. Does NOT touch WinLogon or Explorer.
ipcMain.handle('system:restart', () => {
  if (process.platform === 'win32') {
    setAutostart(true);
    // small delay so the registry write is flushed before shutdown
    setTimeout(() => exec('shutdown /r /t 3 /c "WinLaunch yeniden baslatiliyor"'), 600);
  } else if (process.platform === 'darwin') {
    setAutostart(true);
    exec('osascript -e \'tell app "System Events" to restart\'');
  } else if (process.platform === 'linux') {
    // Only really reboot when running as the WinLaunchOS session; otherwise simulate.
    if (process.env.WINLAUNCH_OS === '1') { exec('systemctl reboot || reboot'); return { simulated: false }; }
    return { simulated: true };
  } else {
    return { simulated: true };
  }
  return { simulated: false };
});

ipcMain.handle('app:quit', () => { if (!kiosk) app.quit(); });
ipcMain.handle('app:platform', () => process.platform);
ipcMain.handle('kiosk:set', (_e, on) => setKiosk(on));
ipcMain.handle('kiosk:get', () => kiosk);

/* ============================================================
   REAL filesystem + installed apps (read-only browse + launch)
   Uses standard Electron/Node APIs. Does NOT touch WinLogon/Explorer.
   ============================================================ */
ipcMain.handle('fs:roots', () => {
  const home = os.homedir();
  const cand = [
    ['Ana Klasör', home, '🏠'],
    ['Masaüstü', path.join(home, 'Desktop'), '🖥️'],
    ['Belgeler', path.join(home, 'Documents'), '📄'],
    ['İndirilenler', path.join(home, 'Downloads'), '⬇️'],
    ['Resimler', path.join(home, 'Pictures'), '🖼️'],
    ['Müzik', path.join(home, 'Music'), '🎵'],
    ['Videolar', path.join(home, 'Videos'), '🎬']
  ];
  const out = [];
  for (const [name, p, ic] of cand) { try { if (fs.existsSync(p)) out.push({ name, path: p, ic }); } catch (e) {} }
  if (process.platform === 'win32') {
    for (const L of 'CDEFGHI') { const d = L + ':\\'; try { if (fs.existsSync(d)) out.push({ name: L + ':', path: d, ic: '💾' }); } catch (e) {} }
  }
  return out;
});
ipcMain.handle('fs:list', async (_e, dir) => {
  try {
    const ents = await fsp.readdir(dir, { withFileTypes: true });
    const items = [];
    for (const d of ents) {
      const nm = d.name;
      if (nm.startsWith('$') || nm === 'System Volume Information') continue;
      let isDir = false;
      try { isDir = d.isDirectory() || (d.isSymbolicLink() && fs.statSync(path.join(dir, nm)).isDirectory()); } catch (e) { isDir = d.isDirectory(); }
      const ext = isDir ? '' : (nm.split('.').pop() || '').toLowerCase();
      items.push({ name: nm, dir: isDir, ext });
    }
    items.sort((a, b) => a.dir === b.dir ? a.name.localeCompare(b.name, 'tr') : (a.dir ? -1 : 1));
    return { ok: true, dir, items };
  } catch (e) { return { ok: false, error: e.code === 'EACCES' ? 'Erişim izni yok' : e.message }; }
});
ipcMain.handle('fs:open', async (_e, p) => { const r = await shell.openPath(p); return { ok: r === '', error: r }; });
ipcMain.handle('fs:reveal', (_e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('fs:parent', (_e, p) => path.dirname(p));
ipcMain.handle('fs:join', (_e, a, b) => path.join(a, b));

// Installed apps — Linux: parse .desktop files
async function listLinuxApps() {
  const dirs = ['/usr/share/applications', path.join(os.homedir(), '.local/share/applications'), '/var/lib/flatpak/exports/share/applications', '/var/lib/snapd/desktop/applications'];
  const found = [];
  for (const d of dirs) {
    let ents; try { ents = await fsp.readdir(d); } catch (e) { continue; }
    for (const f of ents) {
      if (!f.endsWith('.desktop')) continue;
      try {
        const txt = await fsp.readFile(path.join(d, f), 'utf8');
        if (/^NoDisplay\s*=\s*true/im.test(txt) || /^Hidden\s*=\s*true/im.test(txt)) continue;
        const name = (txt.match(/^Name\s*=\s*(.*)$/m) || [])[1];
        const exec = (txt.match(/^Exec\s*=\s*(.*)$/m) || [])[1];
        const icon = (txt.match(/^Icon\s*=\s*(.*)$/m) || [])[1];
        if (name && exec) found.push({ name: name.trim(), path: path.join(d, f), exec: exec.trim(), icon: (icon || '').trim() });
      } catch (e) {}
    }
  }
  const seen = {}, uniq = [];
  for (const a of found) { const k = a.name.toLowerCase(); if (!seen[k]) { seen[k] = 1; uniq.push(a); } }
  uniq.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  return uniq;
}

// Installed apps = Start Menu .lnk shortcuts (Windows)
ipcMain.handle('apps:list', async () => {
  if (process.platform === 'linux') return listLinuxApps();
  if (process.platform !== 'win32') return [];
  const dirs = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ];
  const found = [];
  async function walk(d, depth) {
    if (depth > 4) return;
    let ents; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) await walk(fp, depth + 1);
      else if (/\.(lnk|url|appref-ms)$/i.test(e.name)) {
        const name = e.name.replace(/\.(lnk|url|appref-ms)$/i, '');
        if (/uninstall|kaldır|readme|help|website|web site|license/i.test(name)) continue;
        found.push({ name, path: fp });
      }
    }
  }
  for (const d of dirs) await walk(d, 0);
  const seen = {}; const uniq = [];
  for (const a of found) { const k = a.name.toLowerCase(); if (!seen[k]) { seen[k] = 1; uniq.push(a); } }
  uniq.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  return uniq;
});
ipcMain.handle('apps:icon', async (_e, p) => {
  if (process.platform === 'linux') return null; // theme icons resolved in renderer fallback
  try { const img = await app.getFileIcon(p, { size: 'normal' }); return img.isEmpty() ? null : img.toDataURL(); } catch (e) { return null; }
});
ipcMain.handle('apps:launch', async (_e, p) => {
  if (process.platform === 'linux') {
    // p is a .desktop path — launch via gio/gtk-launch
    const id = path.basename(p, '.desktop');
    exec(`gio launch "${p}" 2>/dev/null || gtk-launch "${id}" 2>/dev/null || xdg-open "${p}"`);
    return { ok: true };
  }
  const r = await shell.openPath(p); return { ok: r === '', error: r };
});

/* ============================================================
   System stats, screenshot, clipboard history
   ============================================================ */
let lastCpu = null;
function cpuPercent() {
  const cpus = os.cpus(); let idle = 0, total = 0;
  for (const c of cpus) { for (const t in c.times) total += c.times[t]; idle += c.times.idle; }
  if (!lastCpu) { lastCpu = { idle, total }; return 0; }
  const di = idle - lastCpu.idle, dt = total - lastCpu.total; lastCpu = { idle, total };
  if (dt <= 0) return 0; return Math.max(0, Math.min(100, Math.round(100 * (1 - di / dt))));
}
ipcMain.handle('sys:stats', () => {
  const total = os.totalmem(), free = os.freemem();
  return { cpu: cpuPercent(), memUsed: total - free, memTotal: total, memPct: Math.round(100 * (total - free) / total), uptime: os.uptime(), host: os.hostname(), platform: process.platform, cores: os.cpus().length, arch: process.arch, cpuName: (os.cpus()[0] || {}).model || '—' };
});
ipcMain.handle('sys:screenshot', async () => {
  try {
    const dsp = screen.getPrimaryDisplay(); const { width, height } = dsp.size; const sf = dsp.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(width * sf), height: Math.round(height * sf) } });
    if (!sources.length) return { ok: false, error: 'Ekran bulunamadı' };
    const img = sources[0].thumbnail;
    const dir = path.join(os.homedir(), 'Pictures', 'WinLaunch'); try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    const file = path.join(dir, 'ekran-' + Date.now() + '.png');
    fs.writeFileSync(file, img.toPNG());
    return { ok: true, file };
  } catch (e) { return { ok: false, error: e.message }; }
});

let clipHist = [], lastClip = '';
function startClipboardWatch() {
  try { lastClip = clipboard.readText(); } catch (e) {}
  setInterval(() => { try { const t = clipboard.readText(); if (t && t !== lastClip) { lastClip = t; clipHist = clipHist.filter(x => x !== t); clipHist.unshift(t); if (clipHist.length > 30) clipHist.pop(); } } catch (e) {} }, 1500);
}
ipcMain.handle('clip:get', () => clipHist);
ipcMain.handle('clip:set', (_e, t) => { try { clipboard.writeText(t); lastClip = t; } catch (e) {} return true; });
ipcMain.handle('clip:clear', () => { clipHist = []; return true; });
ipcMain.handle('sys:openUrl', (_e, url) => { try { shell.openExternal(url); return true; } catch (e) { return false; } });

app.whenReady().then(() => {
  try {
    protocol.handle('wlmedia', async (request) => {
      try {
        const u = new URL(request.url); const p = u.searchParams.get('p');
        const data = await fsp.readFile(p);
        const ext = (p.split('.').pop() || '').toLowerCase();
        const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', pdf: 'application/pdf' }[ext] || 'application/octet-stream';
        return new Response(data, { headers: { 'content-type': mime } });
      } catch (e) { return new Response('not found', { status: 404 }); }
    });
  } catch (e) {}
  startClipboardWatch();
  createWindow();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) {} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
