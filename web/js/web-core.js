/* Web 版 GT2 lite 编译器——浏览器主管线
 * 复用 CompilerCore（单一来源 compiler/linux/lib）+ 内存文件树，
 * 产出与 Linux 版一致的 HAP 条目列表（不含 .bc：真机需 jerry v24 快照，见 UI 提示）。
 */
(function (g) {
  'use strict';

  var TC = typeof TextEncoder !== 'undefined' ? TextEncoder : null;
  var TD = typeof TextDecoder !== 'undefined' ? TextDecoder : null;
  function enc(s) { return (TC ? new TC() : null).encode(s); }
  function dec(b) { return (TD ? new TD() : null).decode(b); }

  var IMAGE_CONVERT_RESULT = '{exitCode:0}';

  // ---------- 路径（posix） ----------
  function normPath(p) {
    p = String(p).replace(/\\/g, '/');
    p = p.replace(/^\/+/, '');
    return p;
  }
  function dirname(p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function basename(p) { var i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); }
  function join() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var s = String(arguments[i] || '');
      if (s) parts.push(s);
    }
    if (!parts.length) return '';
    return normPath(parts.join('/'));
  }
  function resolvePath(base, spec) {
    // 简单 posix 相对解析（. ..），不支持裸不以 . 开头
    var segs = (base ? normPath(base) : '').split('/').filter(Boolean);
    var parts = normPath(spec).split('/');
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i];
      if (s === '.' || s === '') continue;
      if (s === '..') { segs.pop(); continue; }
      segs.push(s);
    }
    return segs.join('/');
  }

  // ---------- 内存文件树 ----------
  function buildMem(entries) {
    var mem = new Map();
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var p = normPath(e.path);
      if (p === '') continue;
      var d = e.data;
      if (typeof d === 'string') d = enc(d);
      else if (!(d instanceof Uint8Array)) d = new Uint8Array(d || []);
      mem.set(p, d);
    }
    return mem;
  }
  function memExists(mem, p) { return mem.has(p); }
  function memIsDir(mem, p) {
    if (!p) return true;
    var pre = p + '/';
    var it = mem.keys();
    for (var k of it) { if (k.indexOf(pre) === 0) return true; }
    return false;
  }
  function memText(mem, p) {
    var d = mem.get(p);
    if (!d) return '';
    return typeof d === 'string' ? d : dec(d);
  }
  function memBytes(mem, p) { return mem.get(p); }
  function listDir(mem, prefix) {
    prefix = normPath(prefix || '');
    var pre = prefix ? prefix + '/' : '';
    var names = new Set();
    var it = mem.keys();
    for (var k of it) {
      if (prefix && k.indexOf(pre) !== 0) continue;
      if (!prefix && k.indexOf('/') >= 0) continue;
      var rest = k.slice(pre.length);
      var i = rest.indexOf('/');
      names.add(i < 0 ? rest : rest.slice(0, i));
    }
    return Array.from(names).sort();
  }

  // ---------- 相对依赖 / css @import 解析（对照 linux build.js） ----------
  function makeResolverWeb(fromDir, appDir, mem) {
    return function resolve(spec) {
      if (spec.charAt(0) !== '.') return null;
      var cands = [resolvePath(fromDir, spec), resolvePath(appDir, spec)];
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        if (memExists(mem, c)) {
          return {
            source: memText(mem, c),
            resolve: makeResolverWeb(dirname(c), appDir, mem),
            path: c,
          };
        }
      }
      return null;
    };
  }
  function makeCssResolverWeb(baseDirs, mem) {
    return function (spec) {
      for (var i = 0; i < baseDirs.length; i++) {
        var c = resolvePath(baseDirs[i], spec);
        if (memExists(mem, c)) return memText(mem, c);
      }
      return null;
    };
  }

  // ---------- resources.index（Uint8Array 版，对照 linux lib/resources.js 逐字节） ----------
  function w16(v) { var b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v & 0xffff, true); return b; }
  function w32(v) { var b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; }
  function concatBytes(arr) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += arr[i].length;
    var o = new Uint8Array(t); var p = 0;
    for (var j = 0; j < arr.length; j++) { o.set(arr[j], p); p += arr[j].length; }
    return o;
  }
  function resolveStringLabel(labelRef, stringJson) {
    var skey = labelRef && labelRef.indexOf('$string:') === 0 ? labelRef.slice(8) : 'appName';
    var sval = labelRef || '';
    if (stringJson && Array.isArray(stringJson.string)) {
      for (var i = 0; i < stringJson.string.length; i++) {
        var it = stringJson.string[i];
        if (it.name === skey) { if (it.value !== undefined) sval = it.value; break; }
      }
    }
    return { key: skey, value: sval };
  }
  function buildResourcesIndexWeb(labelRef, stringJson, mediaStems) {
    var records = [];
    var r = resolveStringLabel(labelRef, stringJson);
    var v = enc(r.value), k = enc(r.key);
    var sbody = new Uint8Array(4 + 4 + 2 + v.length + 1 + 2 + k.length + 1);
    var dv = new DataView(sbody.buffer);
    dv.setUint32(0, 9, true);
    dv.setUint32(4, 0x01000000, true);
    dv.setUint16(8, v.length + 1, true);
    sbody.set(v, 10);
    sbody[10 + v.length] = 0;
    var kl = 10 + v.length + 1;
    dv.setUint16(kl, k.length + 1, true);
    sbody.set(k, kl + 2);
    sbody[kl + 2 + k.length] = 0;
    records.push({ id: 0x01000000, bytes: concatBytes([w32(sbody.length), sbody]) });

    var rid = 0x01000001;
    for (var m = 0; m < mediaStems.length; m++) {
      var stem = mediaStems[m];
      var p = enc('entry/resources/base/media/' + stem + '.png');
      var n = enc(stem);
      var body = new Uint8Array(4 + 4 + 2 + p.length + 1 + 2 + n.length + 1);
      var bv = new DataView(body.buffer);
      bv.setUint32(0, 0x13, true);
      bv.setUint32(4, rid, true);
      bv.setUint16(8, p.length + 1, true);
      body.set(p, 10);
      body[10 + p.length] = 0;
      var nl = 10 + p.length + 1;
      bv.setUint16(nl, n.length + 1, true);
      body.set(n, nl + 2);
      body[nl + 2 + n.length] = 0;
      records.push({ id: rid, bytes: concatBytes([w32(body.length), body]) });
      rid += 1;
    }

    var REC_BASE = 0x9C + 8 * records.length;
    var cur = REC_BASE;
    var offs = records.map(function (x) { var o = cur; cur += x.bytes.length; return o; });
    var entries = concatBytes(records.map(function (x, i) { return concatBytes([w32(x.id), w32(offs[i])]); }));

    var restool = new Uint8Array(0x80);
    var rt = enc('Restool 1.022');
    restool.set(rt, 0);

    var payload = concatBytes([enc('KEYS'), w32(0x94), w32(0)]);
    payload = concatBytes([payload, enc('IDSS'), w32(records.length), entries,
      concatBytes(records.map(function (x) { return x.bytes; }))]);

    return concatBytes([restool, w32(0x80 + 4 + 4 + payload.length), w32(1), payload]);
  }

  // ---------- config 规范化 + pack.info 工具（对照 linux lib/hap.js，纯 JS；仅调试/读旧包用） ----------
  function normalizeConfig(c) {
    var app = c.app = c.app || {};
    var av = app.apiVersion;
    var compat = (av && typeof av === 'object') ? (av.compatible !== undefined ? av.compatible : 3)
      : (typeof av === 'number' ? av : 3);
    var target = (av && typeof av === 'object') ? (av.target !== undefined ? av.target : 6) : 6;
    app.apiVersion = { compatible: Number(compat), releaseType: 'Release', target: Number(target) };
    if (!(c.deviceConfig && typeof c.deviceConfig === 'object' && !Array.isArray(c.deviceConfig))) {
      c.deviceConfig = {};
    }
    var mod = c.module = c.module || {};
    delete mod.moduleName;
    if (!(mod.distro && typeof mod.distro === 'object')) {
      mod.distro = { moduleType: 'entry', deliveryWithInstall: true, moduleName: 'entry' };
    }
    var abilities = mod.abilities;
    if (Array.isArray(abilities) && abilities[0]) {
      if (abilities[0].iconId === undefined) abilities[0].iconId = 16777217;
      if (abilities[0].labelId === undefined) abilities[0].labelId = 16777216;
      if (abilities[0].homeAbility === undefined) abilities[0].homeAbility = false;
    }
    return c;
  }
  function buildPackInfo(cfg) {
    var app = cfg.app || {};
    var mod = cfg.module || {};
    var ab = (mod.abilities || [])[0] || {};
    return {
      summary: {
        app: {
          bundleName: app.bundleName,
          version: { code: (app.version || {}).code, name: (app.version || {}).name },
        },
        modules: [{
          deviceType: mod.deviceType,
          abilities: [{ name: ab.name, label: ab.label }],
          distro: mod.distro,
          apiVersion: app.apiVersion,
        }],
      },
      packages: [{
        deviceType: mod.deviceType,
        moduleType: (mod.distro || {}).moduleType,
        deliveryWithInstall: (mod.distro || {}).deliveryWithInstall,
        name: 'entry-release-lite',
      }],
    };
  }

  // ---------- 主编译：文件条目 -> HAP 条目（纯同步） ----------
  /**
   * @param {Array<{path:string,data:Uint8Array|string|Array}>} entries 工程文件
   * @returns {{ok:boolean, entries:Array<{path,data:Uint8Array}>, pages:string[], warnings:string[], error?:string}}
   */
  function compileProject(entries) {
    var C = g.CompilerCore;
    var mem = buildMem(entries);
    // 定位 config.json：优先 entry/src/main/config.json
    var cfgRel = null;
    var it = mem.keys();
    for (var k of it) {
      if (basename(k) !== 'config.json') continue;
      if (k.indexOf('/entry/src/main/') >= 0 || k === 'entry/src/main/config.json') { cfgRel = k; break; }
      if (!cfgRel) cfgRel = k;
    }
    if (!cfgRel) return fail('找不到 config.json（工程需含 entry/src/main/config.json）');

    var config;
    try { config = JSON.parse(memText(mem, cfgRel)); }
    catch (e) { return fail('config.json 解析失败：' + e.message); }

    var mainDir = dirname(cfgRel);                       // entry/src/main
    var jsRelDir = join(mainDir, 'js/default');          // 源码 js 目录
    var projMedia = join(mainDir, 'resources/base/media');
    var stringJsonRel = join(mainDir, 'resources/base/element/string.json');

    var warnings = [];
    var pageList = (config.module && config.module.js && config.module.js[0] && config.module.js[0].pages) || [];

    // ---- build 产物 ----
    var out = new Map();
    var mf = C.manifest.generateManifest(config, pageList);
    out.set('manifest.json', C.manifest.stringify(mf));

    var appJsRel = join(jsRelDir, 'app.js');
    if (memExists(mem, appJsRel)) {
      out.set('app.js', C.bundle.bundleApp(memText(mem, appJsRel)).js);
    }

    var pages = [];
    for (var pi = 0; pi < pageList.length; pi++) {
      var page = pageList[pi];                          // pages/xxx/xxx
      var name = basename(page);
      var dir = join(jsRelDir, 'pages', name);
      var jsRel = join(dir, name + '.js');
      if (!memExists(mem, jsRel)) continue;
      var hmlRel = join(dir, name + '.hml');
      var cssRel = join(dir, name + '.css');
      var renderFn;
      try {
        renderFn = C.render.compileTemplate(memExists(mem, hmlRel) ? memText(mem, hmlRel) : '<div></div>');
      } catch (e) { return fail('HML 编译失败 ' + jsRel + '：' + e.message); }
      var styleSheet;
      try {
        styleSheet = JSON.stringify(C.style.compileCss(
          memExists(mem, cssRel) ? memText(mem, cssRel) : '',
          makeCssResolverWeb([dir, jsRelDir], mem)));
      } catch (e) { return fail('CSS 编译失败 ' + cssRel + '：' + e.message); }
      var b;
      try {
        b = C.bundle.bundlePage({
          scriptSource: memText(mem, jsRel),
          resolveDep: makeResolverWeb(dir, jsRelDir, mem),
          renderFn: renderFn,
          styleSheet: styleSheet,
        });
      } catch (e) { return fail('JS bundle 失败 ' + jsRel + '：' + e.message); }
      out.set(page + '.js', b.js);
      pages.push(page);
    }

    var commonRel = join(jsRelDir, 'common');
    if (memIsDir(mem, commonRel)) {
      var commonFiles = listDir(mem, commonRel).filter(function (f) { return /\.png$/i.test(f); });
      for (var ci = 0; ci < commonFiles.length; ci++) {
        var f = commonFiles[ci];
        var pngBytes = memBytes(mem, join(commonRel, f));
        try { out.set('common/' + f.replace(/\.png$/i, '.bin'), C.image.pngToBin(new Uint8Array(pngBytes))); }
        catch (e) { warnings.push('png→bin 失败 ' + f + '：' + e.message); }
      }
    }
    out.set('image_convert_result.txt', IMAGE_CONVERT_RESULT);

    // ---- HAP 组装 ----
    var cfg = normalizeConfig(JSON.parse(JSON.stringify(config)));
    var mediaPngs = [];
    if (memIsDir(mem, projMedia)) {
      mediaPngs = listDir(mem, projMedia).filter(function (f) { return /\.png$/i.test(f); });
    }
    mediaPngs.sort(function (a, b) {
      return a === 'icon.png' ? -1 : b === 'icon.png' ? 1 : a < b ? -1 : 1;
    });
    var mediaStems = mediaPngs.map(function (f) { return f.slice(0, -4); });

    var sjson = memExists(mem, stringJsonRel) ? (function () { try { return JSON.parse(memText(mem, stringJsonRel)); } catch (e) { return null; } })() : null;
    var labelRef = ((cfg.module.abilities || [])[0] || {}).label || '';
    var idx = buildResourcesIndexWeb(labelRef, sjson, mediaStems);

    var hap = new Map();
    // 1) assets/js/default = 源码树 + build 覆盖（实测约束：真机拒装含 .hml/.css，
    //    它们已编译进 JS，这里剥除不装入 HAP）
    var prefix = jsRelDir + '/';
    var kit = mem.keys();
    for (var k2 of kit) {
      if (k2.indexOf(prefix) === 0) {
        if (/\.(hml|css)$/.test(k2)) continue;
        hap.set('assets/js/default/' + k2.slice(prefix.length), mem.get(k2));
      }
    }
    var outIt = out.keys();
    for (var oKey of outIt) hap.set('assets/js/default/' + oKey, toBytes(out.get(oKey)));
    // 2) config.json
    hap.set('config.json', C.manifest.stringify(cfg));
    // 3) resources.index + 媒体
    hap.set('assets/entry/resources.index', idx);
    for (var ms = 0; ms < mediaStems.length; ms++) {
      var st = mediaStems[ms];
      hap.set('assets/entry/resources/base/media/' + st + '.png', mem.get(join(projMedia, st + '.png')));
      try {
        var binData = C.image.pngToBin(new Uint8Array(mem.get(join(projMedia, st + '.png'))));
        hap.set('assets/entry/resources/base/media/' + st + '.bin', binData);
      } catch (e) { return fail('媒体 PNG 编译失败 ' + st + '：' + e.message); }
    }
    ['attributes', 'constants', 'contents', 'nodes'].forEach(function (kf) {
      hap.set('assets/entry/resources/base/media/' + kf + '.key', new Uint8Array([0]));
    });
    // 4) 不再写 pack.info——实测约束：真机拒绝安装含 pack.info 的包（devdemo 103 诊断确认）。
    //    SDK 真机构建也不安装 pack.info。buildPackInfo 仅在需读旧包时供工具使用。

    // 只暴露 HML/CSS 已编译（.js bundle 可执行）；.bc 需要 jerry v24（Web 暂缺）
    var outHap = [];
    var hit = hap.keys();
    for (var p of hit) outHap.push({ path: p, data: hap.get(p) });
    outHap.sort(function (a, b) { return a.path < b.path ? -1 : 1; });

    return {
      ok: true,
      entries: outHap,
      pages: pages,
      bundleName: (config.app || {}).bundleName || '',
      version: ((config.app || {}).version || {}).name || '',
      warnings: warnings,
      summary: {
        pages: pages.length,
        files: outHap.length,
        jsSize: outHap.filter(function (e) { return /\.js$/.test(e.path); })
          .reduce(function (s, e) { return s + e.data.length; }, 0),
        hasBc: false,
      },
    };
  }
  function toBytes(d) {
    if (typeof d === 'string') return enc(d);
    if (d instanceof Uint8Array) return d;
    return new Uint8Array(d || []);
  }
  function fail(msg) { return { ok: false, error: msg, entries: [], pages: [], warnings: [] }; }

  // ---------- zip 装载 ----------
  async function loadZip(arrayBuffer, log) {
    if (!g.JSZip) throw new Error('jszip 未加载');
    var zip = await g.JSZip.loadAsync(arrayBuffer);
    var jobs = [];
    zip.forEach(function (rel, entry) {
      if (entry.dir) return;
      jobs.push({ rel: rel, p: entry.async('uint8array') });
    });
    var rows = await Promise.all(jobs.map(function (j) { return j.p.then(function (d) { return { path: j.rel, data: new Uint8Array(d) }; }); }));
    return rows;
  }

  // ---------- HAP zip 打包 ----------
  async function buildZip(entries, opts) {
    if (!g.JSZip) throw new Error('jszip 未加载');
    var zip = new g.JSZip();
    for (var i = 0; i < entries.length; i++) {
      zip.file(entries[i].path, entries[i].data);
    }
    var type = (opts && opts.nodeBuffer) ? 'nodebuffer' : 'blob';
    var blob = await zip.generateAsync({ type: type, compression: 'DEFLATE' });
    return blob;
  }

  // ---------- .bc 生成（真机字节码，v24） ----------
  /** 校验 JRRY 魔数 + 版本 24；不合法直接 throw */
  function validateBc(bc, name) {
    if (!(bc instanceof Uint8Array) || bc.length < 8 ||
        bc[0] !== 0x4a || bc[1] !== 0x52 || bc[2] !== 0x52 || bc[3] !== 0x59) {
      throw new Error('.bc 缺 JRRY 魔数（' + name + '）');
    }
    var ver = new DataView(bc.buffer, bc.byteOffset, 8).getUint32(4, true);
    if (ver !== 24) throw new Error('.bc 版本为 ' + ver + '，必须是 v24（' + name + '）');
    return bc;
  }

  /**
   * 对已编译 HAP 条目补 .bc：只快照 bundle 产物（app.js + 页面，排除 common 源码）。
   * @param {Array<{path,data}>} entries  compileProject 返回的条目
   * @param {function(string):(Uint8Array|ArrayBuffer|Array)} snapshotFn 传 page 源码，返回 .bc 字节
   * @returns {Promise<{entries:Array, snapshots:string[], hasBc:true, error?:string}>}
   */
  async function generateBc(entries, snapshotFn, log) {
    var targets = entries.filter(function (e) {
      return /^assets\/js\/default\/.+\.js$/.test(e.path) && e.path.indexOf('/common/') < 0;
    });
    if (!targets.length) return { entries: entries, snapshots: [], hasBc: true, error: '无 bundle.js 可快照' };
    var out = entries.slice();
    var done = [];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var src = typeof t.data === 'string' ? t.data : dec(t.data);
      var bytes;
      try {
        if (typeof snapshotFn !== 'function') throw new Error('snapshot 函数未提供（wasm 未加载/本地服务不可达）');
        bytes = validateBc(toBytes(await snapshotFn(src)), t.path);
      } catch (e) {
        if (log) log('字节码失败 ' + t.path + '：' + e.message, '');
        continue;
      }
      out.push({ path: t.path.replace(/\.js$/, '.bc'), data: bytes });
      done.push(t.path.replace(/\.js$/, '.bc'));
    }
    out.sort(function (a, b) { return a.path < b.path ? -1 : 1; });
    return { entries: out, snapshots: done, hasBc: true, error: done.length ? null : '全部快照失败' };
  }

  g.WebCompiler = {
    compileProject: compileProject,
    generateBc: generateBc,
    validateBc: validateBc,
    loadZip: loadZip,
    buildZip: buildZip,
    buildResourcesIndexWeb: buildResourcesIndexWeb,
    normalizeConfig: normalizeConfig,
    buildPackInfo: buildPackInfo,
    normPath: normPath,
    join: join,
    dirname: dirname,
    basename: basename,
    version: '1.0.0',
  };
})(typeof window !== 'undefined' ? window : globalThis);
