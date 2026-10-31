"use strict";
/**
 * JS 打包器：页面/app -> webpack4 风格 bundle（纯 JS，无 webpack 依赖）
 * 逆向自 SDK ace-loader lib/{loader,module-script,script}.js + babel.config.js
 * 结构对齐官方产物（黄金参考 /tmp/tmp.2s2eHN3Kax/build/*.js）：
 *   页面 bundle: (runtime)({0:interop, 1:newArrowCheck, entry, render, styleSheet, script, deps...})
 *   entry 模块 : new ViewModel(c)  c = script.default + styleSheet + render
 *   app bundle : (runtime)([,,entry(2), script(3), manifest(4)])  manifest 为 SDK 占位串
 *   babel 配置  : preset-env + transform-modules-commonjs + class-properties
 *                 + transform-runtime（helper 抽为模块 0/1）+ arrow-functions{spec:true}
 */

// webpack4 runtime（与官方产物一致，含 i.t/i.n）
const RUNTIME =
  '(function(t){var e={};function i(n){if(e[n]){return e[n].exports}var r=e[n]={i:n,l:false,exports:{}};t[n].call(r.exports,r,r.exports,i);r.l=true;return r.exports}i.m=t;i.c=e;i.d=function(t,e,n){if(!i.o(t,e)){Object.defineProperty(t,e,{enumerable:true,get:n})}};i.r=function(t){if(typeof Symbol!=="undefined"&&Symbol.toStringTag){Object.defineProperty(t,Symbol.toStringTag,{value:"Module"})}Object.defineProperty(t,"__esModule",{value:true})};i.t=function(t,e){if(e&1)t=i(t);if(e&8)return t;if(e&4&&typeof t==="object"&&t&&t.__esModule)return t;var n=Object.create(null);i.r(n);Object.defineProperty(n,"default",{enumerable:true,value:t});if(e&2&&typeof t!="string")for(var r in t)i.d(n,r,function(e){return t[e]}.bind(null,r));return n};i.n=function(t){var e=t&&t.__esModule?function e(){return t["default"]}:function e(){return t};i.d(e,"a",e);return e};i.o=function(t,e){return Object.prototype.hasOwnProperty.call(t,e)};i.p="";return i(i.s=__ENTRY__)})(__MODULES__)';

// ---------- Babel ----------
function initBabel() {
  let B = null;
  if (typeof globalThis !== 'undefined' && globalThis.Babel) {
    B = globalThis.Babel;
  } else {
    try { B = require('../vendor/babel.min.js'); }
    catch (e) { throw new Error('无法加载 babel（需 vendor/babel.min.js）：' + e.message); }
  }
  if (typeof globalThis !== 'undefined' && !globalThis.Babel) globalThis.Babel = B;
  _babel = B;
  return B;
}
let _babel = null;
function getBabel() { if (!_babel) _babel = initBabel(); return _babel; }

/**
 * ES6 源码 -> ES5 CommonJS 字符串（镜像 SDK babel.config.js）
 * transform-runtime 把 helper 抽成 require("@babel/runtime/helpers/X")，
 * 供 rewriteRequires 映射到 bundle 模块 0/1。
 */
function babelToEs5(source) {
  const B = getBabel();
  const out = B.transform(String(source), {
    sourceType: 'module',
    comments: false,
    presets: [['env', {}]],
    plugins: [
      'transform-modules-commonjs',
      'transform-class-properties',
      'transform-runtime',
      ['transform-arrow-functions', { spec: true }],
    ],
  });
  return out.code;
}

