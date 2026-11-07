"use strict";

const { app, BrowserWindow, shell, desktopCapturer, dialog, session } = require("electron");
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

    // Grant media permissions only to GOJI's own loopback page.
    // The page still asks through an explicit user action before opening camera/microphone.
    const isGojiOrigin = (origin) => {
      try { return new URL(origin).origin === "http://127.0.0.1:3000"; }
      catch { return false; }
    };
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const origin = details?.requestingUrl || details?.securityOrigin || webContents.getURL();
      if (!isGojiOrigin(origin)) { callback(false); return; }
      if (permission === "media") {
        const types = details?.mediaTypes || [];
        callback(types.includes("audio") || types.includes("video"));
        return;
      }
      if (permission === "display-capture") {
        callback(true);
        return;
      }
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      if (!isGojiOrigin(requestingOrigin || webContents?.getURL())) return false;
      if (permission === "media") {
        const types = details?.mediaType ? [details.mediaType] : [];
        return types.includes("audio") || types.includes("video");
      }
      return permission === "display-capture";
    });

    // Electron requires an explicit handler for getDisplayMedia.
    // Show a native Windows dialog so the user chooses which monitor to share.
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 320, height: 180 }
        });
        if (!sources.length) {
          callback({});
          return;
        }
        const buttons = sources.slice(0, 4).map((source, index) =>
          sources.length === 1 ? "Compartir pantalla" : "Pantalla " + (index + 1)
        );
        buttons.push("Cancelar");
        const choice = await dialog.showMessageBox(win, {
          type: "question",
          title: "GOJI AI · Transmisor",
          message: "¿Qué pantalla quieres compartir?",
          buttons,
          cancelId: buttons.length - 1,
          defaultId: 0,
          noLink: true
        });
        if (choice.response < 0 || choice.response >= sources.length || choice.response >= 4) {
          callback({});
          return;
        }
        callback({ video: sources[choice.response] });
      } catch (error) {
        console.error("GOJI screen capture:", error);
        callback({});
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
