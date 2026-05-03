const esbuild = require("esbuild");
const { minify: minifyHtml } = require("html-minifier-terser");
const { transform } = require("lightningcss");
const fs = require('fs');
const path = require('path');
const beautifyLib = require("js-beautify");
const vscode = require('vscode');

const configFileName = "file-assets-linker.json";

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

const joinUrl = (base, ...args) => {
    try {
        args.forEach(x => {
            if (!base.endsWith("/"))
                base += "/";
            if (x.startsWith("/"))
                x = x.substring(0, x.length - 1);
            base += x;
        })

        return base;
    } catch (e) {
        console.error(e, "value:", base, "args:", ...args);
        throw e;
    }
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

const cleanConfig = (config, root) => {
    let orgConfig;
    try {
        console.info("Clean config for", root)
        const configPath = join(root, configFileName);
        orgConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!Array.isArray(orgConfig))
            orgConfig = [orgConfig];
        if (!Array.isArray(config))
            config = [config];
        let cnf = [];
        for (let c of config) {

            let item = { ...c, assets: [] };
            if (item.groupId != undefined)
                delete item.groupId;
            if (!item.keys) {
                item.keys = [];
            }
            cnf.push(item);
            for (let asset of c.assets) {
                if (asset.assetKey)
                    continue;
                let _as = { ...asset };
                if (_as.id != undefined) {
                    let oc = orgConfig.find(x => x.assets.some(s => pathId(join(root, s.path)) == asset.id));
                    let os = oc.assets.find(s => pathId(join(root, s.path)) == asset.id);
                    delete _as.fileName;
                    delete _as.dirName;
                    delete _as.cleanName;
                    delete _as.id;
                    delete _as.ext;
                    _as.path = os.path;
                }

                item.assets.push(_as);
            }
        }
        fs.writeFileSync(configPath, JSON.stringify(cnf, undefined, 4), "utf8");
        return cnf;
    } catch (e) {
        console.error(e, "orgConfig:", orgConfig, "config", config);
    }
}



const getAssets = (root) => {
    try {
        const configPath = join(root, configFileName);
        if (!fs.existsSync(configPath))
            throw "asset dose not exist"
        let config = cleanConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')), root);
        if (!Array.isArray(config)) {
            config = [config]
        }
        let i = 0;
        let changed = false;
        for (let c of config) {
            if (!c.globalVar || c.globalVar.trim().length <= 1) {
                c.globalVar = "AssetsLinkEditor";
                changed = true;
            }

            c.groupId = i++;
            c.assets.push({
                path: join(path.dirname(join(root, c.assets[0].path)), "files-assets-linker-editor-keys.json"),
                name: "keys",
                assetKey: true
            });
            for (let asset of c.assets) {
                const fullPath = asset.path.includes("files-assets-linker-editor") ? asset.path : join(root, asset.path);
                asset.path = fullPath;
                asset.fileName = path.basename(fullPath);
                asset.dirName = path.dirname(fullPath);
                asset.cleanName = path.parse(fullPath).name;
                asset.id = asset.id ?? pathId(asset.path);
                asset.ext = path.parse(fullPath).ext.replace(".", "").trim();
                asset.groupId = c.groupId;
            }
        }
        if (changed)
            cleanConfig(config, root);
        return config;
    } catch (e) {
        console.error(e);
        throw e;
    }
}

function append(...args) {
    return args.join("");
}


async function build(root, config, appRoot) {
    try {

        console.log("building data", root)
        const builderJs = fs.readFileSync(join(appRoot, "media", "builder.js"), "utf8");
        const files = {}; builderJs
        for (let c of config) {
            for (const asset of c.assets || []) {
                if (asset.assetKey)
                    continue;
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
                        files[output] = { ___format: format, ___indent: c.indent, ___keys: c.keys, ___globalVar: c.globalVar }
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
                let ___keysUsed = item.___keys;
                let globalVar = item.___globalVar;
                const externalData = { ___keysUsed }
                const outputPath = join(root, p);
                const isTs = outputPath.endsWith("ts");
                delete item.___format;
                delete item.___minifyCode;
                delete item.___indent;
                delete item.___keys;
                delete item.___globalVar;


                let data = `
                /** 
                ** File created by files-assets-linker-editor 
                ** config: ${join(root, configFileName)}
                ** lib: https://github.com/1-AlenToma/files-assets-linker-editor
                */`.replace(/^\s+/gm, '') + "\n";

                let jsGetter = "";
                let _any = format != "commonjs" ? "as any" : ""
                if (format != "commonjs" && isTs) {
                    data += append(
                        `const ___keysUsed = `,
                        JSON.stringify(___keysUsed, undefined, indent),
                        " as const;",
                        "\ntype S = typeof ___keysUsed[number];",
                        "\ntype keyValue = `${S}:${string}`;",
                        `\ntype IGetter = (fileKey:`,
                        Object.keys(item).map(x => `"${x}"`).join("|"),
                        `, ...keyValues:keyValue[]) => string;`
                    )
                } else {
                    data += append(
                        `const ___keysUsed = `,
                        JSON.stringify(___keysUsed, undefined, indent),
                        ";"
                    )
                }
                data += `\nconst globalVar = "${globalVar}";\n`;
                jsGetter += builderJs;
                item.get = "##JSGetterFunction";
                jsGetter = await minify("js", jsGetter);
                if (format != "commonjs" && isTs)
                    jsGetter = jsGetter.trimEnd() + " as any as IGetter";
                data += `\nconst data = ${JSON.stringify(item, undefined, indent)};`;
                data = data.replace(/"##JSGetterFunction"/g, () => jsGetter);
                if (format != "commonjs")
                    data += "\nexport default data;";
                else data += "\nmodule.exports = data;";

                for (let k in item) {
                    let subKey = typeof item[k] == "object" && item[k]?.content ? ".content" : "";
                    let v = `data.${k}${subKey};`;
                    if (k === "get")
                        v = `(fileKey, ...keyValues)=> data.${k}${subKey}(fileKey, ...keyValues);`;
                    data += `\nconst ${k}${k == "get" && (format != "commonjs" && isTs) ? ": IGetter" : ""} = ${v}`;
                    externalData[k] = true;
                }

                data += append(format != "commonjs" ? "\nexport {\n" : "\n",
                    Object.keys(externalData).map(k => format != "commonjs" ? `${k}` : `module.exports.${k} = ${k};`).join(format != "commonjs" ? ",\n" : "\n"),
                    format != "commonjs" ? "\n}" : ""
                )

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
    joinUrl,
    build,
    cleanConfig,
    configFileName
};