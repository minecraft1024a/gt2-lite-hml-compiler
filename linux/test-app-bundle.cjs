"use strict";
const fs = require('fs'), vm = require('vm');
const bundle = require('./lib/bundle');

let captured = null;
function newCtx() {
  return {
    console: { info: () => {}, log: () => {}, error: () => {} },
    $app: { getImports: () => ({}) },
    requireNative: () => ({}),
    ViewModel: class { constructor(o) { captured = o; } },
    Symbol, Object, Array, JSON, Math, String, Number, Boolean, Error, TypeError, setTimeout,
  };
}
function runAppBundle(appSource) {
  captured = null;
  const res = bundle.bundleApp(appSource);
  const js = res.js;
  const form = (js.match(/}\)\(\[/) ? '[' : js.match(/\)\(\{/) ? '{' : '?');
  const ctx = newCtx();
  vm.createContext(ctx);
  vm.runInContext(js, ctx, { timeout: 3000 });
  return { js, form, res, captured };
}

console.log('--- 用例1：无 import app.js（老工程基线，0/1 槽位保持空洞） ---');
const APP = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default/app.js';
const r1 = runAppBundle(fs.readFileSync(APP, 'utf8'));
const js1 = r1.js;
console.log('app bundle bytes:', js1.length);
console.log('容器形态:', r1.form === '[' ? '数组带洞' : r1.form === '{' ? '对象' : '?');
console.log('模块 0/1 保持空洞:', /\)\(\[,,/.test(js1));
console.log('entry=new ViewModel:', js1.includes('new ViewModel(o)'));
console.log('manifest hook:', /\(exports\["default"\] \|\| module\.exports\)\.manifest = __webpack_require__\(4\)/.test(js1));
console.log('requireModule tail:', js1.includes('function requireModule(moduleName){return requireNative(moduleName.slice(1))}'));
console.log('manifest 占位:', js1.includes("JSON.parse('{\"manifest.json\":\"content\"}')"));
console.log('执行 ok, options 键:', r1.captured ? Object.keys(r1.captured).join(',') : 'none');
console.log('moduleIds:', JSON.stringify(r1.res.moduleIds));

console.log('\n--- 用例2：app.js 带 import（bundleApp helper 空洞 bug 回归） ---');
const APP_IMPORT = `
import app from '@system.app';
export default {
  onCreate() { app.getInfo(); }
};
`;
const r2 = runAppBundle(APP_IMPORT);
const js2 = r2.js;
console.log('容器形态:', r2.form === '[' ? '数组带洞' : r2.form === '{' ? '对象' : '?');
console.log('模块 0 已填 interop helper（非空洞）:', /\)\(\[function/.test(js2) && js2.includes('function n(t){return t&&t.__esModule?t:{default:t}}'));
console.log('manifest hook:', /\(exports\["default"\] \|\| module\.exports\)\.manifest = __webpack_require__\(4\)/.test(js2));
console.log('执行 ok, options 键:', r2.captured ? Object.keys(r2.captured).join(',') : 'none');

console.log('\n--- 用例3：仅箭头函数 app.js（interop + newArrowCheck 双双命中模块 0/1） ---');
const APP_ARROW = 'export default { onCreate: () => { const f = () => 1; } };';
const r3 = runAppBundle(APP_ARROW);
const js3 = r3.js;
console.log('容器形态:', r3.form === '[' ? '数组带洞' : r3.form === '{' ? '对象' : '?');
console.log('模块 1 已填 newArrowCheck helper:', /\)\(\[function/.test(js3) && js3.includes('throw new TypeError("Cannot instantiate an arrow function")'));
console.log('执行 ok, options 键:', r3.captured ? Object.keys(r3.captured).join(',') : 'none');

// 断言：全部通过才算绿
let pass = true;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) pass = false; }
check('用例1 容器为数组', r1.form === '[');
check('用例1 0/1 保持空洞', /\)\(\[,,/.test(js1));
check('用例1 无 helper 引用', !/__webpack_require__\([01]\)/.test(js1));
check('用例1 VM 执行 + manifest 挂载', r1.captured && 'manifest' in r1.captured);
check('用例2 模块0已填 helper（非空洞）', /\)\(\[function/.test(js2) && js2.includes('function n(t){return t&&t.__esModule?t:{default:t}}'));
check('用例2 VM 执行 + manifest 挂载（回归 bug 修复）', r2.captured && 'manifest' in r2.captured);
check('用例3 模块1已填 newArrowCheck helper', js3.includes('throw new TypeError("Cannot instantiate an arrow function")'));
check('用例3 VM 执行 + manifest 挂载', r3.captured && 'manifest' in r3.captured);
console.log(pass ? '\n全部通过' : '\n存在失败用例');
process.exitCode = pass ? 0 : 1;
