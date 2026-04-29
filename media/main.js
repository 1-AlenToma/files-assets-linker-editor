
const vscode = acquireVsCodeApi();
let config = [{ assets: [] }];
let currentPath = null;
const editors = {};
let resizeTimer = undefined;
const tabs = {};
let activeTab = null;


const alertMsg = {
    value: document.querySelector(".alert-d"),
    blur: document.querySelector(".blur"),
    init: () => {
        alertMsg.value.querySelector("div:first-child .close").addEventListener("click", () => {
            alertMsg.hide();
        })
        return alertMsg;
    },
    size: ({ w, h }) => {
        if (w != undefined)
            alertMsg.value.style.width = w;
        if (h != undefined)
            alertMsg.value.style.height = h;

        return alertMsg;
    },
    set: (title, content) => {
        alertMsg.value.querySelector("div:first-child p").innerHTML = title;
        if (typeof content == "string")
            alertMsg.value.querySelector("div:last-child").innerHTML = content;
        else alertMsg.value.querySelector("div:last-child").appendChild(content);

        return alertMsg;

    },
    yesNo: (title, content) => {
        return new Promise(r => {
            let html = `
            <div class="btnContainer">
                <button>Yes</button>
                <button>No</button>
            </div>
        `;
            alertMsg.set(title, content + html);
            alertMsg.show();
            alertMsg.value.querySelector("div:last-child > div > button:first-child").addEventListener("click", () => {
                alertMsg.hide();
                r(true);
            });

            alertMsg.value.querySelector("div:last-child > div > button:last-child").addEventListener("click", () => {
                alertMsg.hide();
                r(false);
            });

        });

    },
    show: () => {
        alertMsg.value.style.display = alertMsg.blur.style.display = "block";
        return alertMsg;
    },
    hide: () => {
        alertMsg.value.style.display = alertMsg.blur.style.display = "none";
        return alertMsg;
    },
}
alertMsg.init();

const log = (...args) => {
    vscode?.postMessage?.({ type: "log", data: args });
}


const error = (...args) => {
    vscode?.postMessage?.({ type: "error", data: args });
}

const warn = (...args) => {
    vscode?.postMessage?.({ type: "warn", data: args });
}

try {
    require.config({
        paths: {
            vs: window.appSettings.monacoPath
        }
    });
} catch (e) {
    error(e.toString())
}


function assetById(id) {
    let asset = undefined;
    for (let c of config) {
        for (let a of c.assets) {
            if (a.id == id) {
                asset = a;
                break;
            }
        }
    }

    return asset;
}

/*
    <input type="radio" name="tab" id="tab1" checked>
    <label for="tab1">Tab 1</label>
    <div class="tab-content" id="content1">
        Content for Tab 1
    </div>
*/

function closeTab(id) {
    log("closing tab", id)
    const tab = tabs[id];
    editors[id]?.dispose();
    tab.panel.remove();
    tab.btn.remove();
    delete tabs[id];
    delete editors[id];
    let keys = Object.keys(tabs);
    if (activeTab == id || keys.length == 0) {
        activeTab = undefined;
        if (keys.length > 0)
            activateTab(keys[0])
    }
}
function createTab(id) {
    if (tabs[id]) return tabs[id].panel;
    let asset = assetById(id) ?? {};
    const tabBar = document.getElementById("tabBar");
    const tabPanels = document.getElementById("tabPanels");

    // button
    const btn = document.createElement("div");
    btn.className = "tab-btn";
    btn.innerHTML = `<span>${asset.fileName || id}</span><a class="changed"></a><a class="close">x</a>`;
    btn.setAttribute("title", asset.path || "");

    // panel
    const panel = document.createElement("div");
    panel.className = "tab-panel";
    panel.id = id;
    panel.innerHTML = "";

    btn.onclick = (e) => {
        try {
            let target = e.target;
            if (!target.classList.contains("close"))
                activateTab(id);
            else {
                closeTab(id);

            }
        } catch (e) {
            error("tab error", e.toString())
        }
    }

    tabBar.appendChild(btn);
    tabPanels.appendChild(panel);

    tabs[id] = { btn, panel, hasChange: () => validateTabHasChange(asset.id || id) };

    if (!activeTab) activateTab(id);

    return panel;
}

