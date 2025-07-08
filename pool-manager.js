const fs = require('fs');
const os = require('os');
const path = require('path');
const getPort = require('get-port');
const { spawn, exec } = require('child_process');
const sudo = require('sudo-prompt');

const activeMounts = {
    pools: [],
    drives: []
};

// const CONFIG_PATH = path.join(
//     os.platform() === 'win32' ? process.env.APPDATA : path.join(os.homedir(), '.config'),
//     'rclone',
//     'rclone.conf'
// );

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

function updateRcloneConfig(_paths) {
    let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
    settings.pools = settings.pools.filter(p => p.remotes.length >= 2)
    let config = {};
    if (fs.existsSync(_paths.config)) {
        const raw = fs.readFileSync(_paths.config, 'utf-8');
        config = parseINI(raw);
    }

    for (const pool of settings.pools) {
        config[pool.name] = {
            type: 'union',
            upstreams: pool.remotes.map(r => `${r}:/`).join(' ')
        };
    }

    fs.writeFileSync(_paths.config, stringifyINI(config), 'utf-8');
    console.log(`✅ rclone.conf updated with ${settings.pools.length} pool(s).`);
}

// Mount every pool, for startup
async function mountPools(_paths) {
    let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
    settings.pools = settings.pools.filter(p => p.remotes.length >= 2 && p.startup)

    const rclonePath = _paths.rclone

    for (const pool of settings.pools) {
        console.log(`🚀 Mounting ${pool.name} -> ${pool.mountPoint}`);
        // const child = spawn(rclonePath, [
        //     'mount', `${pool.name}:`, pool.mountPoint,
        //     '--vfs-cache-mode', 'full',
        //     '--log-level', 'INFO'
        // ], {
        //     detached: true,
        //     stdio: 'ignore'
        // });
        // child.unref();
        // activeMounts[pool.name] = child;
        await startMount(pool, 'pools', rclonePath);
    }
    //set drive icons for all
    setDriveIcon(settings.pools.map(p => p.mountPoint), _paths.icon);
}
function singleMount(name, type, _paths) {
    let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
    let data = settings[`${type}s`].find(d => d.name === name)
    if (!data.mountPoint) return 'No mount point specified for this drive/pool';
    const rclonePath = _paths.rclone
    console.log(data)
    let m = startMount(data, `${type}s`, rclonePath);
    console.log(m)
    setDriveIcon([data.mountPoint], _paths.icon);
    return m
}
async function unmountPool(poolName) {
    const proc = activeMounts.pools.find(p => p.name === poolName).child;

    if (!proc) {
        console.log(`No active mount found for pool ${poolName}`);
        return false;
    }

    try {
        proc.kill();
        console.log(`Unmounted ${poolName}`);
        activeMounts.pools = activeMounts.pools.filter(p => p.name !== poolName);
        return true
    } catch (err) {
        console.error(`Failed to kill process for ${poolName}`, err);
        return false
    }
}
async function unmountDrive(driveName) {
    const proc = activeMounts.drives.find(d => d.name === driveName).child;
    if (!proc) {
        console.log(`No active mount found for drive ${driveName}`);
    }
    try {
        proc.kill();
        console.log(`Unmounted ${driveName}`);
        activeMounts.drives = activeMounts.drives.filter(d => d.name !== driveName);
        return true
    } catch (err) {
        console.error(`Failed to kill process for ${driveName}`, err);
        return false
    }
}
function unmountAll() {
    for (const pools of activeMounts.pools) {
        unmountPool(pools.name);
    }
}
function deletePool(poolName,_paths) {
    let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
    if (!fs.existsSync(_paths.config)) return [];
    const content = fs.readFileSync(_paths.config, 'utf8');
    const parsed = parseINI(content);
    if (parsed[poolName] && parsed[poolName].type === 'union') {
        let mounted = activeMounts.pools.filter(p => p.name === poolName)
        if(mounted) unmountPool(poolName)
        delete parsed[poolName];
        settings.pools = settings.pools.filter(p => p.name !== poolName);
        fs.writeFileSync(_paths.settings, JSON.stringify(settings, null, 2), 'utf-8');
        fs.writeFileSync(_paths.config, stringifyINI(parsed), 'utf-8');
        return true
    } else {
        return false
    }
}
function deleteDrive(driveName,_paths) {
    let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
    if (!fs.existsSync(_paths.config)) return [];
    const content = fs.readFileSync(_paths.config, 'utf8');
    const parsed = parseINI(content);
    if (parsed[driveName] && parsed[driveName].type !== 'union') {
        let mounted = activeMounts.drives.filter(d => d.name === driveName)
        if(mounted) unmountDrive(driveName)
        delete parsed[driveName];
        settings.drives = settings.drives.filter(d => d.name !== driveName);
        fs.writeFileSync(_paths.settings, JSON.stringify(settings, null, 2), 'utf-8');
        fs.writeFileSync(_paths.config, stringifyINI(parsed), 'utf-8');
        return true
    } else {
        return false
    }
}
async function getUsage(name, type, _paths) {
    const rclonePath = _paths.rclone
    const settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'));

    let remotes = [];

    if (type === 'drive') {
        remotes = [name];
    } else if (type === 'pool') {
        const pool = settings.pools.find(p => p.name === name);
        if (!pool) return Promise.resolve({ drives: [], usage: [] });
        remotes = pool.remotes;
    }
    console.log('getting usage')
    return Promise.all(
        remotes.map(remote =>
            new Promise(resolve => {
                exec(`${rclonePath} about ${remote}: --json`, (err, stdout) => {
                    if (err) return resolve({ total: null, used: null, free: null });

                    try {
                        const data = JSON.parse(stdout);
                        resolve({
                            total: data.total,
                            used: data.used,
                            free: data.free
                        });
                    } catch {
                        resolve({ total: null, used: null, free: null });
                    }
                });
            })
        )
    ).then(usage => ({ drives: remotes, usage }));
}

