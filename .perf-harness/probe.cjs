const { app } = require("electron");
app.on("ready", () => { console.log("ELECTRON_OK", process.versions.electron, process.versions.chrome); app.exit(0); });
setTimeout(() => { console.log("ELECTRON_TIMEOUT"); app.exit(1); }, 15000);