function activateTab(id) {
    log("activating tab", id);
    const asset = assetById(id);
    for (let key in tabs) {
        const t = tabs[key];
        t.btn.classList.remove("active");
        t.panel.classList.remove("active");
    }

    const tab = tabs[id];
    if (!tab) {
        warn(`${id} not found, assets`, asset?.path);
        return;
    }

    tab.btn.classList.add("active");
    tab.panel.classList.add("active");

    activeTab = id;
    if (asset)
        selectAsset(asset);
}

function validateTabHasChange(id) {
    try {
        if (id === null || id == undefined)
            return false;
        let tab = tabs[id];
        let asset = assetById(id)
        let editor = editors[id];
        if (!tab || !asset)
            return;


        let value = editor.getValue();
        let hasChange = tab.value !== value;
        if (!hasChange)
            tab.btn.querySelector(".changed").style.display = "none";
        else tab.btn.querySelector(".changed").style.display = "block";
        return hasChange;
    } catch (e) {
        error("validateTabHasChange error", e.toString(), "with id", id);
        throw e;
    }
}

function loadMonaco() {
    return new Promise((resolve) => {
        if (window.monaco) return resolve();
        require(["vs/editor/editor.main"], () => resolve());
    });
}

async function getEditor(id, lang) {
    try {
        if (editors[id]) {
            activateTab(id);
            return editors[id];
        }

        await loadMonaco();

        const container = createTab(id); // <-- use id properly

        if (!container) {
            throw new Error(`Container not found: ${id}`);
        }



        const editor = monaco.editor.create(container, {
            value: "",
            language: lang || "javascript",
            theme: window.appSettings.themeKind === 1 ? "vs" : "vs-dark",
            automaticLayout: true
        });

        editor.updateOptions({
            readOnly: false,
            contextmenu: true,
            mouseWheelZoom: true
        });

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => {
            document.execCommand("copy");
        });

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, async () => {
            const text = await navigator.clipboard.readText();
            editor.trigger("keyboard", "type", { text });
        });

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => {
            editor.trigger('keyboard', 'editor.action.clipboardCutAction');
        });

        editor.onDidChangeModelContent((event) => {
            log("data changes", id)
            tabs[id]?.hasChange();
        });

        editors[id] = editor;
        activateTab(id);
        return editor;

    } catch (e) {
        error(e.toString())
        throw e;
    }
}


async function setEditorValue(id, path, content) {
    try {
        log?.(`setting editor value. id:${id} path:${path} contentSize:${content.length}`);
        const lang = getLang(path);
        let editor = await getEditor(id, lang);
        let model = editor.getModel();
        if (!tabs[id].value)
            tabs[id].value = content;
        if (!model) {
            model = monaco.editor.createModel(content, lang);
            editor.setModel(model);
        } else {
            monaco.editor.setModelLanguage(model, lang);
            editor.setValue(content || '');
        }
    } catch (e) {
        error(e.toString())
        throw e;
    }
}


window.addEventListener('message', event => {
    const msg = event.data;
    //  vscode.postMessage({ type: 'log', data: "jsGot message [" + msg.type + "]", contnet: msg });
    if (msg.type === 'init') {
        config = msg.config;

        renderList();
    }

    if (msg.type === "reload") {
        console.log("Reloading due to:", msg.file);
        // simplest approach:
        // location.reload();
    }

    if (msg.type === 'fileContent') {
        currentPath = { id: msg.id, path: msg.path }
        setEditorValue(msg.id, msg.path, msg.content || '')
    }

    if (msg.type === 'format') {
        setEditorValue(msg.id, msg.path, msg.content)
    }
});

function selectAsset(asset) {
    try {
        let id = asset.id || asset.asset.id;
        currentPath = { id: id, path: asset.path || asset.asset.path };
        log("selecting assets", id)
        let li = document.querySelector(`li[id="${id}"]`);
        for (let item of [...document.querySelectorAll("li.selected")])
            item.classList.remove("selected")
        if (li)
            li.classList.add("selected");
    } catch (e) {
        error(e.toString())
    }
}

