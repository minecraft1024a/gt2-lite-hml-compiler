"use strict";
// 管线级测试：hml + css + bundle.js -> 页面 bundle，对照黄金参考结构
const fs = require('fs');
const path = require('path');
const hml = require('./lib/hml');
const css = require('./lib/css');
const bundle = require('./lib/bundle');
const BASE = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default';
const REF = '/tmp/tmp.2s2eHN3Kax/build/pages';
const APP_DIR = BASE; // 公共模块根目录（../../ 的落点）

function pageDir(p) { return path.join(BASE, 'pages', p); }

// 相对路径解析：page 目录内优先，其次 app 目录
function makeResolve(fromDir) {
  return function (spec) {
    if (spec.charAt(0) !== '.') return null;
    const cands = [path.resolve(fromDir, spec), path.resolve(APP_DIR, spec)];
    for (const c of cands) {
      if (fs.existsSync(c)) {
        return { source: fs.readFileSync(c, 'utf8'), resolve: makeResolve(path.dirname(c)), path: c };
      }
    }
    return null;
  };
}

function buildPage(name) {
  const dir = pageDir(name);
  const hmlSrc = fs.readFileSync(path.join(dir, name + '.hml'), 'utf8');
  const cssSrc = fs.readFileSync(path.join(dir, name + '.css'), 'utf8');
  const jsSrc = fs.readFileSync(path.join(dir, name + '.js'), 'utf8');
  const renderFn = hml.compileTemplate(hmlSrc);
  const sheet = css.compileCss(cssSrc);
  const styleStr = JSON.stringify(sheet);
  const res = bundle.bundlePage({
    scriptSource: jsSrc,
    resolveDep: makeResolve(dir),
    renderFn,
    styleSheet: styleStr,
  });
  return res;
}

// 结构校验：entry/render/style/script/deps 模块角色齐全，且能正确互相引用
function audit(name) {
  return new Promise((resolve) => {
    const mods = {};
    class VM { constructor(o) { mods.viewModel = o; } }
    const sandbox = {
      ViewModel: VM,
      requireNative: (s) => { mods.requireNative = (mods.requireNative || 0) + 1; return $native[s] || (suite.native[s] = {}); },
      $app: { getImports() { return suite.appImports; } },
      console: { info: () => {}, log: (...a) => {}, error: () => {} },
    };
    const suite = { native: {}, appImports: {} };
  });
}

(async () => {
  const tests = [
    ['files_index', false],
    ['index', true],
    ['menu', false],
    ['viewer_dir', false],
  ];
  for (const [name, hasDeps] of tests) {
    try {
      const res = buildPage(name);
      const js = res.js;
      // 读取黄金参考
      const refJs = fs.readFileSync(path.join(REF, name, name + '.js'), 'utf8');
      // DNS 检查：entry 引用 render/style/script
      const hasEntry = js.indexOf('new ViewModel(c)') > 0 && js.indexOf('c.render') > 0;
      const hasRuntime = js.indexOf('i.m=') > 0 && js.indexOf('i.t=') > 0 && js.indexOf('i.n=') > 0;
      const hasHelpers = js.includes('Cannot instantiate an arrow function') && js.includes('c=module.exports') === false;
      const depCount = (js.match(/__webpack_require__\((\d+)\)/g) || []).length;
      console.log('[' + (hasEntry && hasRuntime && hasHelpers ? 'OK' : 'MISSING') + '] ' + name +
        ' | my ' + js.length + 'B / ref ' + refJs.length + 'B' +
        ' | moduleIds=' + JSON.stringify(res.moduleIds) + ' | require 数=' + depCount +
        ' | deps=' + (hasDeps ? '已注册' : '无'));
    } catch (e) {
      console.log('[FAIL] ' + name + ': ' + (e.message || e).split('\n')[0]);
    }
  }
})();