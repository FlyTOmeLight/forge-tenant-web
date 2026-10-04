const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
let html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
html = html
  .replace("<body>", '<body data-mode="prototype">')
  .replace(
    /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g,
    (_, file) =>
      "<style>" +
      fs.readFileSync(path.join(root, "dist", file), "utf8") +
      "</style>",
  );
html = html.replace(
  /<script[^>]+src="([^"]+)"[^>]*><\/script>/g,
  (_, file) =>
    '<script type="module">' +
    fs
      .readFileSync(path.join(root, "dist", file), "utf8")
      .replace(/<\/script/gi, "<\\/script") +
    "</script>",
);
const output = process.argv[2] || path.join(root, "dist/forge-prototype.html");
fs.writeFileSync(output, html);
console.log("Standalone Vue prototype exported.");