function renderList() {
    log("render config");
    const el = document.getElementById('list');
    el.innerHTML = '';
    const root = { name: "root", children: {} };
    for (let c of config) {
        for (const a of c.assets) {
            const title = `${a.path} => ${a.output || c.output}$${a.name || a.cleanName}`;
            let current = root;

            // build folders

            if (!current.children[a.dirName]) {
                current.children[a.dirName] = {
                    type: "folder",
                    name: a.dirName,
                    children: {},
                    id: a.id,
                    title
                };
            }
            current = current.children[a.dirName];


            // add file at final folder
            current.children[a.fileName || a.path.split('/').pop()] = {
                type: "file",
                name: a.fileName || a.path.split('/').pop(),
                asset: a,
                id: a.id,
                title
            };
        }
    }



    // ---------------------------
    // 2. Render recursive tree
    // ---------------------------
    function renderNode(node) {
        const ul = document.createElement('ul');

        Object.values(node.children).forEach(child => {
            const li = document.createElement('li');
            li.textContent = child.name;
            li.setAttribute("title", child.title);



            if (child.type === "file") {
                li.id = child.id;
                li.classList.add("file")
                li.onclick = (e) => {
                    e.stopPropagation();
                    if (!tabs[child.asset.id]) {
                        selectAsset(child.asset);
                        openFile(child.asset.path);
                    } else activateTab(child.asset.id);
                };
            }

            if (child.type === "folder") {
                li.classList.add("folder");
                li.textContent = child.name.split("\\").reverse()[0]
                const childUl = renderNode(child);
                li.appendChild(childUl);

                li.onclick = (e) => {
                    e.stopPropagation();
                    li.classList.toggle("collapsed");
                };
            }

            ul.appendChild(li);
        });

        return ul;
    }

    el.appendChild(renderNode(root));
}

function openFile(path) {
    vscode.postMessage({ type: 'loadFile', path });
}

async function saveFile(asset) {
    asset = asset || currentPath;
    if (!asset || !asset.id) return;
    let editor = editors[asset.id];
    if (!editor) {
        warn("editor could not be found", asset.id)
        return;
    }
    tabs[asset.id].value = editor.getValue();
    tabs[asset.id].hasChange();
    vscode.postMessage({
        type: 'saveFile',
        path: asset.path,
        content: editor.getValue()
    });
}

function saveAllFiles() {
    for (let id in tabs) {
        let asset = assetById(id);
        let tab = tabs[id];
        if (asset && tab.hasChange())
            saveFile(asset);
    }
}

async function reload() {
    let hasChange = false;
    for (let k in tabs) {
        let tab = tabs[k];
        if (tab.hasChange()) {
            hasChange = true;
            break;
        }
    }
    if (!hasChange || await alertMsg.size({ h: "90px" }).yesNo("Reload", "You will lose all unsaved changes.\nAre you sure")) {
        for (let id in tabs) {
            closeTab(id);
        }
        currentPath = null;
        activeTab = undefined;
        vscode.postMessage({ type: 'config' });
    }
}

function build() {
    for (let k in tabs) {
        let tab = tabs[k];
        if (tab.hasChange()) {
            alertMsg.size({ h: "70px" }).set("Attention", "Please save all your work before build").show();
            return;
        }
    }
    vscode.postMessage({ type: 'build', config });
}


function getLang(path) {
    if (path.endsWith('.js')) return 'javascript';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.html')) return 'html';
    return 'plaintext';
}

function formatCode() {
    log("formating")
    if (currentPath) {
        editors[currentPath.id].getAction("editor.action.formatDocument").run();
        vscode.postMessage({
            type: "format",
            ...assetById(currentPath.id),
            content: editors[currentPath.id]
        });
    }
}

// Ctrl+S save file
window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    const isCmd = e.ctrlKey || e.metaKey || e.altKey;

    if (isCmd && key === 's') {
        e.preventDefault();
        saveFile();
    }

    if (isCmd && e.shiftKey && key === "b") {
        e.preventDefault();
        log("build")
        build();
    }

    if (isCmd && e.shiftKey && key === "r") {
        e.preventDefault();
        reload();
    }

    if (isCmd && e.shiftKey && key === 'f') {
        e.preventDefault();
        formatCode();
    }
});

document.addEventListener("DOMContentLoaded", () => {

    vscode.postMessage({ type: 'config' });
    window.__initialized = true;
    document.getElementById("btnSave").addEventListener("click", () => saveFile());
    document.getElementById("btnSaveAll").addEventListener("click", () => saveAllFiles());
    document.getElementById("btnBuild").addEventListener("click", () => build());
    document.getElementById("btnReload").addEventListener("click", () => reload());
    document.getElementById("btnFormat").addEventListener("click", () => formatCode());


});
