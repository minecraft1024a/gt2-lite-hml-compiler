"use strict";
// 快速对比测试：files_index 页 —— 我们的编译器 vs 官方 HAP
const path = require('path');
const fs = require('fs');
const hml = require('./lib/hml');
const css = require('./lib/css');
const bundle = require('./lib/bundle');

bundle.initBabel();

const BASE = "/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default";
const pageDir = path.join(BASE, 'pages/files_index');

// 1. HML
const hmlSrc = fs.readFileSync(path.join(pageDir, 'files_index.hml'), 'utf8');
const renderFn = hml.compileTemplate(hmlSrc);
console.log("=== RENDER (ours) ===");
console.log(renderFn);
console.log();

// 2. CSS (with @import)
const cssDir = path.join(pageDir, 'files_index.css');
function resolveImport(rel) {
  const abs = path.resolve(path.dirname(cssDir), rel);
  try { return fs.readFileSync(abs, 'utf8'); } catch (e) { return null; }
}
const cssSrc = fs.readFileSync(cssDir, 'utf8');
const sheet = css.compileCss(cssSrc, resolveImport);
console.log("=== STYLESHEET (ours) ===");
console.log(JSON.stringify(sheet));
console.log();