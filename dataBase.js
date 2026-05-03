const fs = require('fs');
const path = require("path");
class DataBase {

    constructor(basePath) {
        this.base = basePath;
        this.databasePath = path.join(this.base, "media", "database.json");
        console.log("dbPath", this.databasePath)
        this.load();
    }

    load() {
        let data = JSON.parse(fs.readFileSync(this.databasePath, "utf8"));
        this.assign(data);
        return this;
    }

    assign(data) {
        Object.assign(this, { ...data, base: this.base, databasePath: this.databasePath, });
        return this;
    }

    saveChanges() {
        fs.writeFileSync(this.databasePath, JSON.stringify(this, undefined, 2), "utf8");
        return this;

    }
}

module.exports = {
    DataBase
}