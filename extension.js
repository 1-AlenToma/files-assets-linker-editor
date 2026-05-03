
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { startMonacoServer, editorMinifier } = require("./monacoServer");
const { minify, getAssets, beautify, pathId, join, build, joinUrl, cleanConfig, configFileName } = require("./methods");
const { DataBase } = require("./dataBase");


var selectedConfigRoot = undefined;
var appRoot = "";
let config = { output: configFileName, assets: [] };
var db = {};

function activate(context) {
  appRoot = context.extensionUri.fsPath;
  db = new DataBase(appRoot);

  //editorMinifier(context)
  context.subscriptions.push(
    vscode.commands.registerCommand('assetLinker.openEditor', (uri) => {
      openEditor(context, uri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('assetLinker.build', async () => {
      const root = selectedConfigRoot ?? getWorkspaceRoot();
      if (!root) return;
      const configPath = join(root, configFileName);
      if (!fs.existsSync(configPath)) {
        vscode.window.showErrorMessage('file-assets-linker.json not found in workspace root');
        return;
      }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      await build(root, config, appRoot);
      // const outputPath = path.join(root, config.output || 'index.html');
      //fs.writeFileSync(outputPath, html, 'utf8');
      vscode.window.showInformationMessage('Assets Linker: Build complete');
    })
  );


 /* // Auto-build on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      console.log("auto Save", doc.fileName)
      const root = selectedConfigRoot ?? getWorkspaceRoot();
      if (!root) return;
      const configPath = join(root, configFileName);
      if (!fs.existsSync(configPath)) return;

      if (doc.fileName.endsWith(configFileName) || /\.(js|css|html)$/.test(doc.fileName)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          build(root, config, appRoot);
          // const outputPath = path.join(root, config.output || 'index.html');
          // fs.writeFileSync(outputPath, html, 'utf8');
        } catch (e) {
          console.error(e);
        }
      }
    })
  );*/
}

function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) return null;
  return folders[0].uri.fsPath;
}


function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}



async function openEditor(context, configFileUrl) {
  console.log("open Editor", configFileUrl.fsPath)

  const panel = vscode.window.createWebviewPanel(
    'assetLinkerEditor',
    'Assets Linker Editor',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(context.extensionPath)]
    }
  );
  const address = await startMonacoServer(context, db);
  console.log("running on", address);
  panel.webview.html = getHtml(panel.webview, context.extensionUri, address);


  selectedConfigRoot = path.dirname(configFileUrl.fsPath);

  // const root = getWorkspaceRoot();
  if (!selectedConfigRoot) return;

  const loadConfig = () => {
    try {
      config = getAssets(selectedConfigRoot)
      console.log("config loaded", config)
    } catch (e) { console.error("could not read config") }
  }
  loadConfig();
  //panel.webview.postMessage({ type: 'init', config });

  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (msg.type == "dbSettings") {
        console.log("got db Setting", msg.data)
        db.assign(msg.data).saveChanges();
        panel.webview.html = getHtml(panel.webview, context.extensionUri, address);

        return;
      }

      if (msg.type == "log") {
        console.log(...msg.data);
        return;
      }

      if (msg.type == "warn") {
        console.warn(msg.data);
        vscode.window.showInformationMessage(`warn:${JSON.stringify(msg.data)}`);
        return;
      }

      if (msg.type == "error") {
        console.error(msg.data);
        vscode.window.showInformationMessage(`error:${JSON.stringify(msg.data)}`);
        return;
      }


      if (msg.type == "config") {
        loadConfig();
        vscode.window.showInformationMessage(`config loaded`);
        panel.webview.postMessage({ type: 'init', config: config });
      }

      if (msg.type == "format") {
        let content = beautify(msg.ext, msg.content);
        panel.webview.postMessage({ ...msg, content: content });
      }


      if (msg.type === 'loadFile') {
        try {
          const full = join(selectedConfigRoot, msg.path);
          const content = msg.assetKey ? JSON.stringify(config.find(x => x.groupId == msg.groupId).keys, undefined, 4) : fs.readFileSync(full, 'utf8');
          panel.webview.postMessage({
            ...msg,
            type: 'fileContent',
            content: {
              keys: config.find(x => x.groupId == msg.groupId).keys,
              text: beautify(msg.path.split(".").reverse()[0], content)
            }
          });
        } catch (e) {
          console.error(e, msg.path, "could not be found")
          panel.webview.postMessage({ type: 'fileContent', id: msg.id, path: msg.path, content: '', error: true });
        }
      }

      if (msg.type === 'saveFile') {
        if (!msg.assetKey) {
          const full = join(selectedConfigRoot, msg.path);
          fs.writeFileSync(full, msg.content, 'utf8');
          vscode.window.showInformationMessage('File saved: ' + msg.path);
          console.log('File saved: ' + msg.path)
        } else {
          try {
            let keys = JSON.parse(msg.content);
            let c = config.find(c => c.groupId == msg.groupId);
            c.keys = keys;
            cleanConfig(config, selectedConfigRoot);
            panel.webview.postMessage({ type: 'checkKeys', groupId: msg.groupId, content: { keys } });
            vscode.window.showInformationMessage('File saved: ' + configFileName);
          } catch (e) {
            console.error(e)
            vscode.window.showInformationMessage('json error format: ' + msg.path);
          }
        }

      }

      if (msg.type === 'build') {
        await build(selectedConfigRoot, msg.config, appRoot);
        // const outputPath = path.join(selectedConfigRoot, msg.config.output || 'assets-index.ts');
        //  fs.writeFileSync(outputPath, html, 'utf8');
        vscode.window.showInformationMessage('Build complete');
        //panel.webview.postMessage({ type: 'built', outputPath });
      }
    } catch (e) {
      console.error(e);
    }
  });
}

