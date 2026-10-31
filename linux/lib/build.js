"use strict";
/**
 * GT2 lite 编译器主编排：源码工程 -> build 产物目录 -> HAP 文件
 * 确切对齐 build-lite-hap.sh：webpack lite 构建步骤由本编译器（bundle/png/jerry）替代，
 * config/config 规范化 / resources.index / zip 由 hap/resources 库替代。
 * （pack.info 与 .hml/.css 按真机实测约束剥除，不再写入 HAP。）
 */
const fs = require('fs');
const path = require('path');

const hml = require('./hml');
const css = require('./css');
const bundle = require('./bundle');
const png2bin = require('./png2bin');
const jerry = require('./jerry');
const manifestLib = require('./manifest');
const resourcesLib = require('./resources');
const hapLib = require('./hap');

const IMAGE_CONVERT_RESULT = '{exitCode:0}'; // 对齐 loader 图像插件产物（12B）

/** 相对依赖解析：先页面目录，其次 app 目录 */
function makeResolver(fromDir, appDir) {
  return function resolve(spec) {
    if (spec.charAt(0) !== '.') return null;
    const cands = [path.resolve(fromDir, spec), path.resolve(appDir, spec)];
    for (const c of cands) {
      if (fs.existsSync(c)) {
        return { source: fs.readFileSync(c, 'utf8'), resolve: makeResolver(path.dirname(c), appDir), path: c };
      }
    }
    return null;
  };
}

/** CSS @import 解析：返回源码字符串 */
function makeCssResolver(baseDirs) {
  return function (spec) {
    for (const base of baseDirs) {
      const c = path.resolve(base, spec);
      if (fs.existsSync(c)) return fs.readFileSync(c, 'utf8');
    }
    return null;
  };
}

/**
 * 编译整个工程 -> 返回文件映射 {relpath: Buffer|string}（build 产物，含 .bc）
 * @param {object} opts { projectRoot, config (解析后), manifest (可选), jerryBin }
 */
function compileBuild({ projectRoot, config, manifest, jerryBin }) {
  const srcJs = path.join(projectRoot, 'entry/src/main/js/default');
  if (!fs.existsSync(srcJs)) throw new Error('找不到 ' + srcJs);

  const pageList = (config.module.js && config.module.js[0] && config.module.js[0].pages) || [];
  const mf = manifest || manifestLib.generateManifest(config);
  const out = {}; // relpath -> Buffer|string

  // 0) manifest.json（python json.dump 不带尾部换行）
  out['manifest.json'] = manifestLib.stringify(mf);

  // 1) app.js bundle
  const appJsPath = path.join(srcJs, 'app.js');
  if (fs.existsSync(appJsPath)) {
    const { js } = bundle.bundleApp(fs.readFileSync(appJsPath, 'utf8'));
    out['app.js'] = js;
  }

  // 2) 页面 bundle
  for (const page of pageList) {
    const rel = path.relative(srcJs, path.join(srcJs, page)); // pages/xxx/xxx
    const name = page.split('/').pop();
    const dir = path.join(srcJs, 'pages', name);
    const hmlPath = path.join(dir, name + '.hml');
    const cssPath = path.join(dir, name + '.css');
    const jsPath = path.join(dir, name + '.js');
    if (!fs.existsSync(jsPath)) continue;

    const renderFn = hml.compileTemplate(
      fs.existsSync(hmlPath) ? fs.readFileSync(hmlPath, 'utf8') : '<div></div>');
    const styleSheet = JSON.stringify(css.compileCss(
      fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '',
      makeCssResolver([dir, srcJs])));
    const { js } = bundle.bundlePage({
      scriptSource: fs.readFileSync(jsPath, 'utf8'),
      resolveDep: makeResolver(dir, srcJs),
      renderFn,
      styleSheet,
    });
    out[rel + '.js'] = js;
  }

  // 3) common/*.png -> common/*.bin
  const commonDir = path.join(srcJs, 'common');
  if (fs.existsSync(commonDir)) {
    for (const f of fs.readdirSync(commonDir)) {
      if (!/\.png$/i.test(f)) continue;
      const bin = png2bin.pngToBin(fs.readFileSync(path.join(commonDir, f)));
      out['common/' + f.replace(/\.png$/i, '.bin')] = Buffer.from(bin);
    }
  }

  // 4) 图像转换结果占位（loader 插件固定产物）
  out['image_convert_result.txt'] = IMAGE_CONVERT_RESULT;

  // 5) .bc：app.js + 页面 js（v24 校验）
  const bcTargets = Object.keys(out).filter((p) => p.endsWith('.js'));
  for (const jsRel of bcTargets) {
    const jsPath = path.join((fs.mkdtempSync(path.join(require('os').tmpdir(), 'gt2jb-'))), path.basename(jsRel));
    fs.writeFileSync(jsPath, out[jsRel]);
    const bcPath = jsPath.replace(/\.js$/, '.bc');
    jerry.snapshot(jsPath, bcPath, jerryBin);
    out[jsRel.replace(/\.js$/, '.bc')] = fs.readFileSync(bcPath);
    fs.unlinkSync(jsPath);
    fs.rmSync(path.dirname(jsPath), { recursive: true, force: true });
  }

  return out;
}

