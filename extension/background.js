// Pioneer TV background service worker.
//
// Owns the single WebSocket connection to the native daemon and relays its
// events to the page that is currently shown. Also keeps Chromium in a
// single-tab, kiosk-friendly state and handles the developer shortcuts.

const DAEMON_URL = 'ws://127.0.0.1:8765/ws';
const LAUNCHER_URL = chrome.runtime.getURL('launcher/index.html');
const RECONNECT_MS = 2000;
const PING_MS = 20000; // WebSocket traffic keeps the MV3 worker alive.

let socket = null;
let daemonConnected = false;
let config = null;
let status = null;
let pingTimer = null;

// ---------------------------------------------------------------- daemon link

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  try {
    socket = new WebSocket(DAEMON_URL);
  } catch (e) {
    setTimeout(connect, RECONNECT_MS);
    return;
  }
  socket.onopen = () => {
    daemonConnected = true;
    send({ type: 'hello', client: 'extension', version: chrome.runtime.getManifest().version });
    broadcastState();
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ type: 'ping' }), PING_MS);
  };
  socket.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleDaemonMessage(msg);
  };
  socket.onclose = () => {
    daemonConnected = false;
    clearInterval(pingTimer);
    broadcastState();
    setTimeout(connect, RECONNECT_MS);
  };
  socket.onerror = () => { /* onclose follows */ };
}

function send(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

async function handleDaemonMessage(msg) {
  if (msg.type === 'config') {
    config = msg;
    await chrome.storage.local.set({ config });
    broadcastState();
    return;
  }
  if (msg.type === 'pong') return;
  if (msg.type === 'status') {
    status = msg;
    broadcastState();
    return;
  }
  if (msg.type === 'event') {
    if (msg.name === 'home') return goHome();
    if (msg.name === 'reload') return reloadActive();
    if (msg.name === 'back') return goBack();
    return forwardToActiveTab(msg);
  }
}

// ---------------------------------------------------------------- tabs

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tabs[0]) return tabs[0];
  const all = await chrome.tabs.query({});
  return all[0];
}

async function goHome() {
  const tab = await activeTab();
  if (!tab) return chrome.tabs.create({ url: LAUNCHER_URL });
  if (tab.url && tab.url.startsWith(LAUNCHER_URL)) return;
  return chrome.tabs.update(tab.id, { url: LAUNCHER_URL });
}

async function reloadActive() {
  const tab = await activeTab();
  if (tab) chrome.tabs.reload(tab.id);
}

async function goBack() {
  const tab = await activeTab();
  if (tab) chrome.tabs.goBack(tab.id).catch(() => {});
}

async function forwardToActiveTab(msg) {
  const tab = await activeTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, msg).catch(() => { /* no content script on this page */ });
}

async function broadcastState() {
  const state = { type: 'state', daemonConnected, config, status };
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) chrome.tabs.sendMessage(t.id, state).catch(() => {});
}

// Keep the browser to one tab: anything that opens a new tab (target=_blank,
// window.open) is moved into the main tab instead. On a 1GB Pi a second tab is
// a real cost, and the gamepad has no way to switch tabs anyway.
chrome.tabs.onCreated.addListener(async (newTab) => {
  const tabs = await chrome.tabs.query({});
  if (tabs.length <= 1) return;
  const main = tabs.find((t) => t.id !== newTab.id);
  const url = newTab.pendingUrl || newTab.url;
  if (url && url !== 'about:blank' && url !== 'chrome://newtab/') {
    await chrome.tabs.update(main.id, { url, active: true });
    chrome.tabs.remove(newTab.id).catch(() => {});
    return;
  }
  // URL not known yet: wait for it, then move it.
  const listener = async (tabId, info) => {
    if (tabId !== newTab.id || !info.url) return;
    chrome.tabs.onUpdated.removeListener(listener);
    await chrome.tabs.update(main.id, { url: info.url, active: true });
    chrome.tabs.remove(newTab.id).catch(() => {});
  };
  chrome.tabs.onUpdated.addListener(listener);
});