async function getActivity() {
    //how to filter syncing files from actual transfer??
    const combinedMounts = [
        ...activeMounts.pools.map((m, i) => ({ ...m, mountIndex: i, mountType: 'pool' })),
        ...activeMounts.drives.map((m, i) => ({ ...m, mountIndex: i + activeMounts.pools.length, mountType: 'drive' }))
    ];

    const allTransfers = (
        await Promise.all(
            combinedMounts.map(m => getTransfersForMount(m, m.mountIndex, m.mountType))
        )
    ).flat();

    const transferring = allTransfers.filter(t => t.type === 'transferring');
    const transferred = allTransfers
        .filter(t => t.type === 'transferred')
        .sort((a, b) => b.time - a.time); // newest first

    // transferring sorted by mountIndex
    transferring.sort((a, b) => a.mountIndex - b.mountIndex);
    console.log([...transferring, ...transferred])
    return [...transferring, ...transferred];
}
function addPool(data, _paths) {
    let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
    if (!fs.existsSync(_paths.config)) return [];
    const content = fs.readFileSync(_paths.config, 'utf8');
    const parsed = parseINI(content);

    parsed[data.name] = {
        type: 'union',
        upstreams: data.remotes.map(r => `${r}:/`).join(' ')
    };
    fs.writeFileSync(_paths.config, stringifyINI(parsed), 'utf-8');
    settings.pools.push({
        name: data.name,
        label: data.label || data.name,
        remotes: data.remotes,
        mountPoint: data.mountPoint,
        startup: data.startup || false
    });
    fs.writeFileSync(_paths.settings, JSON.stringify(settings, null, 2), 'utf-8');
}
function addDrive(data, _paths) {
    let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
    if (!fs.existsSync(_paths.config)) return [];
    const content = fs.readFileSync(_paths.config, 'utf8');
    const parsed = parseINI(content);

    parsed[data.name] = {
        type: data.type,
        token: data.token
    };
    fs.writeFileSync(_paths.config, stringifyINI(parsed), 'utf-8');
    settings.drives.push({
        name: data.name,
        label: data.label || data.name,
        type: data.type,
        mountPoint: data.mountPoint,
        startup: data.startup || false
    });
    fs.writeFileSync(_paths.settings, JSON.stringify(settings, null, 2), 'utf-8');
}
function editPool(data, _paths) {
    let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
    if (!fs.existsSync(_paths.config)) return [];
    const content = fs.readFileSync(_paths.config, 'utf8');
    const parsed = parseINI(content);

    parsed[data.name] = {
        type: 'union',
        upstreams: data.remotes.map(r => `${r}:/`).join(' ')
    };
    fs.writeFileSync(_paths.config, stringifyINI(parsed), 'utf-8');
    settings.pools = settings.pools.filter(p => p.name!==data.name)
    settings.pools.push({
        name: data.name,
        label: data.label || data.name,
        remotes: data.remotes,
        mountPoint: data.mountPoint,
        startup: data.startup || false
    });
    fs.writeFileSync(_paths.settings, JSON.stringify(settings, null, 2), 'utf-8');
}
function editDrive(data, _paths) {
    let settings = JSON.parse(fs.readFileSync(_paths.settings, 'utf-8'))
    settings.drives = settings.drives.filter(d => d.name !== data.name)
    settings.drives.push({
        name: data.name,
        label: data.label || data.name,
        mountPoint: data.mountPoint,
        startup: data.startup || false
    });
    fs.writeFileSync(_paths.settings, JSON.stringify(settings, null, 2), 'utf-8');
}
module.exports = {
    updateRcloneConfig,
    mountPools,
    unmountPool,
    unmountAll,
    unmountDrive,
    singleMount,
    addPool,
    addDrive,
    deletePool,
    deleteDrive,
    getUsage,
    getActivity,
    editPool,
    editDrive,
    activeMounts
}
function setDriveIcon(driveLetters, iconPath) {
    console.log(`icon: ${iconPath}`)
    // If path is like 'X:', convert to just 'X'
    let cmds = []
    for (let i = 0; i < driveLetters.length; i++) {
        const letter = driveLetters[i].replace(':', '').toUpperCase();
        const escapedIconPath = iconPath.replace(/\\/g, '\\\\');

        cmds.push(`
    New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\DriveIcons\\${letter}' -Force;
    New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\DriveIcons\\${letter}\\DefaultIcon' -Force;
    Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\DriveIcons\\${letter}\\DefaultIcon' -Name '(default)' -Value '${escapedIconPath}';
  `)
    }
    cmds = cmds.join('\n');
    sudo.exec(
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmds.replace(/\n/g, '')}"`,
        { name: 'My Drive App' },
        (error, stdout, stderr) => {
            if (error) console.error('❌ Admin command failed:', error);
            else console.log('✅ Icon set.');
        }
    );
}
async function startMount(data, type, rclonePath) {
    try {
        const port = await getPort()
        const child = spawn(rclonePath, [
            'mount', `${data.name}:`, data.mountPoint,
            '--vfs-cache-mode', 'full',
            '--rc',
            '--rc-no-auth',
            `--rc-addr=localhost:${port}`,
            '--log-level', 'DEBUG',
            // `--log-file=${data.name}.log`,
            '--stats=5s',
            `--volname`, data.label ?? data.name,
        ], {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
        activeMounts[type].push({
            name: data.name,
            mountPoint: data.mountPoint,
            child: child,
            port: port
        })
        console.log(activeMounts)
        console.log(`🚀 Mounted ${data.name} -> ${data.mountPoint}`);
        return true
    } catch (e) {
        console.log(e)
        return false
    }

}
async function getTransfersForMount(mount, mountIndex, mountType) {
    const base = `http://localhost:${mount.port}`;
    let active = [];
    let completed = [];

    try {
        const statsRes = await fetch(`${base}/core/stats`, { method: 'POST' });
        const stats = await statsRes.json();
        active = (stats.transferring || []).map(item => ({
            ...item,
            mount_name: mount.name,
            type: 'transferring',
            mountIndex,
            mountType
        }));
    } catch (e) {
        console.error(`Error fetching /core/stats from ${mount.name}:`, e.message);
    }

    try {
        const doneRes = await fetch(`${base}/core/transferred`, { method: 'POST' });
        const done = await doneRes.json();
        completed = (done.transferred || []).map(item => ({
            ...item,
            mount_name: mount.name,
            type: 'transferred',
            time: new Date(item.completed_at || item.started_at || Date.now()).getTime(),
            mountIndex,
            mountType
        }));
    } catch (e) {
        console.error(`Error fetching /core/transferred from ${mount.name}:`, e.message);
    }

    return [...active, ...completed];
}
async function checkAlive() {
    //if mount failed? no connection(internet)
}
async function getEmail(token) {
    fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
  headers: {
    Authorization: `Bearer ${token.access_token}`
  }
})
  .then(res => res.json())
  .then(data => {
    console.log(data)
    console.log('📧 Email:', data.user.emailAddress);
  })
  .catch(err => {
    console.error('❌ Error fetching email:', err);
  });
} 