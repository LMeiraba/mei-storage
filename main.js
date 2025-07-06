const { app, BrowserWindow, ipcMain, Tray, Menu } = require("electron");
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
const isDev = !app.isPackaged;
const basePath = isDev ? __dirname : path.join(process.resourcesPath);
console.log(basePath)
const rclonePath = path.join(basePath, 'bin', 'rclone.exe');
function createWindow() {
    const windowBounds = store.get("windowBounds", { width: 900, height: 600 });

    win = new BrowserWindow({
        ...windowBounds,
        icon: path.join(basePath, "icon.ico"),
        webPreferences: {
            preload: path.join(basePath, "preload.js"),
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
    const SETTINGS_PATH = path.join(basePath, 'settings.json');
    let settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
    if (!fs.existsSync(CONFIG_PATH)) return [];
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = parseINI(content);

    let existing_names = settings.pools.map(p => p.name)
    let new_from_config = Object.entries(parsed)
        .filter(([name, config]) => (!existing_names.includes(name) && config.type === 'union'))
        .map(([name, config]) => ({
            name,
            remotes: config.upstreams.split(':/').map(s => s.trim())
        }));
    console.log(`Found ${new_from_config.length} new pools from config.`);
    settings.pools = settings.pools.concat(new_from_config)
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    let x = settings.pools.map(pool => {
        return {
            ...pool,
            name: pool.name,
            label: pool.label || pool.name,
            remotes: pool.remotes,
            mountPoint: pool.mountPoint,
            mounted: poolManager.activeMounts.pools.find(p => p.name === pool.name) ? true : false,
        };
    })
    return x
})
ipcMain.handle("get-drives", async () => {
    const SETTINGS_PATH = path.join(basePath, 'settings.json');
    let settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
    if (!fs.existsSync(CONFIG_PATH)) return [];
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
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
        }))
    settings.drives = settings.drives.concat(new_from_config)
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
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
    return await poolManager.singleMount(name, type,basePath);
});
ipcMain.handle("get-usage", async (event, name, type) => {
    return await poolManager.getUsage(name, type,basePath);
});
ipcMain.handle("delete", async (event, name, type) => {
    if (type === "pool") {
        await poolManager.deletePool(name,basePath);
    } else if (type === "drive") {
        await poolManager.deleteDrive(name,basePath);
    }
    return true;
});
ipcMain.handle("get-activity", async () => {
    return await poolManager.getActivity();
})
ipcMain.handle("edit", async (event,type, data) => {
    if (type === "pool") {
        await poolManager.editPool(data,basePath);
    } else if (type === "drive") {
        await poolManager.editDrive(data,basePath);
    }
    return true;
});
ipcMain.handle("add", async (event,type, data) => {
    if (type === "pool") {
        await poolManager.addPool(data,basePath);
    } else if (type === "drive") {
        await poolManager.addDrive(data,basePath);
    }
    return true;
})
ipcMain.on('start-auth', (event,d) => {
  const proc = spawn(rclonePath, ['authorize', d.type || 'drive']);

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
    event.sender.send('auth-complete', token,d); // send token on success
  });
});
app.whenReady().then(async() => {
    const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;

    createTray();

    // Mount drives either way
    poolManager.updateRcloneConfig(basePath);
    poolManager.mountPools(basePath);
    createWindow();

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
// setInterval(async() => {
//     await poolManager.getActivity();
// }, interval = 5000); // Adjust interval as needed