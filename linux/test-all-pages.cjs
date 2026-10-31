"use strict";
// 全部页面：我们的编译器 vs SDK oracle —— render/styleSheet 逐字对比
const fs = require('fs');
const path = require('path');
globalThis.Babel = require('./vendor/babel.min.js');
const hml = require('./lib/hml');
const cssm = require('./lib/css');

const BASE = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default';
const pages = fs.readdirSync(path.join(BASE, 'pages'))
  .map(d => path.basename(d))
  .sort();

function resolveImportFor(cssDir) {
  return (rel) => {
    const abs = path.resolve(path.dirname(cssDir), rel);
    try { return fs.readFileSync(abs, 'utf8'); } catch (e) { return null; }
  };
}

function norm(x, isRender) {
  let s = x.replace(/_vm/g, 'e').replace(/\bvm\b/g, 't');
  if (isRender) s = s.replace(/onBubbleEvents/g, 'on');
  s = s.replace(/[ \t\n]+/g, '');
  // terser 会剥掉对象/数组里的尾逗号：`{'a':1,}` -> `{'a':1}`，`[a,]` -> `[a]`
  let prev;
  do { prev = s; s = s.replace(/,(?=[}\]])/g, ''); } while (s !== prev);
  return s;
}
function diffAt(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

const oracleOf = {}; // page -> oracle text
for (const pg of pages) {
  const hmlPath = path.join(BASE, 'pages', pg, pg + '.hml');
  if (!fs.existsSync(hmlPath)) continue;
  const cssPath = path.join(BASE, 'pages', pg, pg + '.css');
  const r = require('child_process').execFileSync('node', ['/tmp/opencode/observe-parser.cjs', hmlPath, cssPath], { encoding: 'utf8' });
  oracleOf[pg] = r;
}

let pass = 0, fail = 0;
for (const pg of pages) {
  const orc = oracleOf[pg];
  if (!orc) continue;
  const hmlPath = path.join(BASE, 'pages', pg, pg + '.hml');
  const cssPath = path.join(BASE, 'pages', pg, pg + '.css');
  let renderFn, sheet;
  try {
    renderFn = hml.compileTemplate(fs.readFileSync(hmlPath, 'utf8'));
    sheet = cssm.compileCss(fs.readFileSync(cssPath, 'utf8'), resolveImportFor(cssPath));
  } catch (e) {
    console.log('[FAIL] ' + pg + ' 编译异常: ' + e.message.split('\n')[0]);
    fail++; continue;
  }
  const mR = orc.match(/=== transformTemplate => render fn string ===\n([\s\S]*?)\n\n=== jsonStyle/);
  const mS = orc.match(/=== transformStyle => styleSheet ===\n([\s\S]*?)\n$/);
  let ok = true;
  if (mR) {
    const a = norm(mR[1], true), b = norm(renderFn, true);
    if (a !== b) {
      const i = diffAt(a, b);
      console.log('[FAIL render] ' + pg + ' diff@' + i);
      console.log('   SDK:' + JSON.stringify(a.slice(i - 30, i + 70)));
      console.log('   OUR:' + JSON.stringify(b.slice(i - 30, i + 70)));
      ok = false;
    }
  }
  if (mS) {
    const a = norm(mS[1], false), b = norm(JSON.stringify(sheet), false);
    if (a !== b) {
      const i = diffAt(a, b);
      console.log('[FAIL style]  ' + pg + ' diff@' + i);
      console.log('   SDK:' + JSON.stringify(a.slice(i - 30, i + 70)));
      console.log('   OUR:' + JSON.stringify(b.slice(i - 30, i + 70)));
      ok = false;
    }
  }
  if (ok) { console.log('[PASS] ' + pg); pass++; } else fail++;
}
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');