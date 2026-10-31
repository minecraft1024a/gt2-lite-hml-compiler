"use strict";
const fs = require('fs'), vm = require('vm');
const bundle = require('./lib/bundle');
const APP = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default/app.js';
const res = bundle.bundleApp(fs.readFileSync(APP, 'utf8'));
const js = res.js;
console.log('app bundle bytes:', js.length);
const form = (js.match(/\}\)\((\[|\{)/) || ['?', '?'])[1];
console.log('容器形态:', form === '[' ? '数组带洞' : form === '{' ? '对象' : '?');
console.log('entry=new ViewModel:', js.includes('new ViewModel(o)'));
console.log('manifest hook:', /\(exports\["default"\] \|\| module\.exports\)\.manifest = __webpack_require__\(4\)/.test(js));
console.log('requireModule tail:', js.includes('function requireModule(moduleName){return requireNative(moduleName.slice(1))}'));
console.log('manifest 占位:', js.includes("JSON.parse('{\"manifest.json\":\"content\"}')"));
let captured = null;
const ctx = {
  console: { info: () => {}, log: () => {}, error: () => {} },
  $app: { getImports: () => ({}) },
  requireNative: () => ({}),
  ViewModel: class { constructor(o) { captured = o; } },
  Symbol, Object, Array, JSON, Math, String, Number, Boolean, Error, TypeError, setTimeout,
};
vm.createContext(ctx);
vm.runInContext(js, ctx, { timeout: 3000 });
console.log('执行 ok, options 键:', captured ? Object.keys(captured).join(',') : 'none');
console.log('moduleIds:', JSON.stringify(res.moduleIds));