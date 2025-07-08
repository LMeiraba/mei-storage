async function mount() {
    const statusDiv = document.getElementById("status");
    const results = await window.driveAPI.mountPools();

    statusDiv.innerHTML = "";
    results.forEach(pool => {
        statusDiv.innerHTML += `<p><strong>${pool.name}</strong> mounted at ${pool.mountPoint} (PID: ${pool.pid})</p>`;
    });
}

let poolRefreshInterval = null;
let driveRefreshInterval = null;
function showTab(tabName) {
    console.log(`Switching to tab: ${tabName}`);
    const tabs = document.querySelectorAll(".tab");
    const menuItems = document.querySelectorAll(".menu li");

    tabs.forEach(tab => {
        tab.style.display = tab.id === tabName ? "block" : "none";
    });

    menuItems.forEach(item => {
        item.classList.toggle("active", item.id === `tab-${tabName}`);
    });
    if (tabName !== "pools" && poolRefreshInterval) {
        clearInterval(poolRefreshInterval);
        poolRefreshInterval = null;
    }
    if (tabName !== "drives" && driveRefreshInterval) {
        clearInterval(driveRefreshInterval);
        driveRefreshInterval = null;
    }
}
function renderPools(pools) {
    const container = document.getElementById("pools-container");
    container.innerHTML = ""; // clear before render
    const addCard = document.createElement("div");
    addCard.className = "add-card";
    addCard.textContent = "＋ Create Pool";
    addCard.onclick = handleAddPool;
    container.appendChild(addCard);
    pools.forEach(pool => {
        const isMounted = pool.mounted === true; // Use the boolean directly
        const statusColor = isMounted ? "rgba(0, 255, 0, 0.08)" : "rgba(255, 0, 0, 0.08)";
        const statusText = isMounted ? "Mounted" : "Not mounted";

        const card = document.createElement("div");
        card.className = "pool-card";
        card.style.backgroundColor = statusColor;

        card.innerHTML = `
    <div class="card-header">
      <div>
        <h2>${pool.mountPoint??''} ${pool.label}</h2>
        <small>${pool.name}</small>
      </div>
      <div class="card-actions">
        <button ${pool.mounted ? 'disabled' : ''} onclick="showConfirmation('Mount this pool?', 'handleMount', '${pool.name}', 'pool')">🔼 Mount</button>
        <button ${!pool.mounted ? 'disabled' : ''} onclick="showConfirmation('Unmount this pool?', 'handleUnmount','${pool.name}','pool')">🟥 Unmount</button>
        <button ${!pool.mounted ? 'disabled' : ''} onclick="showConfirmation('Remount this pool?', 'handleRemount','${pool.name}','pool')">🔁 Remount</button>
      </div>
    </div>
    <div class="card-body">
      <div class="remotes-list">
        ${pool.remotes.join(", ")}
      </div>
      <div class="card-controls">
          <button onclick="handleEdit('${pool.name}','pool')">Edit</button>
          <button onclick="handleUsage('${pool.name}','pool')">📊 Usage</button>
          <button class="danger" onclick="showConfirmation('Delete this pool?', 'handleDelete','${pool.name}','pool')">🗑️ Delete</button>
      </div>
    </div>
    <div class="status-indicator">
      <span class="startup"style="color: #4caf50">${pool.startup? '🚀Startup  ':``}</span>
      <span class="status-dot ${isMounted ? 'online' : 'offline'}"></span>
      <span class="status-text">${statusText}</span>
    </div>
  `;
        container.appendChild(card);
    });
}

