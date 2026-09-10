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

chrome.runtime.onStartup.addListener(async () => {
  await boot();
  // The kiosk start script opens about:blank; take the tab to the launcher.
  const tabs = await chrome.tabs.query({});
  const blank = tabs.find((t) => !t.url || t.url === 'about:blank' || t.url === 'chrome://newtab/');
  if (blank) chrome.tabs.update(blank.id, { url: LAUNCHER_URL });
  else if (tabs.length === 0) chrome.tabs.create({ url: LAUNCHER_URL });
});
chrome.runtime.onInstalled.addListener(boot);
boot();
