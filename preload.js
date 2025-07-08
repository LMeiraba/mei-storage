const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("driveAPI", {
    getPools: () => ipcRenderer.invoke("get-pools"),
    getDrives: () => ipcRenderer.invoke("get-drives"),
    getActivity: () => ipcRenderer.invoke("get-activity"),
    unmountPool: (name) => ipcRenderer.invoke("unmount-pool", name),
    unmountDrive: (name) => ipcRenderer.invoke("unmount-drive", name),
    singleMount: (name, type) => ipcRenderer.invoke("single-mount", name, type),
    getUsage: (name, type) => ipcRenderer.invoke("get-usage", name, type),
    delete: (name, type) => ipcRenderer.invoke("delete", name, type),
    edit: (type, data) => ipcRenderer.invoke("edit", type, data),
    add: (type, data) => ipcRenderer.invoke("add", type, data),
    getUsedMounts: () => ipcRenderer.invoke('get-used-mounts'),
    startAuth: (data) => ipcRenderer.send('start-auth',data),
    onLog: (cb) => ipcRenderer.on('auth-log', (_, msg) => cb(msg)),
    onComplete: (cb) => ipcRenderer.on('auth-complete', (_, token,d) => cb(token, d)),
});