async function handlePoolsTab() {
    const pools = await window.driveAPI.getPools?.() || [];
    renderPools(pools);
    showTab("pools");
    if (poolRefreshInterval) clearInterval(poolRefreshInterval);

    poolRefreshInterval = setInterval(async () => {
        const updatedPools = await window.driveAPI.getPools?.() || [];
        renderPools(updatedPools);
    }, 10000); // every 10 seconds
}
function renderDrives(drives) {
    const container = document.getElementById("drives-container");
    container.innerHTML = ""; // clear
    const addCard = document.createElement("div");
    addCard.className = "add-card";
    addCard.textContent = "＋ Link New Drive";
    addCard.onclick = handleAddDrive;
    container.appendChild(addCard);
    drives.forEach(drive => {
        console.log(drive)
        const card = document.createElement("div");
        card.className = "drive-card";
        const statusColor = drive.mounted ? "rgba(0, 255, 0, 0.08)" : "rgb(43, 47, 58)";
        card.style.backgroundColor = statusColor;
        card.innerHTML = `
      <div class="card-header">
        <div>
          <h2>${drive.mountPoint??''} ${drive.label??drive.name}</h2>
          <small>${drive.type}${drive.user? ` • mail: ${drive.user}`: ''}</small>
        </div>
        <div class="card-actions">
          <button ${drive.mounted ? 'disabled' : ''} onclick="showConfirmation('Mount this drive?', 'handleMount','${drive.name}','drive')">🔼 Mount</button>
          <button ${!drive.mounted ? 'disabled' : ''} onclick="showConfirmation('Mount this drive?', 'handleUnmount','${drive.name}','drive')">🟥 Unmount</button>
        </div>
      </div>
      <div class="card-footer">
          <button onclick="handleEdit('${drive.name}','drive')">Edit</button>
          <button class="primary" onclick="handleUsage('${drive.name}','drive')">📊 Usage</button>
          <button class="danger" onclick="showConfirmation('Mount this drive?', 'handleDelete','${drive.name}','drive')">🗑️ Delete</button>
      </div>
      ${drive.mounted?
         `<div class="status-indicator">
            <span class="status-dot online"></span>
            <span class="status-text">Mounted</span>
        </div>`
        :''}
    `;
        container.appendChild(card);
    });
}
async function handleDrivesTab() {
    const drives = await window.driveAPI.getDrives?.() || [];
    renderDrives(drives);
    showTab("drives");
    if (driveRefreshInterval) clearInterval(driveRefreshInterval);

    driveRefreshInterval = setInterval(async () => {
        const updatedDrives = await window.driveAPI.getDrives?.() || [];
        renderDrives(updatedDrives);
    }, 10000); // every 10 seconds

}


window.handleMount = async (name, type) => {
    console.log(`Mounting ${type}: ${name}`);
    return window.driveAPI.singleMount(name, type)
}
window.handleUnmount = async (name, type) => {
    console.log(`Unmounting pool: ${name}`);
    if (type === "drive") {
        return window.driveAPI.unmountDrive(name);
    } else if (type === "pool") {
        return window.driveAPI.unmountPool(name);
    }
}
window.handleRemount = async (name, type) => {
    console.log(`Remounting pool: ${name}`);
    if (type === "drive") {
        await window.driveAPI.unmountDrive(name);
        return window.driveAPI.singleMount(name, type);
    } else if (type === "pool") {
        await window.driveAPI.unmountPool(name);
        return window.driveAPI.singleMount(name, type);
    }
}
window.handleDelete = async (name, type) => {
    console.log(`Deleting ${type}: ${name}`);
    // Future: Implement delete logic
    return await window.driveAPI.delete(name, type);
}

