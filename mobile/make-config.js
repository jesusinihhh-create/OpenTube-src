// Writes capacitor.config.json for your live site. Usage: SITE_URL=https://your-site.onrender.com node make-config.js
const fs = require("fs");
const url = String(process.env.SITE_URL || "").trim().replace(/\/+$/, "");
if (!/^https:\/\/[^\s/]+/.test(url)) { console.error("SITE_URL must be your https:// site address."); process.exit(1); }
const host = new URL(url).host;
fs.writeFileSync(__dirname + "/capacitor.config.json", JSON.stringify({
  appId: "com.opentube.app", appName: "OpenTube", webDir: "www",
  server: { url, cleartext: false, allowNavigation: [host] },
  android: { allowMixedContent: false },
}, null, 2));
console.log("Android app will open", url);
