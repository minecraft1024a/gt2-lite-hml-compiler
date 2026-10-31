"use strict";
// 执行级测试：用 VM 运行我的页面 bundle 与黄金参考 bundle，比对 ViewModel options
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const hml = require('./lib/hml');
const css = require('./lib/css');
const bundle = require('./lib/bundle');
const BASE = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default';
const REF = '/tmp/tmp.2s2eHN3Kax/build/pages';
const APP_DIR = BASE;
const PAGES = ['files_index', 'index', 'menu', 'menu_about', 'menu_licenses', 'menu_sponsor', 'router',
  'viewer_dir', 'viewer_dir_options', 'viewer_img', 'viewer_script', 'viewer_script_run',
  'viewer_script_warnings', 'viewer_text', 'viewer_text_options'];

function makeResolve(fromDir) {
  return function (spec) {
    if (spec.charAt(0) !== '.') return null;
    const cands = [path.resolve(fromDir, spec), path.resolve(APP_DIR, spec)];
    for (const c of cands) {
      if (fs.existsSync(c)) return { source: fs.readFileSync(c, 'utf8'), resolve: makeResolve(path.dirname(c)), path: c };
    }
    return null;
  };
}

function buildPage(name) {
  const dir = path.join(BASE, 'pages', name);
  const renderFn = hml.compileTemplate(fs.readFileSync(path.join(dir, name + '.hml'), 'utf8'));
  const styleStr = JSON.stringify(css.compileCss(fs.readFileSync(path.join(dir, name + '.css'), 'utf8')));
  return bundle.bundlePage({
    scriptSource: fs.readFileSync(path.join(dir, name + '.js'), 'utf8'),
    resolveDep: makeResolve(dir),
    renderFn,
    styleSheet: styleStr,
  }).js;
}

// 运行 bundle，捕获 ViewModel options
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

function normalizeScriptFn(fnSrc) {
  // 只比对方法结构与内部引用的对象形状，忽略 mangle 无关信息
  return String(fnSrc).replace(/\s+/g, ' ').trim();
}

let pass = 0, fail = 0;
for (const name of PAGES) {
  try {
    const suiteMy = { native: {}, imports: makeImports() };
    const myOptions = run(buildPage(name), suiteMy);
    const refJs = fs.readFileSync(path.join(REF, name, name + '.js'), 'utf8');
    const suiteRef = { native: {}, imports: makeImports() };
    const refOptions = run(refJs, suiteRef);

    if (!myOptions || !refOptions) throw new Error('ViewModel 未捕获');
    // 1. data 深度比对
    const myData = myOptions.data, refData = refOptions.data;
    const dataEq = JSON.stringify(myData) === JSON.stringify(refData);
    // 2. sheet/render 存在性
    const sheetOk = !!myOptions.styleSheet && !!refOptions.styleSheet;
    const renderOk = typeof myOptions.render === 'function' && typeof refOptions.render === 'function';
    // 3. 方法面：原型键集合一致
    const myKeys = Object.keys(myOptions).filter(k => typeof myOptions[k] === 'function').sort().join(',');
    const refKeys = Object.keys(refOptions).filter(k => typeof refOptions[k] === 'function').sort().join(',');
    const fnKeysEq = myKeys === refKeys;

    const ok = dataEq && sheetOk && renderOk && fnKeysEq;
    if (ok) pass++; else fail++;
    console.log((ok ? '[PASS]' : '[FAIL]') + ' ' + name +
      (dataEq ? '' : ' | data 不同: ' + JSON.stringify(myData) + ' vs ' + JSON.stringify(refData)) +
      (sheetOk ? '' : ' | styleSheet 缺失') +
      (renderOk ? '' : ' | render 非函数') +
      (fnKeysEq ? '' : ' | 方法面不同: [' + myKeys + '] vs [' + refKeys + ']'));
  } catch (e) {
    fail++;
    console.log('[FAIL] ' + name + ': ' + (e.message || e).split('\n')[0]);
  }
}
console.log('===== ' + pass + ' passed, ' + fail + ' failed =====');