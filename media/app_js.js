
const vscode = acquireVsCodeApi();
let config = [{ assets: [] }];
let currentPath = null;
let editors = {};
let resizeTimer = undefined;
let tabs = {};
let activeTab = null;
let pastActiveTabs = [];
let externalKLib = [];

let getKey = (key) => {
    if (/[^A-Za-z0-9]/g.test(key))
        return `"${key}"`;
    return key;
}
function buildTree(props, root) {
    const tree = {};

    for (const p of props) {
        const path = p.jsKey.split(".");

        // remove root prefix
        if (path[0] === root) path.shift();

        let current = tree;

        path.forEach((key, i) => {
            if (i === path.length - 1) {
                current[key] = "string"; // or infer type later
            } else {
                current[key] = current[key] || {};
                current = current[key];
            }
        });
    }

    return tree;
}

function treeToTs(obj, indent = 2, hasKey = true) {
    const pad = " ".repeat(indent);
    //log("tree", obj)

    return `${hasKey ? "{\n" : ""}${Object.entries(obj)
        .map(([key, value]) => {
            if (typeof value === "object") {
                if (key.toString().trim().length <= 0)
                    return `${treeToTs(value, indent, false)}`;
                return `${pad}${getKey(key)}: ${treeToTs(value, indent + 2)};`;
            }

            return `${pad}${getKey(key)}:${value};`;
        })
        .join("\n")}\n${" ".repeat(indent - 2)}${hasKey ? "}" : ""}`;
}

function clearLibs() {
    while (externalKLib.length > 0)
        externalKLib.shift().dispose();
}