function injectIntoHead(html, content) {
  if (!html.includes('</head>')) {
    html = '<head></head>' + html;
  }
  return html.replace('</head>', content + '\n</head>');
}

function injectIntoBody(html, content) {
  if (!html.includes('</body>')) {
    html = html + '<body></body>';
  }
  return html.replace('</body>', content + '\n</body>');
}


function getHtml(webview, extensionUri, address) {
  console.log("loading HTMl")
  const nonce = getNonce();
  const appSettings = {
    monacoPath: db.useOnlineEditor ? "https://cdn.jsdelivr.net/npm/monaco-editor@latest/min/vs" : `${address.media}/monaco/min/vs`, //`${address.media}/monaco/min/vs`,
    themeKind: vscode.window.activeColorTheme.kind,
    media: address.media,
    base: address.base,
    db: db,
    nonce,
    meta: `
      <meta http-equiv="Content-Security-Policy" content="
       default-src 'none';
       img-src ${webview.cspSource} ${address.base} https: data:;
       font-src ${webview.cspSource} ${address.base} https://*.vscode-cdn.net data: blob:;
       style-src ${webview.cspSource} ${address.base} 'unsafe-inline' https://cdn.jsdelivr.net https://*.vscode-cdn.net data: blob:;
       script-src 'nonce-${nonce}' 'unsafe-inline' ${webview.cspSource} ${address.base} https://cdn.jsdelivr.net https://*.vscode-cdn.net data: blob:;
       connect-src ${webview.cspSource} ${address.base} https:;
       worker-src blob:;
  " />
    `
  }
  const htmlPath = join(extensionUri.fsPath, 'media', 'main.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  html = html
    .replace(/\"\{\{appSettings\}\}\"/gim, JSON.stringify(appSettings))

  html = html.replace(/\{\{(.*?)\}\}/g, (full, u) => {
    let p = "";
    if (appSettings[u] != undefined || appSettings.db[u] != undefined)
      p = appSettings[u] ?? appSettings.db[u];
    else {
      if (u.startsWith("..")) {
        p = joinUrl(appSettings.media, u.slice(2));
      } else {
        p = joinUrl(appSettings.monacoPath, u);
      }
    }
    return p;
  });
  //console.log(html)
  return html;

}
function deactivate() { }

module.exports = { activate, deactivate };