// ---------------------------------------------------------------- pages → worker

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  switch (msg.type) {
    case 'getState':
      reply({ type: 'state', daemonConnected, config, status });
      return false;
    case 'home':
      goHome();
      break;
    case 'reload':
      reloadActive();
      break;
    case 'back':
      goBack();
      break;
    case 'settings':
      activeTab().then((tab) => tab && chrome.tabs.update(tab.id, { url: (config && config.settings_url) || 'http://127.0.0.1:8765/' }));
      break;
    case 'navigate':
      if (sender.tab) chrome.tabs.update(sender.tab.id, { url: msg.url });
      send({ type: 'navigate', url: msg.url });
      break;
    case 'daemon':
      send(msg.payload);
      break;
    case 'api':
      apiProxy(msg).then(reply);
      return true; // async reply
  }
  return false;
});

// HTTP proxy to the daemon for content scripts on https pages.
async function apiProxy(msg) {
  const base = (config && config.settings_url) ? config.settings_url.replace(/\/$/, '') : 'http://127.0.0.1:8765';
  try {
    const r = await fetch(base + msg.path, {
      method: msg.method || 'GET',
      headers: msg.body ? { 'Content-Type': 'application/json' } : {},
      body: msg.body ? JSON.stringify(msg.body) : undefined,
    });
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) return { ok: false, error: (data && data.error) || String(r.status) };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------- dev shortcuts

chrome.commands.onCommand.addListener((command) => {
  if (command === 'go-home') return goHome();
  if (command === 'toggle-keyboard') return forwardToActiveTab({ type: 'event', name: 'keyboard' });
  if (command === 'toggle-menu') return forwardToActiveTab({ type: 'event', name: 'menu' });
});

// ---------------------------------------------------------------- startup

async function boot() {
  const stored = await chrome.storage.local.get('config');
  if (stored.config) config = stored.config;
  connect();
}

// The kiosk start script opens about:blank: Chromium refuses chrome-extension://
// URLs given on the command line. The extension takes the tab to the launcher
// itself, on browser start and on (re)load of the unpacked extension.
const isIdleUrl = (url) => !url || url === 'about:blank' || url === 'chrome://newtab/' || url.startsWith('chrome-error://');

// Debug trail: console plus the daemon's log (journalctl -u pioneer-tv-daemon).
function debug(text) {
  console.log('[pioneer-tv]', text);
  send({ type: 'debug', text });
}

let tookOver = false;
async function takeOver(reason) {
  if (tookOver) return true;
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) { debug(`takeover (${reason}): tabs.query failed: ${e.message}`); return false; }
  const summary = tabs.map((t) => `${t.id}:${t.url || t.pendingUrl || '?'}`).join(' ') || 'no tabs';
  if (tabs.some((t) => (t.url || '').startsWith(LAUNCHER_URL))) { tookOver = true; debug(`takeover (${reason}): already on launcher [${summary}]`); return true; }
  const idle = tabs.find((t) => isIdleUrl(t.url) && isIdleUrl(t.pendingUrl));
  try {
    if (idle) { await chrome.tabs.update(idle.id, { url: LAUNCHER_URL, active: true }); tookOver = true; debug(`takeover (${reason}): navigated tab ${idle.id} [${summary}]`); return true; }
    if (tabs.length === 0) { await chrome.tabs.create({ url: LAUNCHER_URL }); tookOver = true; debug(`takeover (${reason}): created tab`); return true; }
  } catch (e) {
    debug(`takeover (${reason}): failed: ${e.message} [${summary}]`);
    return false;
  }
  debug(`takeover (${reason}): nothing idle [${summary}]`);
  return false;
}

// The window and its first tab may not exist yet when the worker wakes, and a
// Pi 3 takes a while to get there, so keep trying for a minute.
function takeOverSoon(reason) {
  let n = 0;
  const tick = () => { if (!tookOver && n++ < 30) takeOver(`${reason} #${n}`).then((ok) => { if (!ok) setTimeout(tick, 2000); }); };
  tick();
}

// A lone tab that settles on about:blank is the kiosk's start page: take it.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (tookOver || info.status !== 'complete' || !isIdleUrl(tab.url)) return;
  const all = await chrome.tabs.query({});
  if (all.length === 1) takeOver('tab settled');
});
chrome.tabs.onCreated.addListener(() => { if (!tookOver) setTimeout(() => takeOver('tab created'), 300); });
chrome.windows.onCreated.addListener(() => { if (!tookOver) setTimeout(() => takeOver('window created'), 300); });

chrome.runtime.onStartup.addListener(async () => { debug('onStartup'); await boot(); takeOverSoon('startup'); });
chrome.runtime.onInstalled.addListener(async (d) => { debug(`onInstalled ${d.reason}`); await boot(); takeOverSoon('installed'); });
boot();
takeOverSoon('worker start');