//confirmation modal logic
let confirmCallback = null;
function showConfirmation(message, handlerName, name, type) {
    console.log('Showing confirmation:', message, handlerName, name, type);
    document.getElementById("confirm-message").innerText = message;
    // document.getElementById("confirm-modal").style.display = "flex";
    const modal = document.getElementById("confirmation-modal");
    modal.classList.remove("hidden");
    // Reset modal state
    document.getElementById("modal-feedback").style.display = "none";
    document.getElementById("modal-spinner").style.display = "none";
    document.getElementById("confirm-actions").style.display = "flex";

    // Save callback
    confirmCallback = async () => {
        document.getElementById("confirm-actions").style.display = "none";
        document.getElementById("modal-spinner").style.display = "block";

        try {
            // document.getElementById("modal-spinner").style.display = "flex";
            const success = await window[handlerName](name, type);

            const feedback = document.getElementById("modal-feedback");
            feedback.style.display = "block";
            document.getElementById("modal-spinner").style.display = "NONE";
            feedback.innerText = (success === true) ? "✅ Action successful." : (success === false) ? "❌ Action failed." : `❌ ${success}`;
            feedback.className = (success === true) ? "feedback-success" : "feedback-error";

            setTimeout(() => {
                closeConfirmation();
            }, 1500);
        } catch (err) {
            document.getElementById("modal-spinner").style.display = "none";
            const feedback = document.getElementById("modal-feedback");
            feedback.style.display = "block";
            feedback.innerText = "❌ Unexpected error.";
            feedback.className = "feedback-error";
            setTimeout(() => {
                closeConfirmation();
            }, 1500);
        }
    };
}
function confirmYes() {
    if (confirmCallback) confirmCallback();
}
function confirmNo() {
    closeConfirmation();
}
function closeConfirmation() {
    document.getElementById("confirmation-modal").classList.add("hidden");
    confirmCallback = null;
}
//end of confirmation modal logic
// usage modal logic
// show loading spinner
function showLoading(message = "Loading...") {
    const overlay = document.getElementById("loading-overlay");
    overlay.querySelector(".loading-text").innerText = message;
    overlay.classList.remove("hidden");
}
function hideLoading() {
    document.getElementById("loading-overlay").classList.add("hidden");
}
//quick toast message
function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 100);
    setTimeout(() => toast.remove(), 4000);
}
// Show usage modal (replaces chart + updates UI)
function showUsageModal(usageArray, driveArray) {
    console.log(driveArray)
    const modal = document.getElementById("usage-modal");
    modal.classList.remove("hidden");

    // Total usage
    let totalUsed = 0, totalSize = 0;
    usageArray.forEach(d => {
        totalUsed += parseFloat(d.used || 0);
        totalSize += parseFloat(d.total || 0);
    });

    const percent = totalSize ? Math.round((totalUsed / totalSize) * 100) : 0;
    document.getElementById("total-usage-fill").style.width = percent + "%";
    document.getElementById("total-usage-text").textContent = `${formatSize(totalUsed)} / ${formatSize(totalSize)} (${percent}%)`;

    // Chart
    const labels = driveArray.map((name, i) => `${name} (${formatSize(usageArray[i].used)})`);
    const data = usageArray.map(d => d.used);
    // let usageBar = document.getElementById("total-usage-section");
    // usageBar.classList.remove("hidden");
    let chart = document.getElementById("chart-container");
    if (usageArray.length === 1) {
        chart.classList.add("hidden");
    }
    const ctx = document.getElementById("usage-polar-chart").getContext("2d");
    if (window._usageChart) window._usageChart.destroy();
    window._usageChart = new Chart(ctx, {
        type: 'polarArea',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: [
                    "#4a90e2", "#50e3c2", "#e94e77", "#f5a623", "#bd10e0",
                    "#7ed321", "#b8e986", "#9b9b9b", "#417505", "#9013fe"
                ],
                borderWidth: 1,
            }]
        },
        options: {
            scales: {
                r: {
                    grid: { color: "#333" },
                    angleLines: { color: "#444" },
                    ticks: {
                        color: "#aaa",
                        backdropColor: "transparent",
                        showLabelBackdrop: false,
                        callback: () => ''
                    },
                    suggestedMin: 0
                }
            }
        }
    });
}
function closeModal(id) {
    document.getElementById(id)?.classList.add("hidden");
}
function formatSize(bytes) {
    if (!bytes) return "0 B";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(1)} ${sizes[i]}`;
}
function formatSpeed(bps) {
    return bps ? `${formatSize(bps)}/s` : "0 B/s";
}
// MAIN handler
async function handleUsage(name, type) {
    try {
        showLoading(`Fetching usage for ${type}: ${name}`);
        const result = await window.driveAPI.getUsage?.(name, type);

        if (!result || !result.usage?.length) {
            showToast(`No usage data found for ${type}: ${name}`, "warning");
            return;
        }
        console.log("Usage data:", result);
        showUsageModal(result.usage, result.drives);
    } catch (e) {
        console.error(e);
        showToast(`Failed to fetch usage for ${type}: ${name}`, "error");
    } finally {
        hideLoading();
    }
}
//activity renderer
function renderActivity(fileArray) {
    const container = document.getElementById("activity-list");
    container.innerHTML = "";

    if (!fileArray.length) {
        container.innerHTML = "<div style='text-align:center;color:#888;'>No transfers in progress.</div>";
        return;
    }

    fileArray.forEach(file => {
        const isCompleted = !!file.completed_at;
        const isActive = !isCompleted;
        const sizeFormatted = formatSize(file.size);
        const name = file.name;
        const target = file.mount_name;
        const percent = file.percentage || (file.bytes && file.size ? (file.bytes / file.size) * 100 : 0);
        const eta = file.eta ? `ETA: ${formatDuration(file.eta)}` : "";
        const speed = file.speed ? `Speed: ${formatSpeed(file.speed)}` : "";

        let completedAt = "";
        let timeTaken = "";

        if (isCompleted && file.completed_at && file.started_at) {
            const start = new Date(file.started_at);
            const end = new Date(file.completed_at);
            const seconds = Math.floor((end - start) / 1000);
            timeTaken = `${formatDuration(seconds)}`;
            completedAt = file.completed_at.split("T")[1].split(".")[0];
        }

        const card = document.createElement("div");
        card.className = "activity-card";

        card.innerHTML = `
      <div class="activity-left">
        <h3>📂 ${name}</h3>
        <small>${isActive ? "Uploading to " : "Uploaded to "}${file.mountType}: ${target}</small>
        <small>Size: ${sizeFormatted}</small>

        ${isActive ? `
        <div class="activity-progress">
          <div><strong>Uploading:</strong></div>
          <div class="progress-bar">
            <div class="progress-fill ${percent === 0 ? "loading" : ""}" style="width: ${percent}%;"></div>
          </div>
          <small>${percent.toFixed(1)}% • ${speed} • ${eta}</small>
        </div>` : ""}
      </div>

      ${isCompleted ? `
      <div class="activity-right">
        <div>✅ Completed:</div>
        Completed at: ${formatTimeDisplay(file.completed_at)} <br>
        Time taken: ${timeTaken}
      </div>` : ""}
    `;

        container.appendChild(card);
    });
}
setInterval(() => {
    if (document.getElementById("activity").style.display !== "none") {
        window.driveAPI.getActivity?.().then(renderActivity);
    }
}, 2000);
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
}
function formatTimeDisplay(iso) {
    const date = new Date(iso);
    const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const fullString = date.toLocaleString();
    return `<span title="${fullString}">${timeString}</span>`;
}
// add/edit- pool/drive logic


function handleAddPool() {
    console.log("Add Pool clicked");
    showFormModal("pool", "create");
}
function handleAddDrive() {
    console.log("Add Drive clicked");
    showFormModal("drive", "create");
}
async function handleEdit(name, type) {
    console.log(`Editing ${type}: ${name}`);
    let existing
    if (type === "pool") {
        existing = (await window.driveAPI.getPools?.()).find(p => p.name === name);

    } else if (type === "drive") {
        existing = (await window.driveAPI.getDrives?.()).find(d => d.name === name);
    }
    if (!existing) return 'Error: No existing data found for ' + name;
    await showFormModal(type, "edit", existing);
}
let currentFormType = "pool"; // or "drive"
let editMode = false;
let editName = null;
let availableOptions = []; // To be filled by API
let selectedRemotes = [];
let selectedType = null; // For drive type selection
async function showFormModal(type, mode, initialData = {}) {
    currentFormType = type;
    editMode = (mode === "edit");
    editName = initialData?.name || null;

    document.getElementById("form-modal-title").innerText = `${editMode ? "Edit" : "Add"} ${capitalize(type)}`;
    document.getElementById("form-submit-btn").innerText = editMode ? "Save Changes" : "Create";
    document.getElementById("form-modal").classList.remove("hidden");

    // Toggle visibility and labels
    document.getElementById("form-name").parentElement.style.display = editMode ? "none" : "block";
    // document.getElementById("form-dynamic-label").innerText = type === "pool" ? "Remotes" : "Type";

    // Fill inputs
    document.getElementById("form-name").value = initialData.name || "";
    document.getElementById("form-label").value = initialData.label || "";
    document.getElementById("form-mount").value = initialData.mountPoint?.replace(":", "") || "";
    document.getElementById("form-startup").checked = initialData.startup || false;
    //get available options (from api)
    if (type === "pool") {
        availableOptions = (await window.driveAPI.getDrives?.()).map(d => d.name) || [];
        selectedRemotes = [...(initialData.remotes || [])];
        console.log(initialData);
        initRemoteSelector(availableOptions);
        renderSelectedRemotes();
    } else if (type === "drive") {
        // availableOptions = ["Google Drive", "Dropbox", "OneDrive", "S3", "Local"];
        if (!initialData.type) {
            initTypeSelector(["Google Drive"]);
        } else {
            document.getElementById("drive-type-input").value.innerText = initialData.type || "default";
            //document.getElementById("type-selector").classList.remove("hidden");
        }
        console.log(initialData);

        // availableOptions = ["Google Drive"]
    }
    // Load multi-select
    // loadMultiSelect(initialData.remotes || initialData.type ? [initialData.type] : []);
}
function resetForm() {
    document.getElementById("form-name").value = "";
    document.getElementById("form-label").value = "";
    document.getElementById("form-mount").value = "";
    document.getElementById("form-startup").checked = false;
    // document.getElementById("form-dynamic-select").innerHTML = "";
    document.getElementById("remote-selector").classList.add("hidden");
    document.getElementById("type-selector").classList.add("hidden");
    availableOptions = [];
    currentFormType = "pool";
    editMode = false;
    editName = null;
}
function filterRemoteOptions(inputValue) {
    const value = inputValue.toLowerCase();
    const list = document.getElementById("remote-options");
    list.innerHTML = "";
    
    availableOptions
        .filter(opt => opt.toLowerCase().includes(value) && !selectedRemotes.includes(opt))
        .forEach(opt => {
            const div = document.createElement("div");
            div.innerText = opt;
            div.onclick = () => {
                selectedRemotes.push(opt);
                console.log(selectedRemotes)
                renderSelectedRemotes();
                document.getElementById("remote-search").value = "";
                list.innerHTML = "";
            };
            list.appendChild(div);
        });
}
function renderSelectedRemotes() {
    const container = document.getElementById("selected-remotes");
    container.innerHTML = "";
    selectedRemotes.forEach(remote => {
        const tag = document.createElement("span");
        tag.innerHTML = `${remote} <span class="remove" onclick="removeRemote('${remote}')">×</span>`;
        container.appendChild(tag);
    });
    const optionsContainer = document.getElementById("remote-options");
    
    optionsContainer.innerHTML = "";
    availableOptions
        .filter(remote => !selectedRemotes.includes(remote))
        .forEach(remote => {
            const div = document.createElement("div");
            div.innerText = remote;
            div.onclick = () => {
                selectedRemotes.push(remote);
                renderSelectedRemotes();
                //renderOptions(searchInput.value);
            };
            optionsContainer.appendChild(div);
        });
}
function removeRemote(remote) {
    selectedRemotes = selectedRemotes.filter(r => r !== remote);
    renderSelectedRemotes();
}
function initTypeSelector(types) {
    document.getElementById("type-selector").classList.remove("hidden");
    const select = document.getElementById("drive-type-input");
    select.innerHTML = `<option value="">Choose type</option>`;
    types.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        opt.onclick = () => {
            selectedType = t
        }
        select.appendChild(opt);
    });
}
function initRemoteSelector(options) {
    availableOptions = options;
    // selectedRemotes = [];
    document.getElementById("remote-selector").classList.remove("hidden");
    document.getElementById("remote-search").value = "";
    const optionsContainer = document.getElementById("remote-options");
    renderSelectedRemotes();
    optionsContainer.innerHTML = "";
    options
        .filter(remote => !selectedRemotes.includes(remote))
        .forEach(remote => {
            const div = document.createElement("div");
            div.innerText = remote;
            div.onclick = () => {
                selectedRemotes.push(remote);
                renderSelectedRemotes();
                //renderOptions(searchInput.value);
            };
            optionsContainer.appendChild(div);
        });
}
// Handle form submission
async function submitFormModal() {
    console.log("Submitting form...");
    const name = document.getElementById("form-name").value.trim();
    const label = document.getElementById("form-label").value.trim();
    let mount = document.getElementById("form-mount").value.trim().toUpperCase();
    if(mount.length) mount = mount  + ":"
    const startup = document.getElementById("form-startup").checked;
    //selectedRemotes, selectedType
    let data = {
        name: editMode ? editName : name,
        label,
        mountPoint: mount,
        startup,
        remotes: currentFormType === "pool" ? selectedRemotes : null,
        type: currentFormType === "drive" ? (selectedType || document.getElementById("drive-type-input").value) : null,
    }
    if(!editMode && !name) {
        return showToast('Name is a required field!', 'error')
    }
    if(currentFormType === "pool" && data.remotes.length <2){
        return showToast('At Least two remotes need to selected!', 'error')
    }
    if(currentFormType === "drive" && !data.type){
        return showToast('You need to select a type!', 'error')
    }
    if(data.startup){
        if(!data.mountPoint){
            return showToast('You need to specify a mount point to set startup.', 'error')
        }
        let startup_mounts = await window.driveAPI.getUsedMounts()
        if(startup_mounts.includes(data.mountPoint)){
            return showToast(`Mount point ${data.mountPoint} is already used for startup mount.`,'error')
        }
    }
    console.log("Form data:", data);
    if (currentFormType === "pool") {
        //spinner loading
        document.getElementById("modal-spinner").style.display = "block";
        //api req,
        let success = false;
        if (editMode) {
            success = await window.driveAPI.edit('pool', data)
        } else {
            success = await window.driveAPI.add('pool', data);
        }
        document.getElementById("modal-spinner").style.display = "none";
        if (success === true) {
            showToast(`Pool: ${data.name} has been ${editMode ? "updated" : "created"} successfully!`, "success");
            closeFormModal();
        } else {
            showToast(`Failed to ${editMode ? "update" : "create"} ${success !== false ? success : ''}`, "error");
        }
        //true = toast success, close modal
        //false = toast error, dont close modal
    } else if (currentFormType === "drive") {
        console.log("Submitting drive form:", data);
        if (editMode) {
            //edit drive
            document.getElementById("modal-spinner").style.display = "block";
            let success = await window.driveAPI.edit('drive', data);
            document.getElementById("modal-spinner").style.display = "none";
            if (success === true) {
                showToast(`Drive: ${data.name} has been updated successfully!`, "success");
                closeFormModal();
            } else {
                showToast(`Failed to update drive: ${success !== false ? success : ''}`, "error");
            }
        } else {
            //oauth flow overlay
            showAuthModal();
            window.driveAPI.startAuth(data)
        }
    }

    // if(success){
    //     // close modal
    //     //toast a success message
    //     closeFormModal()
    // }else {
    //     //toast an error message
    //     //dont close the modal
    // }
}
async function closeFormModal() {
    resetForm();
    document.getElementById("form-modal").classList.add("hidden");
}
// function loadMultiSelect(preselected = []) {
//     const container = document.getElementById("form-dynamic-select");
//     container.innerHTML = "";
//     preselected = new Set(preselected);

//     availableOptions.forEach(opt => {
//         const selected = preselected.has(opt);
//         const chip = document.createElement("div");
//         chip.className = "chip" + (selected ? " selected" : "");
//         chip.innerText = opt;

//         chip.onclick = () => {
//             chip.classList.toggle("selected");
//         };

//         container.appendChild(chip);
//     });
// }
function capitalize(str) {
    return str[0].toUpperCase() + str.slice(1);
}

//drive oauth flow
function showAuthModal() {
    const logBox = document.getElementById('auth-log-stream');
    logBox.textContent = '➡️ Starting authorization...\n';
    document.getElementById('auth-spinner').style.display = 'block';
    document.getElementById('auth-progress-modal').classList.remove('hidden');
}
function cancelAuth(){
    document.getElementById('auth-progress-modal').classList.add('hidden');
    document.getElementById('auth-log-stream').textContent = ''
    document.getElementById('auth-spinner').style.display = 'none'
    window.driveAPI.startAuth('cancel')
    showToast('Drive auth cancelled!','warning')
}
function updateAuthLog(line) {
    line = line.includes('NOTICE:') ? line.split('NOTICE: ')[1] : ''
    const el = document.getElementById('auth-log-stream');
    el.textContent += '➡️ ' + line.trimEnd() + '\n';
    el.scrollTop = el.scrollHeight;
}

async function completeAuthModal(success, token,data) {
    updateAuthLog(success ? '✅ Drive Authorized!' : '❌ Failed to authorize.');
    if (success) {
        updateAuthLog(`NOTICE: Authorized, initialling drive..`)
        data.token = token
        await window.driveAPI.add('drive', data);
        document.getElementById('auth-progress-modal').classList.add('hidden');
        closeFormModal();
        showToast(`Drive added successfully!`,'success')
    } else {
        document.getElementById('auth-progress-modal').classList.add('hidden');
        showToast(`Failed to link Drive`, 'error')
    }
    document.getElementById('auth-spinner').style.display = 'none';

    // setTimeout(() => {

    //     // optionally show toast: showToast('Drive added successfully', 'success')
    // }, 2500);
}
window.driveAPI.onLog((msg) => updateAuthLog(msg));
window.driveAPI.onComplete(async(token,d) => await completeAuthModal(true, token,d));