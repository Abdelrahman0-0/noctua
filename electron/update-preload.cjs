// Bridge between the update window and the app: the page can only ask for these four actions.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("noctua", {
  act: (name) => { if (["download", "later", "install", "close"].includes(name)) ipcRenderer.send("noctua-update", name); },
  onState: (cb) => ipcRenderer.on("noctua-state", (_e, s) => cb(s)),
});
