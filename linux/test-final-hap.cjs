"use strict";
// 终验收：从 CLI 构建的 HAP 抽取全部 .js/.bc，VM 执行页面 bundle 验证
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const BUILD = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files';
const HAP = '/tmp/opencode/e2e-release.hap';

// 重新构建一次（确保经 CLI 完整链路）
execSync('rm -rf /tmp/opencode/e2e-cli && mkdir -p /tmp/opencode/e2e-cli');
execSync(`cd /home/yishan/gt2-hap-sideload/compiler/linux && node bin/gt2-build.js "${BUILD}" -o /tmp/opencode/e2e-cli/release.hap --build /tmp/opencode/e2e-cli/build >/dev/null 2>&1`);
execSync('rm -rf /tmp/opencode/e2e-cli/hap && mkdir -p /tmp/opencode/e2e-cli/hap && unzip -q /tmp/opencode/e2e-cli/release.hap -d /tmp/opencode/e2e-cli/hap');

const HAP_DIR = '/tmp/opencode/e2e-cli/hap';

function makeImports() {
  const memory = {
    viewDirMode: '', paths: ['pages/viewer_dir/viewer_dir'], theme: 0, fontSize: 28,
    autoPagerSpeed: 3, fileSize: 0, viewTextHistory: [], speed: 3, uiHeight: 466, uiWidth: 466,
    set(k, v) { this[k] = v; }, save() {},
  };
  const base = {
    app: { getInfo: () => ({ versionName: '1.0' }), terminate() {} },
    battery: { getStatus: () => ({ level: 100, charging: false }) },
    brightness: { getValue: () => 1, setValue() {} },
    device: { getInfo: () => ({ device: 'GT2', model: '' }) },
    file: { list: () => [], open() {}, close() {}, readText: () => [], readArrayBuffer: () => new ArrayBuffer(0), copy() {}, mkdir() {}, move() {}, access: () => ({ exists: true }) },
    router: { replace() {} },
    storage: { get: () => '', set() {}, delete() {} },
    vibrator: { vibrate() {} },
    bundleName: { get: () => 'com.example' },
    headerTimeBattery: { time: '10:30', battery: '100%', subscribe() {} },
    memory,
    uiSizes: { uiWidth: 466, uiHeight: 466 },
  };
  return new Proxy(base, { get(t, k) { if (!(k in t)) t[k] = {}; return t[k]; } });
}

function run(js, suite) {
  let captured = null;
  const context = {
    console: { info: () => {}, log: () => {}, error: (e) => { throw new Error(String(e)); }, warn: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Symbol, Object, Array, JSON, Math, String, Number, Boolean, RegExp, Date, Error, TypeError, Promise,
    parseInt, parseFloat, isNaN, isFinite, encodeURI, decodeURI, encodeURIComponent, decodeURIComponent,
    requireNative: (spec) => suite.native[spec] || (suite.native[spec] = {}),
    $app: { getImports: () => suite.imports },
    ViewModel: class VM { constructor(o) { captured = o; } },
  };
  vm.createContext(context);
  vm.runInContext(js, context, { timeout: 5000 });
  return captured;
}

// 全部页面 .js 执行（含 render/styleSheet 装配 + data + 方法面）
const jsBase = path.join(HAP_DIR, 'assets/js/default');
let pass = 0, fail = 0;
for (const p of fs.readdirSync(path.join(jsBase, 'pages'))) {
  const jsPath = path.join(jsBase, 'pages', p, p + '.js');
  try {
    const suite = { native: {}, imports: makeImports() };
    const opt = run(fs.readFileSync(jsPath, 'utf8'), suite);
    const dataOk = !('data' in opt) || (typeof opt.data === 'object' && opt.data !== null);
    const renderOk = typeof opt.render === 'function';
    const sheetOk = opt.styleSheet !== undefined;
    const fnCount = Object.keys(opt).filter((k) => typeof opt[k] === 'function').length;
    if (dataOk && renderOk && sheetOk) { pass++; console.log('  [OK] ' + p + '  data键=' + ('data' in opt ? Object.keys(opt.data).length : '(无)') + ' 方法=' + (fnCount - 2)); }
    else { fail++; console.log('  [XX] ' + p + ' data=' + dataOk + ' render=' + renderOk + ' sheet=' + sheetOk); }
  } catch (e) {
    fail++; console.log('  [XX] ' + p + ': ' + String(e.message || e).split('\n')[0]);
  }
}
// app.js 执行
try {
  const suite = { native: {}, imports: makeImports() };
  const opt = run(fs.readFileSync(path.join(jsBase, 'app.js'), 'utf8'), suite);
  const ok = opt && ['onCreate', 'onDestroy', 'setImports', 'getImports', 'manifest'].every((k) => k in opt);
  console.log((ok ? '  [OK] ' : '  [XX] ') + 'app.js' + (ok ? ' options键完整' : ''));
  ok ? pass++ : fail++;
} catch (e) {
  fail++; console.log('  [XX] app.js: ' + String(e.message || e).split('\n')[0]);
}
// .bc 全部 v24
let bcOk = true, bcn = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.bc')) { bcn++; const b = fs.readFileSync(p); if (!(b[0] === 0x4a && b[1] === 0x52 && b[2] === 0x52 && b[3] === 0x59 && b.readUInt32LE(4) === 24)) bcOk = false; } } };
walk(jsBase);
console.log((bcOk ? '  [OK] ' : '  [XX] ') + '.bc 全部 v24（' + bcn + ' 个）');
bcOk ? pass++ : fail++;
console.log('===== ' + pass + ' passed, ' + fail + ' failed =====');
process.exitCode = fail ? 1 : 0;