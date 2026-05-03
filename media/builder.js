function get(fileKey, ...keyValues) {
    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function isJson(value) {
        try {
            return ((value.trim().startsWith("{") || value.trim().startsWith("[")) && JSON.parse(value))
        } catch { }
        return false;
    }
    let item = data[fileKey];
    if (typeof item == "object")
        item = item.content;
    if (!item)
        return item;
    for (let keyValue of keyValues) {
        let literal = "";
        if (keyValue.startsWith("'") || keyValue.startsWith('"')) {
            literal = keyValue[0];
            keyValue = keyValue.slice(1, keyValue.length - 1);
        }
        const index = keyValue.indexOf(":");
        const key = index === -1 ? keyValue : keyValue.slice(0, index);
        const safeKey = escapeRegex(key);
        const cssSafeKey = escapeRegex(key.replace(/\./g, "-"));
        const value = index === -1 ? "" : keyValue.slice(index + 1);


        // for css and html style
        let reg0 = new RegExp(
            `var\\((\\s*)(--)${globalVar}-keys-(${cssSafeKey}(?![a-zA-Z0-9_-]))(\\s*)\\)`,
            "gi"
        );

        let reg1 = new RegExp(
            `var\\((\\s*)${globalVar}-keys-(${cssSafeKey}(?![a-zA-Z0-9_-]))(\\s*)\\)`,
            "gi"
        );

        // for css and html style, make sure we did not miss any, thar are not inside var
        let reg2 = new RegExp(
            `(--)${globalVar}-keys-(${cssSafeKey}(?![a-zA-Z0-9_-]))`,
            "gi"
        );

        // for html script and js
        let reg3 = new RegExp(
            `${globalVar}\\.keys\\.(${safeKey}(?![a-zA-Z0-9_-]))`,
            "gi"
        );

        let verValue = value;
        if (!isJson(verValue)) {
            if (verValue.toLowerCase() != "true" && verValue.toLowerCase() != "false") {
                if (/[^0-9]/i.test(verValue))
                    verValue = `"${verValue}"`;
            }
        }

        item = item.replace(reg0, value).replace(reg1, value).replace(reg2, value).replace(reg3, verValue);

    }
    return item;
}