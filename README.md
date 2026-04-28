
# Assets Linker (Monaco UI)

## Features
- JSON config: file-assets-linker.json
- Monaco editor inside VS Code webview
- Edit JS/CSS/HTML assets
- Build system → outputs index.html
- Auto-build on save

## Usage
1. Create file-assets-linker.json in root:
{
  "output": "index.html",
  "assets": [
    { "type": "html", "path": "./template.html" },
    { "type": "css", "path": "./main.css", "inline": true },
    { "type": "js", "path": "./main.js", "defer": true }
  ]
}

2. Run extension (F5)
3. Run command: "Assets Linker: Open Editor"
4. Edit files + Build

## Notes
- Uses CDN Monaco (no local bundling)
- Ctrl+S saves current file
