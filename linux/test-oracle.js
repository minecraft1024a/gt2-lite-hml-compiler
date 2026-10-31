"use strict";
// 与 SDK oracle 逐字对比 render/styleSheet（files_index 页）
const fs = require('fs');
globalThis.Babel = require('./vendor/babel.min.js');
const hml = require('./lib/hml');
const cssm = require('./lib/css');

const P = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default';
const pageDir = P + '/pages/files_index';

const hmlSrc = fs.readFileSync(pageDir + '/files_index.hml', 'utf8');
const renderFn = hml.compileTemplate(hmlSrc);

const cssDir = pageDir + '/files_index.css';
function resolveImport(rel) {
  const abs = require('path').resolve(require('path').dirname(cssDir), rel);
  try { return fs.readFileSync(abs, 'utf8'); } catch (e) { return null; }
}
const sheet = cssm.compileCss(fs.readFileSync(cssDir, 'utf8'), resolveImport);

const oracle = fs.readFileSync('/tmp/opencode/oracle-files_index.txt', 'utf8');

function norm(x, isRender) {
  let s = x.replace(/_vm/g, 'e');
  s = s.replace(/\bvm\b/g, 't');
  s = isRender ? s.replace(/onBubbleEvents/g, 'on') : s;
  s = s.replace(/[ \t\n]+/g, '');
  return s;
}

function compare(label, sdk, ours) {
  const a = norm(sdk, true), b = norm(ours, true);
  if (a === b) { console.log(label + ': ✔ 逐字等价'); return; }
  console.log(label + ': ✘ 差异 (len ' + a.length + ' vs ' + b.length + ')');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.log('  首个差异@' + i);
  console.log('  SDK:', a.slice(Math.max(0, i - 40), i + 80));
  console.log('  OUR:', b.slice(Math.max(0, i - 40), i + 80));
  if (a.slice(i) === '') console.log('  (SDK到此处结束)');
  if (b.slice(i) === '') console.log('  (OUR到此处结束)');
}

const mRender = oracle.match(/=== transformTemplate => render fn string ===\n([\s\S]*?)\n\n=== jsonStyle/);
if (mRender) compare('RENDER', mRender[1], renderFn);

const mStyle = oracle.match(/=== transformStyle => styleSheet ===\n([\s\S]*?)\n$/);
if (mStyle) {
  const a = norm(mStyle[1], false), b = norm(JSON.stringify(sheet), false);
  console.log(a === b ? 'STYLESHEET: ✔ 逐字等价' : 'STYLESHEET: ✘ 差异\nSDK:' + a.slice(0, 400) + '\nOUR:' + b.slice(0, 400));
}