// ---------- require 改写 ----------
const REQ_RE = /require\(\s*(['"])([^'"]+?)\1\s*\)/g;
// transform-runtime helper spec -> bundle 模块 id（helper 恒占 0/1）
const RUNTIME_HELPERS = { interopRequireDefault: 0, newArrowCheck: 1 };
function relativeSpecs(es5) {
  const rel = [];
  let m;
  REQ_RE.lastIndex = 0;
  while ((m = REQ_RE.exec(es5)) !== null) {
    const spec = m[2];
    if (spec.charAt(0) === '.') rel.push(spec);
  }
  return rel;
}
// 改写 es5 中的 require：
//   @babel/runtime/helpers/X     -> __webpack_require__(helperId)（剥掉 interop 的 ["default"]）
//   @system.x                    -> requireModule("@system.x")
//   ./rel                        -> __webpack_require__(id)
function rewriteRequires(es5, idOf) {
  es5 = es5.replace(
    /require\(\s*["']@babel\/runtime\/helpers\/([a-zA-Z]+)["']\s*\)(\[\s*["']default["']\s*\])?/g,
    (whole, name, accessor) => {
      const id = RUNTIME_HELPERS[name];
      if (id === undefined) return whole;
      return '__webpack_require__(' + id + ')';
    });
  REQ_RE.lastIndex = 0;
  return es5.replace(REQ_RE, (whole, q, spec) => {
    if (spec.charAt(0) === '@') return 'requireModule(' + q + spec + q + ')';
    if (spec.charAt(0) === '.') {
      const id = idOf[spec];
      if (id !== undefined) return '__webpack_require__(' + id + ')';
    }
    return whole;
  });
}
// 每个模块（含 helper 模块）尾注 requireModule（对齐官方 parseRequireModule）
const REQUIRE_MODULE_TAIL =
  '\nfunction requireModule(moduleName){return requireNative(moduleName.slice(1))}';
function appendRequireModule(es5) {
  return es5 + REQUIRE_MODULE_TAIL;
}

// ---------- helper 模块（transform-runtime 抽出的独立模块） ----------
const HELPER_INTEROP =
  '"use strict";function n(t){return t&&t.__esModule?t:{default:t}}module.exports=n;';
const HELPER_ARROW =
  '"use strict";function n(t,e){if(t!==e){throw new TypeError("Cannot instantiate an arrow function")}}module.exports=n;';

// ---------- 组装 ----------
// webpack 数组/对象选择启发式：id 范围 ≤ 3 倍模块数为就近（数组带洞），否则对象
function assemble(modules, entryId) {
  const count = modules.length;
  const maxId = count - 1;
  let container;
  if (maxId + 1 <= 3 * count) {
    container = '[' + modules.map(m => m === null ? '' : 'function(module, exports, __webpack_require__){' + m + '}').join(',') + ']';
  } else {
    const parts = [];
    for (let id = 0; id < count; id++) {
      parts.push(id + ':function(module, exports, __webpack_require__){' + modules[id] + '}');
    }
    container = '{' + parts.join(',') + '}';
  }
  return RUNTIME.replace('__ENTRY__', String(entryId)).replace('__MODULES__', container);
}

/**
 * 页面 bundle
 * @param scriptSource 页面 js 源码（ES6）
 * @param resolveDep   (spec) => {source, resolve, path} | null，相对 spec 解析器
 * @param renderFn     render 函数源码字符串：function (t) { var e = t || this; return ... }
 * @param styleSheet   styleSheet 对象源码字符串：{classSelectors: {...}} 或 {}
 * @returns {js: string, moduleIds: {script, render, styleSheet, entry}}
 */
function bundlePage({ scriptSource, resolveDep, renderFn, styleSheet }) {
  // 布局：0/1 = helper，2 = entry，3 = render，4 = style，5 = script，6+ = deps（DFS）
  const modules = [
    HELPER_INTEROP + REQUIRE_MODULE_TAIL,
    HELPER_ARROW + REQUIRE_MODULE_TAIL,
    null, null, null, null,
  ];
  const renderId = 3, styleId = 4, scriptId = 5;
  const pathToId = new Map();

  function registerDep(spec, source, resolve, key) {
    const hit = pathToId.get(key);
    if (hit !== undefined) return hit;
    const id = modules.length;
    modules.push(null);
    pathToId.set(key, id);
    let es5 = babelToEs5(source);
    const idOf = {};
    for (const s of relativeSpecs(es5)) {
      const res = resolve(s);
      if (!res) continue;
      idOf[s] = registerDep(s, res.source, res.resolve, res.path);
    }
    es5 = rewriteRequires(es5, idOf);
    es5 = appendRequireModule(es5);
    modules[id] = es5;
    return id;
  }

  let scriptEs5 = babelToEs5(scriptSource);
  const idOf = {};
  for (const spec of relativeSpecs(scriptEs5)) {
    const res = resolveDep(spec);
    if (!res) continue;
    idOf[spec] = registerDep(spec, res.source, res.resolve, res.path);
  }
  scriptEs5 = rewriteRequires(scriptEs5, idOf);
  scriptEs5 = appendRequireModule(scriptEs5);

  modules[renderId] = 'module.exports = ' + renderFn;
  modules[styleId] = 'module.exports = ' + styleSheet;
  modules[scriptId] = scriptEs5;
  modules[2] =
    'var n = __webpack_require__(' + renderId + ');' +
    'var r = __webpack_require__(' + styleId + ');' +
    'var o = __webpack_require__(' + scriptId + ');' +
    'var c = o;' +
    'if (o.__esModule) { c = o.default; }' +
    'c.styleSheet = r;' +
    'c.render = n;' +
    'module.exports = new ViewModel(c)';

  return {
    js: assemble(modules, 2),
    moduleIds: { script: scriptId, render: renderId, styleSheet: styleId, entry: 2 },
  };
}

/**
 * app bundle（对齐官方形态：数组带洞 [,,entry(2),script(3),manifest(4)]）
 * manifest 模块用 SDK 占位串 {"manifest.json":"content"}（与官方一致）
 * @param scriptSource app.js 源码
 */
function bundleApp(scriptSource) {
  const modules = [null, null, null, null, null];
  const scriptId = 3, manifestId = 4;
  let es5 = babelToEs5(scriptSource);
  es5 = rewriteRequires(es5, {});
  es5 = es5.replace(/\s*$/, '') +
    ';\n(exports["default"] || module.exports).manifest = __webpack_require__(' + manifestId + ');';
  es5 = appendRequireModule(es5);
  modules[scriptId] = es5;
  modules[manifestId] = "module.exports = JSON.parse('{\"manifest.json\":\"content\"}')";
  modules[2] =
    'var r = __webpack_require__(' + scriptId + ');' +
    'var o = r;' +
    'if (r.__esModule) { o = r.default; }' +
    'module.exports = new ViewModel(o)';
  return { js: assemble(modules, 2), moduleIds: { script: scriptId, manifest: manifestId, entry: 2 } };
}

module.exports = { bundlePage, bundleApp, babelToEs5, initBabel, getBabel };