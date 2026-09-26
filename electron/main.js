/**
 * electron/main.js
 * Wraps the existing frontend (unchanged) in a transparent, always-on-top,
 * borderless window — the "desktop overlay / pet mode" way of running
 * Yumi. This is a thin packaging layer: it does not duplicate any of the
 * frontend logic, it just points a BrowserWindow at the same frontend
 * server you'd otherwise open in a normal browser tab.
 *
 * SETUP:
 *   cd electron
 *   npm install
 *   npm start
 *
 * Make sure both are already running first, same as the normal setup:
 *   - the backend:  uvicorn backend.server:app --port 8000   (from repo root)
 *   - the frontend: python3 -m http.server 5500               (from frontend/)
 *
 * For this to actually look like an overlay (not a white/black rectangle),
 * set Background mode to "Transparent" in the in-app settings drawer
 * (gear icon, top right) before or after this window opens.
 */

const { app, BrowserWindow, screen } = require('electron');

// Point this at wherever your frontend static server is running.
const FRONTEND_URL = 'http://localhost:5500/index.html?obs=1';

function createOverlayWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: Math.round(width * 0.35),
    height: Math.round(height * 0.7),
    x: width - Math.round(width * 0.35) - 40,
    y: height - Math.round(height * 0.7) - 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    skipTaskbar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadURL(FRONTEND_URL);

  // Note on click-through: a fully click-through overlay (so clicks pass
  // to whatever's behind it, e.g. a game) needs setIgnoreMouseEvents,
  // which then also blocks YOUR clicks on her. A common approach is to
  // toggle it with a global keyboard shortcut; left as a deliberate next
  // step rather than guessed at here, since the right shortcut/behavior
  // is a personal preference call, not a technical default.
  // Example: win.setIgnoreMouseEvents(true, { forward: true });

  return win;
}

app.whenReady().then(() => {
  createOverlayWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlayWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
