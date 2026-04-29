const esbuild = require("esbuild");
const { minify: minifyHtml } = require("html-minifier-terser");
const { transform } = require("lightningcss");
const fs = require('fs');
const path = require('path');
const beautifyLib = require("js-beautify");
const vscode = require('vscode');

function join(...args) {
    let paths = [];

    for (let arg of args) {
        if (path.isAbsolute(arg)) {
            paths = [arg]; // reset
        } else {
            paths.push(arg);
        }
    }

    return path.join(...paths);
}

function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function beautify(type, content, options = {}) {
    const defaultOptions = {
        indent_size: 2,
        space_in_empty_paren: true,
        ...options
    };

    switch (type) {
        case "js":
        case "javascript":
            return beautifyLib.js(content, defaultOptions);

        case "html":
            return beautifyLib.html(content, defaultOptions);

        case "css":
            return beautifyLib.css(content, defaultOptions);

        case "json":
            return beautifyLib.js(content, {
                ...defaultOptions,
                brace_style: "expand"
            });

        default:
            throw new Error(`Unsupported beautify type: ${type}`);
    }
}


/**
 * Minify JS, CSS, or HTML content
 */
async function minify(type, content) {
    switch (type) {
        case "js": {
            const result = await esbuild.transform(content, {
                minify: true,
                loader: "js"
            });
            return result.code;
        }

        case "css": {
            const result = transform({
                code: Buffer.from(content),
                minify: true
            });
            return result.code.toString();
        }

        case "html": {
            return await minifyHtml(content, {
                collapseWhitespace: true,
                removeComments: true,
                removeRedundantAttributes: true,
                minifyCSS: true,
                minifyJS: true
            });
        }

        default:
            return content;
    }
}

const pathId = (path) => {
    let id = 0;
    for (let i = 0; i < path.length; i++)
        id += path.charCodeAt(i);
    return id;
}

const getAssets = (root) => {
    try {
        const configPath = join(root, 'file-assets-linker.json');
        if (!fs.existsSync(configPath))
            throw "asset dose not exist"
        let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!Array.isArray(config))
            config = [config]
        for (let c of config) {
            for (let asset of c.assets) {
                const fullPath = join(root, asset.path);
                asset.path = fullPath;
                asset.fileName = path.basename(fullPath);
                asset.dirName = path.dirname(fullPath);
                asset.cleanName = path.parse(fullPath).name;
                asset.id = pathId(asset.path);
                asset.ext = path.parse(fullPath).ext.replace(".", "").trim();
            }
        }

        return config;
    } catch (e) {
        console.error(e);
        throw e;
    }
}


async function build(root, config) {
    try {

        console.log("building data", root)
        const files = {};
        for (let c of config) {
            for (const asset of c.assets || []) {
                const fullPath = join(root, asset.path);
                try {
                    let output = asset.output ?? c.output;
                    const format = (asset.output ? (asset.format ?? c.format ?? "esm") : c.format ?? "esm").toLowerCase();
                    const minifyCode = asset.minify != undefined ? asset.minify : c.minify ?? true;
                    let content = '';
                    try {
                        content = fs.readFileSync(fullPath, 'utf8');
                    } catch (e) { console.warn("Failed to read:", fullPath, e.message); }

                    let type = asset.type ?? path.parse(fullPath).ext.slice(1);
                    let name = asset.name ?? path.parse(fullPath).name.replace(/[^a-zA-Z0-9]/g, "");
                    content = minifyCode ? await minify(type, content) : content;
                    if (!files[output])
                        files[output] = { ___format: format, ___indent: c.indent }
                    files[output][name] = {
                        content
                    }
                } catch (e) {
                    throw `Error on asset:${e.toString()} for file:${fullPath}`;
                }
            }





            for (let p in files) {
                let item = files[p];
                let format = item.___format;
                let minifyCode = item.___minifyCode;
                let indent = item.___indent;
                const outputPath = join(root, p);
                const isTs = outputPath.endsWith("ts");
                delete item.___format;
                delete item.___minifyCode;
                delete item.___indent;

                let data = `
                /** 
                * File created by files-assets-linker-editor 
                * config: ${join(root, 'file-assets-linker.json')}
                */`.replace(/^\s+/gm, '');
                let jsGetter = "";
                let _any = format != "commonjs" ? "as any" : ""
                if (format != "commonjs" && isTs) {
                    data += `\ntype IGetter = (fileKey: ${Object.keys(item).map(x => `"${x}"`).join("|")}`;
                    data += ', ...keyValues: (`${string}:${string}` | `"${string}:${string}"`)[]) => string';
                }

                jsGetter += `function get(fileKey, ...keyValues) {
                    let item = data[fileKey];
                    if (typeof item == "object")
                        item = item.content;
                    if (!item)
                        return item;
                    for(let keyValue of keyValues){
                        let literal = "";
                        if (keyValue.startsWith("'") || keyValue.startsWith('"'))
                        {
                            literal= keyValue[0];
                            keyValue= keyValue.slice(1, keyValue.length -1);
                        }
                        const index = keyValue.indexOf(":");
                        const key = index === -1 ? keyValue : keyValue.slice(0, index);
                        const value = index === -1 ? "" : keyValue.slice(index + 1);
                        let part = literal ? \`['"]\`: "";
                        let reg = new RegExp(part +"\\\\$\\\\{\\\\{(" + key + ")\\\\}\\\\}"+ part, "gim")
                        item = item.replace(reg, value);
                    }
                    return item;
                }`;
                item.get = "##JSGetterFunction";
                jsGetter = await minify("js", jsGetter);
                if (format != "commonjs" && isTs)
                    jsGetter = jsGetter.trimEnd() + " as any as IGetter"
                data += `\nconst data = ${JSON.stringify(item, undefined, indent)};`;
                data = data.replace(`"##JSGetterFunction"`, jsGetter)
                if (format != "commonjs")
                    data += "\nexport default data;";
                else data += "\nmodule.exports = data;";
                for (let k in item) {
                    let subKey = typeof item[k] == "object" && item[k]?.content ? ".content" : "";
                    if (format != "commonjs")
                        data += `\nexport const ${k} = data.${k}${subKey};`;
                    else data += `\nmodule.exports.${k}= data.${k}${subKey};`
                }
                console.log("writing to", outputPath);
                ensureDir(outputPath);
                fs.writeFileSync(outputPath, data, 'utf8');
            }
        }
    } catch (e) {
        console.error("build Error", e);
        const msg = e.toString();

        vscode.window.showInformationMessage((!msg.startsWith("Error") ? 'Error on Build:' : "") + e.toString());
        throw e;
    }
}



module.exports = {
    minify,
    getAssets,
    beautify,
    pathId,
    join,
    build
};