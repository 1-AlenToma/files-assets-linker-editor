const path = require("path");
const fs = require("fs");
var http = require('http');
const { minify } = require("./methods")

let serverStarted = false;
let address = {
    base: "",
    media: ""
};
async function editorMinifier(context) {
    try {
        console.warn("Starting minification...");

        const monacoRoot = path.join(context.extensionPath, "media", "monaco");

        const files = [monacoRoot];

        while (files.length > 0) {
            const filePath = files.shift();

            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
                const children = fs.readdirSync(filePath);
                for (const child of children) {
                    files.push(path.join(filePath, child));
                }
                continue;
            }

            const ext = path.extname(filePath).replace(".", "");

            if (ext === "js" || ext === "css") {
                const content = fs.readFileSync(filePath, "utf8");

                const min = await minify(ext, content);

                fs.writeFileSync(filePath, min, "utf8");
            }
        }

        console.warn("Finished minifying editor");

    } catch (e) {
        console.error(e);
    }
}


function startMonacoServer(context, db) {
    return new Promise((resolve, reject) => {
        try {
            if (serverStarted) {
                resolve(address);
                return;
            }

            serverStarted = true;

            const monacoRoot = path.join(context.extensionPath);

            const server = http.createServer((req, res) => {
                try {
                    const pathname = new URL(req.url, "http://localhost").pathname;


                    // =========================
                    // MAP /vs/* → MONACO FOLDER
                    // =========================
                    let filePath;
                    filePath = path.join(monacoRoot, pathname);
                    // =========================
                    // SECURITY: prevent path traversal
                    // =========================
                    if (!filePath.startsWith(monacoRoot)) {
                        res.writeHead(403);
                        res.end("Forbidden");
                        return;
                    }


                    if ((fs.existsSync(filePath))) {
                        const ext = path.extname(filePath);

                        const mime = {
                            ".js": "application/javascript",
                            ".css": "text/css",
                            ".html": "text/html",
                            ".json": "application/json",
                            ".png": "image/png",
                            ".jpg": "image/jpeg",
                            ".svg": "image/svg+xml",
                            ".ttf": "font/ttf",
                            ".woff": "font/woff",
                            ".woff2": "font/woff2"
                        };

                        const head = {
                            "Content-Type": mime[ext] || "application/octet-stream",
                            "Cache-Control": "public, max-age=86400"
                        }
                        if (filePath.includes("app_js.js") || filePath.includes("app_styles.css")) {
                            delete head["Cache-Control"]
                        }
                        res.writeHead(200, head);

                        fs.createReadStream(filePath).pipe(res);
                        return;
                    }

                    // =========================
                    // 404 fallback
                    // =========================
                    console.log("fileNotfound", "pathname:", pathname, "filePath", filePath)
                    res.writeHead(404);
                    res.end("Not Found");

                } catch (err) {
                    console.error(err);
                    res.writeHead(500);
                    res.end("Server Error");
                }
            });

            server.listen(db.port ?? 0, "0.0.0.0", () => {
                const port = server.address().port;
                db.port = port;
                db.saveChanges();
                server.keepAliveTimeout = 60000;
                server.headersTimeout = 65000;

                address = {
                    base: `http://localhost:${port}`,
                    media: `http://localhost:${port}/media`
                };

                console.log("Monaco server:", address);

                resolve(address);
            });

        } catch (e) {
            reject(e);
        }
    });
}



module.exports = {
    startMonacoServer,
    editorMinifier
};