/**
 * 组装 .hap 文件（音频 build 产物 + 源码目录 + resources），返回 zip Buffer
 * 注意：默认剥掉 .hml/.css、不写 pack.info（真机拒装的实测约束）。
 * @param {object} opts { projectRoot, config, buildOut = compileBuild(...) }
 */
async function assembleHap({ projectRoot, config, buildOut }) {
  const work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gt2hap-'));
  const srcJs = path.join(projectRoot, 'entry/src/main/js/default');
  const hapDir = path.join(work, 'hap');

  try {
    // 部署 build 产物到源码目录（覆盖同名 .js/.bc/txt，新增 .bc/manifest）
    const inMem = { ...buildOut };
    const deploy = async () => {
      // 为避免覆盖源码，先复制 src 到 hapDir，再用 buildOut 覆盖
      fs.mkdirSync(path.join(hapDir, 'assets/js'), { recursive: true });
      fs.cpSync(srcJs, path.join(hapDir, 'assets/js/default'), { recursive: true });
      for (const [rel, data] of Object.entries(inMem)) {
        const dst = path.join(hapDir, 'assets/js/default', rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, data);
      }
    };
    await deploy();

    // config.json（规范化）写 hapDir
    const cfg = hapLib.normalizeConfig(JSON.parse(JSON.stringify(config)));
    fs.writeFileSync(path.join(hapDir, 'config.json'), manifestLib.stringify(cfg));

    // resources.index + 媒体目录 + .key
    const projMedia = path.join(projectRoot, 'entry/src/main/resources/base/media');
    const pngs = fs.existsSync(projMedia)
      ? fs.readdirSync(projMedia).filter((f) => f.endsWith('.png'))
      : [];
    pngs.sort((a, b) => (a === 'icon.png' ? -1 : b === 'icon.png' ? 1 : a < b ? -1 : 1));
    const mediaStems = pngs.map((f) => f.slice(0, -4));

    const sjsonPath = path.join(projectRoot, 'entry/src/main/resources/base/element/string.json');
    const stringJson = fs.existsSync(sjsonPath) ? JSON.parse(fs.readFileSync(sjsonPath, 'utf8')) : null;
    const labelRef = (cfg.module.abilities || [])[0].label || '';

    const idx = resourcesLib.buildResourcesIndex(labelRef, stringJson, mediaStems);
    const entryDir = path.join(hapDir, 'assets/entry');
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, 'resources.index'), idx);

    const mediaDir = path.join(entryDir, 'resources/base/media');
    fs.mkdirSync(mediaDir, { recursive: true });
    for (const stem of mediaStems) {
      const pngPath = path.join(projMedia, stem + '.png');
      if (fs.existsSync(pngPath)) fs.copyFileSync(pngPath, path.join(mediaDir, stem + '.png'));
      // Resource images can differ from common/ images with the same name.
      // Generate each binary from its own PNG, including icon_small.png.
      fs.writeFileSync(path.join(mediaDir, stem + '.bin'),
        Buffer.from(png2bin.pngToBin(fs.readFileSync(pngPath))));
    }
    for (const kf of ['attributes', 'constants', 'contents', 'nodes']) {
      fs.writeFileSync(path.join(mediaDir, kf + '.key'), Buffer.from([0]));
    }

    // 实测约束（devdemo 103 诊断，2026-10-31 真机验证）：bin 装入的 HAP
    // 不得含 pack.info / .hml / .css —— SDK 真机构建把样式编译进 JS、不安装
    // pack.info；残留这三类文件会让手表/手机端拒绝安装（状态 103）。
    // 故默认不写 pack.info，并剥掉源码 .hml/.css。
    const prune = (root) => {
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        const p = path.join(root, e.name);
        if (e.isDirectory()) prune(p);
        else if (e.name.endsWith('.hml') || e.name.endsWith('.css')) fs.rmSync(p);
      }
    };
    prune(path.join(hapDir, 'assets/js/default'));

    return await hapLib.packHap(hapDir);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { compileBuild, assembleHap, makeResolver, IMAGE_CONVERT_RESULT, normalizeConfig: hapLib.normalizeConfig };
