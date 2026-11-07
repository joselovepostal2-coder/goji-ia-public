"use strict";

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    // Keep the API key outside the packaged application, in the user's Windows profile.
    process.env.GOJI_CONFIG_PATH = path.join(app.getPath("userData"), ".goji-local.json");
    process.env.GOJI_LOCAL_PORT = "3000";

    // The same local backend used by the browser version.
    require("./local-server.js");

    const win = new BrowserWindow({
      width: 1360,
      height: 900,
      minWidth: 900,
      minHeight: 620,
      title: "GOJI AI · Goji Empires",
      backgroundColor: "#04050a",
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url);
      return { action: "deny" };
    });

    // Wait for the loopback server before loading the interface.
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:3000/api/health");
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    if (!ready) {
      const { dialog } = require("electron");
      dialog.showErrorBox("GOJI AI", "No se pudo iniciar el servidor local. Comprueba si el puerto 3000 está ocupado.");
      app.quit();
      return;
    }

    await win.loadURL("http://127.0.0.1:3000");
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
