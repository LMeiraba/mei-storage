const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, Notification } = require("electron");
const fs = require('fs');
const os = require('os');
const path = require('path');
const Store = require("electron-store");
const store = new Store();
const { spawn } = require("child_process");
const poolManager = require("./pool-manager");
let win;
let tray;
const CONFIG_PATH = path.join(
    os.platform() === 'win32' ? process.env.APPDATA : path.join(os.homedir(), '.config'),
    'rclone',
    'rclone.conf'
);
const configDir = path.dirname(CONFIG_PATH);
if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
}
let connection = true
let notifications = []
const isDev = !app.isPackaged;
const basePath = isDev ? __dirname : path.join(process.resourcesPath, 'app.asar');
const rclonePath = path.join(isDev ? __dirname : process.resourcesPath, 'bin', 'rclone.exe');
let userDataPath = app.getPath("userData");
let settingsPath = isDev
    ? path.join(__dirname, "settings.json")
    : path.join(userDataPath, "settings.json");
let destIcon = path.join(__dirname, "icon.ico")
console.log(settingsPath)
let config_jsonPATH = path.join(basePath, 'config.json')
let _paths = {
    config: CONFIG_PATH,
    rclone: rclonePath,
    base: basePath,
    userData: userDataPath,
    settings: settingsPath,
    icon: destIcon,
    config_json: JSON.parse(fs.readFileSync(config_jsonPATH, 'utf-8'))
}
if (!fs.existsSync(_paths.config)) {
    fs.writeFileSync(CONFIG_PATH, stringifyINI({}), 'utf-8')
}
if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify({ pools: [], drives: [], app: {version: app.getVersion()} }, null, 2));
}
console.log(app.getVersion())
updateConfig()
if (!isDev) {
    const srcIcon = path.join(_paths.base, "icon.ico");
    _paths.icon = path.join(_paths.userData, "icon.ico");
    try {
        if (fs.existsSync(srcIcon) && !fs.existsSync(_paths.icon)) {
            fs.copyFileSync(srcIcon, _paths.icon);
        }
    } catch (err) {
        console.error("Failed to copy icon.ico:", err);
    }
}
function createWindow() {
    const windowBounds = store.get("windowBounds", { width: 900, height: 600 });

    win = new BrowserWindow({
        ...windowBounds,
        icon: path.join(_paths.base, "icon.ico"),
        webPreferences: {
            preload: path.join(_paths.base, "preload.js"),
        },
    });

    win.loadFile("renderer.html");
    win.setMenu(null)
    if (isDev) win.webContents.openDevTools();
    win.webContents.on("did-fail-load", (_, errorCode, errorDescription) => {
        console.error("Renderer failed to load:", errorDescription);
    });
    win.on("resize", () => store.set("windowBounds", win.getBounds()));
    win.on("move", () => store.set("windowBounds", win.getBounds()));
    // Instead of quitting when closed, just hide
    win.on("close", (event) => {
        event.preventDefault();
        win.hide();
    });
    win.once("ready-to-show", () => {
        win.show();
    });
}
function createTray() {
    tray = new Tray(path.join(basePath, "icon.ico"));

    const contextMenu = Menu.buildFromTemplate([
        {
            label: "Show App",
            click: () => {
                win.show();
            },
        },
        {
            label: "Quit",
            click: async () => {
                await poolManager.unmountAll()
                if (tray) tray.destroy();
                app.removeAllListeners("window-all-closed");
                app.exit(0);
            },
        },
    ]);

    tray.setToolTip("MEI Storage");
    tray.setContextMenu(contextMenu);

    tray.on("double-click", () => {
        win.show();
    });
}
ipcMain.handle("get-pools", async () => {
    //also updates setting.json from the orgs
    // const SETTINGS_PATH = path.join(basePath, 'app.asar', 'settings.json');
    let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))

    if (!fs.existsSync(_paths.config)) return [];
    const content = fs.readFileSync(_paths.config, 'utf8');
    const parsed = parseINI(content);

    let existing_names = settings.pools.map(p => p.name)
    let new_from_config = Object.entries(parsed)
        .filter(([name, config]) => (!existing_names.includes(name) && config.type === 'union'))
        .map(([name, config]) => ({
            ...config,
            name,
            remotes: config.upstreams.split(':/').map(s => s.trim()).filter(s => s.length)
        }));
    console.log(`Found ${new_from_config.length} new pools from config.`);
    settings.pools = settings.pools.concat(new_from_config)
    fs.writeFileSync(_paths.settings, JSON.stringify(settings, null, 2), 'utf-8');
    let x = settings.pools.map(pool => {
        return {
            ...pool,
            name: pool.name,
            label: pool.label || pool.name,
            remotes: pool.remotes,
            mountPoint: pool.mountPoint,
            mounted: poolManager.activeMounts.pools.find(p => p.name === pool.name)?.mounted ? true : false,
        };
    })
    return x
})
ipcMain.handle("get-drives", async () => {
    // const SETTINGS_PATH = path.join(basePath, 'app.asar', 'settings.json');
    let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
    if (!fs.existsSync(_paths.config)) return [];
    const content = fs.readFileSync(_paths.config, 'utf8');
    const parsed = parseINI(content);

    const DRIVE_TYPES = [
        "drive", "onedrive", "dropbox", "box", "mega", "pcloud",
        "yandex", "seafile", "webdav", "s3", "gcs", "azureblob", "aliyundrive"
    ];
    let existing_names = settings.drives.map(d => d.name)
    let new_from_config = Object.entries(parsed)
        .filter(([name, config]) => (!existing_names.includes(name) && DRIVE_TYPES.includes(config.type)))
        .map(([name, config]) => ({
            name,
            type: config.type,
            user: config.user
        }))
    settings.drives = settings.drives.concat(new_from_config)
    fs.writeFileSync(_paths.settings, JSON.stringify(settings, null, 2), 'utf-8');
    console.log(`Found ${new_from_config.length} new drives from config.`);
    return settings.drives.map(drive => {
        return {
            ...drive,
            name: drive.name,
            type: drive.type,
            label: drive.label || drive.name,
            mountPoint: drive.mountPoint,
            mounted: poolManager.activeMounts.drives.find(d => d.name === drive.name) ? true : false,
        };
    });
});
ipcMain.handle("unmount-pool", async (event, poolName) => {
    return await poolManager.unmountPool(poolName);
});
ipcMain.handle("unmount-drive", async (event, driveName) => {
    return await poolManager.unmountDrive(driveName);
});
ipcMain.handle("single-mount", async (event, name, type) => {
    return await poolManager.singleMount(name, type, _paths);
});
ipcMain.handle("get-usage", async (event, name, type) => {
    return await poolManager.getUsage(name, type, _paths);
});
ipcMain.handle("delete", async (event, name, type) => {
    if (type === "pool") {
        await poolManager.deletePool(name, _paths);
    } else if (type === "drive") {
        await poolManager.deleteDrive(name, _paths);
    }
    return true;
});
ipcMain.handle("get-activity", async () => {
    return await poolManager.getActivity(_paths);
})
ipcMain.handle("edit", async (event, type, data) => {
    if (type === "pool") {
        await poolManager.editPool(data, _paths);
    } else if (type === "drive") {
        await poolManager.editDrive(data, _paths);
    }
    return true;
});
ipcMain.handle("add", async (event, type, data) => {
    if (type === "pool") {
        await poolManager.addPool(data, _paths);
    } else if (type === "drive") {
        await poolManager.addDrive(data, _paths);
    }
    return true;
})
ipcMain.handle('get-used-mounts', async () => {
    try {
        const settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'));
        return [
            ...settings.pools?.filter(p => p.startup).map(p => p.mountPoint) || [],
            ...settings.drives?.filter(d => d.startup).map(d => d.mountPoint) || []
        ];
    } catch (err) {
        console.error('get-used-mounts failed:', err.message);
        return [];
    }
})
ipcMain.handle('select-icon-file', async () => {
    const result = await dialog.showOpenDialog({
        title: 'Select Icon File',
        properties: ['openFile'],
        filters: [
            { name: 'Icons', extensions: ['ico'] }
        ]
    });
    return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('get-noti', async (event, filter) => {
    if (filter) {
        console.log(`filtering: ${filter}`)
        notifications = notifications.filter(n => n.id !== filter)
    }
    return notifications
})
//auth flow 
let auth_process = null
ipcMain.on('start-auth', (event, d) => {
    if (d === 'cancel') {
        auth_process.kill()
        return
    }
    let types = {
        "Google Drive": 'drive'
    }
    d.type = types[d.type] ?? 'drive'
    const proc = spawn(_paths.rclone, ['authorize', d.type || 'drive']);
    auth_process = proc
    let output = '';

    proc.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        event.sender.send('auth-log', `${text}`);
    });

    proc.stderr.on('data', (data) => {
        const text = data.toString();
        event.sender.send('auth-log', `${text}`);
    });

    proc.on('close', (code) => {
        if (code !== 0) {
            return event.sender.send('auth-log', `[ERR] Authorization failed`);
        }

        const match = output.match(/\{[\s\S]*\}/);
        if (!match) {
            return event.sender.send('auth-log', `[ERR] Token not found`);
        }

        const token = match[0];
        event.sender.send('auth-complete', token, d); // send token on success
    });
});
app.whenReady().then(async () => {
    const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
    createWindow();
    createTray();

    // Mount drives either way
    poolManager.updateRcloneConfig(_paths);
    poolManager.mountPools(_paths);

    if (!openedAtLogin || isDev) {
        win.show(); // Show only if NOT auto-launched or if in dev
    } else {
        win.hide(); // Silent startup on boot
    }

    // Add to startup only in packaged mode
    if (app.isPackaged) {
        app.setLoginItemSettings({
            openAtLogin: true,
            path: process.execPath,
        });
    }
});
function updateConfig() {
    let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
    _paths.config_json = {
        ..._paths.config_json,
        ...settings.app
    }
}
function parseINI(str) {
    const result = {};
    let section = null;
    for (const line of str.split(/\r?\n/)) {
        if (/^\s*(;|#|$)/.test(line)) continue;
        const match = line.match(/^\s*\[(.+?)\]\s*$/);
        if (match) {
            section = match[1];
            result[section] = {};
        } else if (section) {
            const kv = line.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
            if (kv) result[section][kv[1]] = kv[2];
        }
    }
    return result;
}
function stringifyINI(data) {
    return Object.entries(data)
        .map(([section, values]) => {
            const lines = Object.entries(values).map(([k, v]) => `${k} = ${v}`);
            return `[${section}]\n${lines.join('\n')}`;
        })
        .join('\n\n');
}

async function checkAlive() {
    //if mount failed? no connection(internet)
    let online = await isOnline()
    console.log(`is online? ${online}, prev: ${connection}`)
    if (connection && !online) {
        connection = false
        // poolManager.activeMounts.drives?.filter(d => !d.error).map(d => ({
        //     ...d,
        //     mounted: false,
        //     error: 1
        // }))
        // poolManager.activeMounts.pools?.filter(d => !d.error).map(p => ({
        //     ...p,
        //     mounted: false,
        //     error: 1
        // }))
        poolManager.activeMounts.pools = poolManager.activeMounts.pools.map(p => {
            if (!p.error) {
                p.error = 1,
                p.mounted = false
            }
            return p
        })
        poolManager.activeMounts.drives = poolManager.activeMounts.drives.map(p => {
            if (!p.error) {
                p.error = 1,
                p.mounted = false
            }
            return p
        })
        sendNoti({
            title: `Connection lost..`,
            body: `Existing mount will work after connection is restored.`,
            icon: _paths.icon,
            silent: false,
            urgency: 'normal',
            // actions: [{ type: 'button', text: 'Open Folder' }],
            closeButtonText: 'Close',
        })
    } else if (online && !connection) {
        //connected
        //retry the error type 2
        poolManager.activeMounts.pools = poolManager.activeMounts.pools.map(p => {
            if (p.error === 1) {
                p.error = null,
                p.mounted = true
            }
            return p
        })
        poolManager.activeMounts.drives = poolManager.activeMounts.drives.map(p => {
            if (p.error === 1) {
                p.error = null,
                p.mounted = true
            }
            return p
        })
        connection = true
        let all = [
            ...poolManager.activeMounts.pools.filter(r => r.error === 2),
            ...poolManager.activeMounts.drives.filter(r => r.error === 2)
        ]
        if (all.length) {
            all.forEach(async (data) => {
                data.retry = true
                await poolManager.startMount(data, data.type, _paths.rclone, _paths.config_json.rc)
            })
        }
        sendNoti({
            title: "Back online",
            body: `All existing mounts will work fine.`,
            icon: _paths.icon,
            silent: false,
            urgency: 'normal',
            closeButtonText: 'Close',
        })
    }
    let pool_e = poolManager.activeMounts.pools.filter(r => r.error === 2 && !r.noti)
    let drive_e = poolManager.activeMounts.drives.filter(r => r.error === 2 && !r.noti)
    if (pool_e) {
        poolManager.activeMounts.pools = poolManager.activeMounts.pools.map(p => {
            if (p.error === 2 && !p.noti) {
                sendNoti({
                    title: `Mount Failed - ${p.mountPoint}`,
                    body: `Mounting remote failed: ${p.name}`
                })
                p.noti = true
            }
            return p
        })
    }
    if (drive_e) {
        poolManager.activeMounts.drives = poolManager.activeMounts.drives.map(p => {
            if (p.error === 2 && !p.noti) {
                sendNoti({
                    title: `Mount Failed - ${p.mountPoint}`,
                    body: `Mounting remote failed: ${p.name}`
                })
                p.noti = true
            }
            return p
        })
    }
    // check for "CRITICAL: Failed to create file system for" in stout??(if failed at startup)
    // or constantly make req to the rc for each one (also gives the same even if no internet)
    // check if there is error in the mountedremotes object??
    // maybe check the usage or ls, using rclone.exe??
}
async function sendNoti(data) {
    const notification = new Notification(data);

    // notification.on('action', (a) => {
    //     console.log(`action??`, a)
    // });
    notifications.push({
        ...data,
        time: (new Date()).getTime(),
        id: generateId()
    })
    const mainWindow = BrowserWindow.getAllWindows()[0]; // or use a stored variable

    notification.on('click', async() => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('open-tab', 'notification');
        }
    });
    notifications = notifications.slice(0, 50)
    notification.show();
    return notification
}
async function isOnline() {
    try {
        const res = await fetch('https://www.google.com/favicon.ico', { method: 'HEAD', cache: 'no-store' });
        return res.ok;
    } catch {
        return false;
    }
}
function generateId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
}
setInterval(async () => {
    await checkAlive()
}, 10000);
// setInterval(async () => {
//     let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
//     let to_get = settings.drives.filter(d => !d.user)
//     const content = fs.readFileSync(_paths.config, 'utf8');
//     const config = parseINI(content);
//     if (config[to_get[0].name] && config?.[to_get[0].name]?.type === to_get[0].type) {
//         //exist
//         let mail = await poolManager.getEmail(config[to_get[0].name].token)
//         console.log(mail)
//         if (mail) {
//             let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
//             let index = settings.drives.findIndex(d => d.name === to_get[0].name)
//             if (index !== -1) {
//                 settings.drives[index] = {
//                     ...settings.drives[index],
//                     user: mail
//                 };
//             }
//             fs.writeFileSync(_paths.settings, JSON.stringify(settings, null, 2), 'utf-8');
//         }
//     }

// }, 40000);