const assignAssetKeys = (idOrAsset, content) => {
    let asset = typeof idOrAsset != "object" ? assetById(idOrAsset) : idOrAsset;

    clearLibs();
    let globalVar = config.find(x => x.groupId == asset.groupId).globalVar.trim().replace(/ /g, "_");
    function buildCssVars(content) {
        const data = content;
        const props = [];

        function walk(obj, prefix, jsPrefix) {
            if (typeof obj !== "object" || obj === null) {
                if (obj != undefined && obj !== null && obj.toString().trim().length > 0)
                    props.push({
                        label: `--${globalVar}-keys-${obj}`,
                        insertText: `--${globalVar}-keys-${obj}`, // 👈 better UX
                        documentation: `fileAssets: ${globalVar}-keys-${obj}`,
                        kind: monaco.languages.CompletionItemKind.Variable,
                        jsKey: `${globalVar}.keys.${obj}`
                    });
                return;
            }

            for (const key of Object.keys(obj)) {
                const value = obj[key];
                const next = prefix ? `${prefix}-${key}` : key;
                const jsNext = jsPrefix ? `${jsPrefix}.${key}` : key;


                if (typeof value === "object" && value !== null) {
                    walk(value, next, jsNext);
                } else {
                    props.push({
                        label: `--${globalVar}-keys-${next}`,
                        insertText: `--${globalVar}-keys-${next}`, // 👈 better UX
                        documentation: `fileAssets: ${globalVar}-keys-${next}`,
                        kind: monaco.languages.CompletionItemKind.Variable,
                        jsKey: `${globalVar}.keys.${jsNext}`
                    });
                }
            }
        }

        data.forEach(x => walk(x))

        return props;
    }
    const props = buildCssVars(content);
    //log(props)
    const jsContent = `
declare const ${globalVar}: ${treeToTs(buildTree(props, globalVar), 4)};`;
    if (asset.ext == "js") {
        //  log(jsContent)
        externalKLib.push(monaco.languages.typescript.javascriptDefaults.addExtraLib(jsContent, `fileKey${asset.id}s.d.ts`))
    }

    const getType = (model, position, type) => {
        try {
            const text = model.getValue();
            const offset = model.getOffsetAt(position);
            const before = text.slice(0, offset);
            const lastOpen = before.lastIndexOf(`<${type}`);
            const lastClose = before.lastIndexOf(`</${type}>`);
            return lastOpen > lastClose;
        } catch (e) {
            error(e)
            return false;
        }
    }


    if (asset.ext == "css" || asset.ext == "html") {

        const provider = {
            triggerCharacters: ["-", '"', "'", "(", ".", "{", "}", globalVar[0] + globalVar[1]],

            provideCompletionItems(model, position) {
                try {
                    const lang = model.getLanguageId();

                    const textUntilPosition = model.getValueInRange({
                        startLineNumber: position.lineNumber,
                        startColumn: 1,
                        endLineNumber: position.lineNumber,
                        endColumn: position.column
                    });

                    const insideScript =
                        lang === "html" && getType(model, position, "script");

                    const insideStyle =
                        lang === "html" && getType(model, position, "style");
                    //   console.log("insideScript", insideScript, "insideStyle", insideStyle)
                    // 🚫 block JS
                    if (insideScript) {
                        const text = textUntilPosition;
                        let item = {
                            suggestions: [
                                ...props.map(p => ({
                                    label: p.jsKey,
                                    kind: monaco.languages.CompletionItemKind.Property,
                                    insertText: p.jsKey
                                }))
                            ]
                        }
                        return item;
                    }

                    // =========================
                    // CSS FILE
                    // =========================
                    if (lang === "css") {
                        return {
                            suggestions: props.map(p => ({
                                label: p.label,
                                kind: monaco.languages.CompletionItemKind.Variable,
                                insertText: p.label
                            }))
                        };
                    }

                    // =========================
                    // HTML FILE
                    // =========================
                    if (lang === "html") {
                        const isCssContext =
                            insideStyle || textUntilPosition.includes("var(");

                        const isAttribute = /=\s*["'][^"']*$/.test(textUntilPosition);

                        /*  if (!isCssContext && !isAttribute) {
                              return { suggestions: [] };
                          }*/

                        return {
                            suggestions: props.map(p => ({
                                label: p.label,
                                kind: monaco.languages.CompletionItemKind.Variable,
                                insertText: p.label,
                                documentation: "asset variable"
                            }))
                        };
                    }

                    return { suggestions: [] };
                } catch (e) {
                    console.error(e);
                    return { suggestions: [] };
                }
            }
        };


        externalKLib.push(monaco.languages.registerCompletionItemProvider("css", { ...provider }));

        externalKLib.push(monaco.languages.registerCompletionItemProvider("html", { ...provider }));
    }

}

const checkKeys = (groupId, keys) => {
    console.log("checkeing Keys", groupId)
    let g = config.find(x => x.groupId == groupId);
    if (!g) {
        console.warn("group not found for id", groupId);
        return;
    }
    g.keys = keys ?? g.keys;
    if (g.keys.length <= 0 || !editors[activeTab]) {
        clearLibs();
        return;
    }
    assignAssetKeys(activeTab, g.keys);
}


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

    btn.onclick = async (e) => {
        try {
            let target = e.target;
            if (!target.classList.contains("close"))
                activateTab(id);
            else {
                let yes = !tabs[id].hasChange() || await alertMsg.size({ h: "110px" }).yesNo("Closing tab", "You will lose all unsaved changes for this file.\nAre you sure")
                if (yes)
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
        try {
            require.config({
                paths: {
                    vs: window.appSettings.monacoPath
                }
            });

        } catch (e) {
            error(e.toString())
        }

        require(["vs/editor/editor.main"], () => resolve());
    });
}


loadMonaco();
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
        monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false
        });
        monaco.languages.html.htmlDefaults.setOptions({
            format: true,
            suggest: {
                html5: true
            },
            embeddedLanguages: {
                script: "javascript"
            }
        })


        monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
        log("added editor, id", id, "lang:", lang)

        let disposables = [];
        const bindCommand = () => {
            // disposables = [];

            disposables.push(
                editor.addAction({
                    id: "my-copy",
                    label: "My Copy",
                    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC],
                    run: () => {
                        document.execCommand("copy");
                    }
                })
            );
            disposables.push(
                editor.addAction({
                    id: "my-paste",
                    label: "My paste",
                    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV],
                    run: async () => {
                        const text = await navigator.clipboard.readText();
                        const selection = editors[activeTab].getSelection();
                        if (!selection) {
                            return;
                        }

                        // Replace the current contents with the text from the clipboard.
                        editors[activeTab].executeEdits("clipboard", [{
                            range: selection,
                            text: text,
                            forceMoveMarkers: true,
                        }]);
                    }
                })
            );

            disposables.push(
                editor.addAction({
                    id: "my-cut",
                    label: "My cut",
                    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX],
                    run: () => {
                        if (editors[activeTab].hasTextFocus())
                            editors[activeTab].trigger('keyboard', 'editor.action.clipboardCutAction', null);
                    }
                })
            );


        }

        editor.onDidBlurEditorText(() => {
            disposables.forEach(d => d.dispose());
        })

        editor.onDidFocusEditorText(() => {
            bindCommand();
        })

        editor.onDidChangeModelContent((event) => {
            log("data changes", id)
            tabs[id]?.hasChange();
        });

        editors[id] = editor;

        activateTab(id);
        setTimeout(() => {
            editor.focus();
        }, 200);
        return editor;

    } catch (e) {
        error(e.toString())
        throw e;
    }
}


