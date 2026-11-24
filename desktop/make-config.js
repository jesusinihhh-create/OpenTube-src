// Writes app-config.json with your live site address. Usage: SITE_URL=https://your-site.onrender.com node make-config.js
const fs = require("fs");
const url = String(process.env.SITE_URL || "").trim().replace(/\/+$/, "");
if (!/^https:\/\/[^\s/]+/.test(url)) { console.error("SITE_URL must be your https:// site address."); process.exit(1); }
fs.writeFileSync(__dirname + "/app-config.json", JSON.stringify({ siteUrl: url }, null, 2));
console.log("Desktop app will open", url);
