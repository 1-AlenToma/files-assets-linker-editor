
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { minify, getAssets, beautify, pathId, join, build } = require("./methods");


var selectedConfigRoot = undefined;

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('assetLinker.openEditor', (uri) => {
      openEditor(context, uri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('assetLinker.build', async () => {
      const root = selectedConfigRoot ?? getWorkspaceRoot();
      if (!root) return;
      const configPath = join(root, 'file-assets-linker.json');
      if (!fs.existsSync(configPath)) {
        vscode.window.showErrorMessage('file-assets-linker.json not found in workspace root');
        return;
      }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      await build(root, config);
      // const outputPath = path.join(root, config.output || 'index.html');
      //fs.writeFileSync(outputPath, html, 'utf8');
      vscode.window.showInformationMessage('Assets Linker: Build complete');
    })
  );


  // Auto-build on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const root = selectedConfigRoot ?? getWorkspaceRoot();
      if (!root) return;
      const configPath = join(root, 'file-assets-linker.json');
      if (!fs.existsSync(configPath)) return;

      if (doc.fileName.endsWith('file-assets-linker.json') ||
        /\.(js|css|html)$/.test(doc.fileName)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          build(root, config);
          // const outputPath = path.join(root, config.output || 'index.html');
          // fs.writeFileSync(outputPath, html, 'utf8');
        } catch (e) {
          console.error(e);
        }
      }
    })
  );
}

function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) return null;
  return folders[0].uri.fsPath;
}




function openEditor(context, configFileUrl) {
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

  panel.webview.html = getHtml(panel.webview, context.extensionUri);


  selectedConfigRoot = path.dirname(configFileUrl.fsPath);

  // const root = getWorkspaceRoot();
  if (!selectedConfigRoot) return;

  let config = { output: 'file-assets-linker-index.ts', assets: [] };
  try {
    config = getAssets(selectedConfigRoot)
    console.log("config loaded", config)
  } catch (e) { console.error("could not read config") }


  //panel.webview.postMessage({ type: 'init', config });

  panel.webview.onDidReceiveMessage(async (msg) => {

    // console.log("got msg", msg.type)

    if (msg.type == "log") {
      console.log(...msg.data);
      return;
    }

    if (msg.type == "warn") {
      console.warn(msg.data);
      vscode.window.showInformationMessage('warn found');
      return;
    }

    if (msg.type == "error") {
      console.error(msg.data);
      vscode.window.showInformationMessage('Error found');
      return;
    }


    if (msg.type == "config") {
      panel.webview.postMessage({ type: 'init', config: config });
    }

    if (msg.type == "format") {
      let content = beautify(msg.ext, msg.content);
      panel.webview.postMessage({ ...msg, content: content });
    }


    if (msg.type === 'loadFile') {
      try {
        const full = join(selectedConfigRoot, msg.path);
        const content = fs.readFileSync(full, 'utf8');
        panel.webview.postMessage({ type: 'fileContent', id: pathId(msg.path), path: msg.path, content: beautify(msg.path.split(".").reverse()[0], content) });
      } catch (e) {
        console.error(join(selectedConfigRoot, msg.path), "could not be found")
        panel.webview.postMessage({ type: 'fileContent', id: pathId(msg.path), path: msg.path, content: '', error: true });
      }
    }

    if (msg.type === 'saveFile') {
      const full = join(selectedConfigRoot, msg.path);
      fs.writeFileSync(full, msg.content, 'utf8');
      vscode.window.showInformationMessage('File saved: ' + msg.path);
      console.log('File saved: ' + msg.path)
    }

    if (msg.type === 'build') {
      await build(selectedConfigRoot, msg.config);
      // const outputPath = path.join(selectedConfigRoot, msg.config.output || 'assets-index.ts');
      //  fs.writeFileSync(outputPath, html, 'utf8');
      vscode.window.showInformationMessage('Build complete');
      //panel.webview.postMessage({ type: 'built', outputPath });
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


function getHtml(webview, extensionUri) {
  console.log("loading HTMl")
  const nonce = Date.now().toString();
  const htmlPath = join(extensionUri.fsPath, 'media', 'main.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'main.js')
  );

  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'style.css')
  );

  const monoLoader = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'monaco', "vs", "loader.js")
  );

  const monacoCss = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'monaco', "vs", "editor", "editor.main.css")
  );

  const monacoPath = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'monaco', 'vs')
  );

  const appSettings = {
    monacoPath: monacoPath.toString(),
    themeKind: vscode.window.activeColorTheme.kind
  }

  html = html
    .replace(/\$\{nonce\}/gim, nonce)
    .replace(/\$\{webview.cspSource\}/gim, webview.cspSource)
    .replace('{{main.js}}', scriptUri)
    .replace('{{style.css}}', styleUri)
    .replace('{{vs/loader.js}}', monoLoader)
    .replace(/\"\{\{appSettings\}\}\"/gim, JSON.stringify(appSettings))
    .replace('{{monacoCss}}', monacoCss)
  console.log("html loaded")
  return html;

}
function deactivate() { }

module.exports = { activate, deactivate };
