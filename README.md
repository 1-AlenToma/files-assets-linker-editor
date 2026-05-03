
# Assets Linker (Monaco UI)

## Description

When working with WebView in React Native, managing `HTML`, `CSS`, and `JavaScript` assets can be cumbersome. These files are often embedded as strings, which makes development, debugging, and maintenance difficult.

This extension allows you to link external asset files directly to your project. You can keep your assets as standalone files, edit them with full tooling support, and seamlessly integrate them into your app.

## Features
- Use real `.html`, `.css`, `.js` files instead of inline strings
- Bundle multiple assets into a single file
- Supports **ESM** and **CommonJS**
- Per-asset overrides for output and format
- Keeps your workflow clean and maintainable


## 📦 Configuration
Create a `file-assets-linker.json` file in your project root.
## 🧾 Example
```json
[
    {
        "output": "./assets/test.ts",
        "format": "esm",
        "assets": [
            {
                "name": "indexHtml",
                "path": "../ContextMenu/index.html"
            },
            {
                "name": "webStyle",
                "path": "../ContextMenu/style.css",
                "type": "css"
            },
            {
                "output": "./assets/test2.js",
                "format": "CommonJS",
                "name": "indexJs",
                "path": "../ContextMenu/index.js"
            }
        ]
    },
    {
        "output": "./assets/test3.js",
        "format": "CommonJS",
        "assets": [
            {
                "path": "../ContextMenu/test/content.js"
            }
        ]
    }
]
```
## Preview
![editor](https://github.com/1-AlenToma/files-assets-linker-editor/blob/main/previews/preview.png?raw=true)

## 🧠 How it works

Each object in the array is a **build group**.

A build group: - collects asset files - processes them
(e.g. minify/format) - outputs them into a single file

1. Right click on the file and choose "Assets Linker: Open Editor"
2. Edit files + Build
3. After build, You will be able to use them inside your project as assets.

------------------------------------------------------------------------

## ⚙️ Properties

### `output`

Path to the generated file.

``` json
"output": "./assets/test.ts"
```

## `minify`

``` json

"minify": false // default:true
```

## `json indent`

``` json
"output": 4 // default 0
```

## `keys`

each assets group could containes `keys`. those `keys` could be refer to in `js, html and css` 

### example

```js
{
  "output": "./assets/test.ts",
  "keys":{
    "settings",
    "data",
    "test",
    "item":{
        "name": ""
    }
  }    

 // in css you could use var(--AssetsLinkEditor-keys-settings)
 // in js you could use AssetsLinkEditor.keys.settings
  // in html you could use var(--AssetsLinkEditor-keys-settings) in style tags or AssetsLinkEditor.keys.settings in script tags and --AssetsLinkEditor-keys-settings in html tags
// get method below could handle assigning data to those keys.
// when you open editor, you could edit those keys there.
}
```

## `globalVar`

for `keys` object we use `AssetsLinkEditor` as above. You could change it by assigning this value

------------------------------------------------------------------------

### `format`

Defines how exports are generated.

  Format       Description
  ------------ ----------------------------------------------
  `esm`        Uses ES Modules (`export`, `export default`)
  `CommonJS`   Uses `module.exports`

------------------------------------------------------------------------

### `assets`

Array of files to include in the output.

------------------------------------------------------------------------

## 📄 Asset Properties

### `path` (required)

Path to the source file (relative to config file).

``` json
"path": "../ContextMenu/index.html"
```

------------------------------------------------------------------------

### `name` (optional)

Name used when exporting the asset.

``` json
"name": "indexHtml"
```

If omitted, the name is generated from the file name.

------------------------------------------------------------------------

### `type` (optional)

Defines how the file is processed.

``` json
"type": "css"
```

Usually inferred from file extension.

------------------------------------------------------------------------

### `output` (optional)

Overrides the parent `output` for this asset.

``` json
"output": "./assets/test2.js"
```

------------------------------------------------------------------------

### `format` (optional)

Overrides the parent `format` for this asset.

``` json
"format": "CommonJS"
```

------------------------------------------------------------------------

## 🔁 Overrides

Assets can override their parent group settings:

``` json
{
  "output": "./assets/test.ts",
  "format": "esm",
  "assets": [
    {
      "output": "./assets/test2.js",
      "format": "CommonJS",
      "path": "../ContextMenu/index.js"
    }
  ]
}
```

------------------------------------------------------------------------

## 📤 Output Examples

### ESM

``` js
...
export default data;
export const indexHtml = data.indexHtml.content;
export const webStyle = data.webStyle.content;
export const get = data.get;
```

## `get`

incase you want to pass/replace data in the js, css ot html, you could use `get` method

if you look above at section prop `keys`.
```js
// so if we have --AssetsLinkEditor-keys-settings somewhere 

let html = get("indexHtml", "settings:data",...);
// now the result will be data

```
