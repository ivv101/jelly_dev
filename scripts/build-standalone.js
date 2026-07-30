"use strict";

const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const htmlPath = path.join(projectRoot, "index.html");
const javascriptPath = path.join(projectRoot, "jelly.js");
const outputPath = path.join(projectRoot, "jelly-standalone.html");
const scriptTagPattern = /<script\s+src=(['"])jelly\.js\1\s*><\/script>/g;

function buildStandalone() {
  const html = readFileSync(htmlPath, "utf8");
  const matches = [...html.matchAll(scriptTagPattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one jelly.js script tag in index.html; found ${matches.length}.`,
    );
  }

  const javascript = readFileSync(javascriptPath, "utf8")
    .trimEnd()
    .replace(/<\/script/gi, "<\\/script");
  const inlineScript = `<script>\n${javascript}\n</script>`;
  return html.replace(scriptTagPattern, inlineScript);
}

const expected = buildStandalone();
if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== expected) {
    console.error(
      "jelly-standalone.html is out of date. Run `npm run build:standalone`.",
    );
    process.exitCode = 1;
  }
} else {
  writeFileSync(outputPath, expected);
  console.log("Built jelly-standalone.html");
}