async function setEditorValue(id, path, content) {
    try {
        log?.(`setting editor value. id:${id} path:${path} contentSize:${content.length}`);
        const lang = getLang(id);
        let editor = await getEditor(id, lang);
        let model = editor.getModel();

        if (!tabs[id].value)
            tabs[id].value = content;

        if (!model) {
            model = monaco.editor.createModel(content, lang);
            editor.setModel(model);
        } else {
            //  monaco.editor.setModelLanguage(model, lang);
            editor.setValue(content || '');
        }
    } catch (e) {
        error(e.toString())
        throw e;
    }
}


window.addEventListener('message', async event => {
    const msg = event.data;
    if (msg.error)
        return;
    //vscode.postMessage({ type: 'log', data: "jsGot message [" + msg.type + "]", contnet: msg });
    if (msg.type === 'init') {
        config = msg.config;

        renderList();
    }

    if (msg.type == "checkKeys") {
        checkKeys(msg.groupId, msg.content.keys);
    }

    if (msg.type === "reload") {
        console.log("Reloading due to:", msg.file);
        // simplest approach:
        // location.reload();
    }

    if (msg.type === 'fileContent') {
        currentPath = { id: msg.id, path: msg.path }
        await setEditorValue(msg.id, msg.path, msg.content.text)
        checkKeys(msg.groupId, msg.content.keys);
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

        checkKeys(asset.groupId);
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
                        openFile(child.asset);
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
    let selectedAsset = undefined;
    config.forEach(x => {
        x.assets.forEach(a => {
            let p = pastActiveTabs.find(p => p.id == a.id);
            if (p) {
                if (p.selected)
                    selectedAsset = a;
                selectAsset(a);
                openFile(a);
            }
        });
    })
    if (selectedAsset)
        setTimeout(() => {
            activateTab(selectedAsset.id);
        }, 500);


    pastActiveTabs = [];
}

function openFile(asset) {
    vscode.postMessage({ type: 'loadFile', ...asset });
}

async function saveFile(asset) {
    asset = asset || assetById(currentPath.id);
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
        ...asset,
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
            pastActiveTabs.push({ id, selected: id == activeTab })
            closeTab(id);
        }
        currentPath = null;
        activeTab = undefined;
        tabs = {};
        editors = {};
        vscode.postMessage({ type: 'config' });
    }
}

const checkChange = (alrt) => {
    for (let k in tabs) {
        let tab = tabs[k];
        if (tab.hasChange()) {
            if (alrt != false)
                alertMsg.size({ h: "70px" }).set("Attention", "Please save all your work before continue").show();
            return true;
        }
    }
    return false
}

function build() {
    if (!checkChange())
        vscode.postMessage({ type: 'build', config });
}


function getLang(id) {
    let asset = assetById(id);
    if (asset.ext.endsWith('js')) return 'javascript';
    if (asset.ext.endsWith('css')) return 'css';
    if (asset.ext.endsWith('html')) return 'html';
    if (asset.ext.endsWith('json')) return 'json';
    return 'plaintext';
}

function formatCode() {
    log("formating")
    if (currentPath) {
        vscode.postMessage({
            type: "format",
            ...assetById(currentPath.id),
            content: editors[currentPath.id].getValue()
        });
        editors[currentPath.id].getAction("editor.action.formatDocument").run();
    }
}

// Ctrl+S save file
window.addEventListener('keydown', (e) => {
    const key = [e.code, e.key.toLowerCase()];
    const isCmd = e.ctrlKey || e.metaKey || e.altKey;

    if (isCmd && ["s", "KeyS"].some(x => key.includes(x))) {
        e.preventDefault();
        saveFile();
    }

    if (isCmd && e.shiftKey && ["b", "KeyB"].some(x => key.includes(x))) {
        e.preventDefault();
        log("build")
        build();
    }

    if (isCmd && e.shiftKey && ["r", "KeyR"].some(x => key.includes(x))) {
        e.preventDefault();
        reload();
    }

    if (isCmd && ["f", "KeyF"].some(x => key.includes(x))) {
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
    let chkuseOnlineEditor = document.getElementById("chkUseOnlineEditor");
    chkuseOnlineEditor.checked = window.appSettings.db.useOnlineEditor;
    chkuseOnlineEditor.addEventListener("change", (e) => {
        if (!checkChange()) {
            window.appSettings.db.useOnlineEditor = e.target.checked;
            vscode.postMessage({ type: 'dbSettings', data: window.appSettings.db });
        } else if (window.appSettings.db.useOnlineEditor !== e.target.checked)
            e.target.checked = window.appSettings.db.useOnlineEditor;

    });


});
