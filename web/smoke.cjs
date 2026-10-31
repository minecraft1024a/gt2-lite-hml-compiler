"use strict";
/**
 * Web 编译器冒烟验收（node 模拟浏览器环境）：
 *  - 加载 vendor + compiler-core + web-core
 *  - 从磁盘读 reader 工程源码为内存文件树
 *  - compileProject 产出 HAP 条目
 *  - 与 Linux 版 build 产物（/tmp/opencode/reader-out/build）逐字节对比 .js / resources.index / config.json
 *    （pack.info 已按真机约束剥除，不对比）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ARGS = process.argv.slice(2);
const readerProj = ARGS[0] || '/home/yishan/gt2-hap-sideload/our app/自写阅读器/reader';
const linuxBuild = ARGS[1] || '/tmp/opencode/reader-out/build';
const linuxHap = ARGS[2] || '/tmp/opencode/reader-out/entry-release-lite.hap';

// 1) vendor 注入 globalThis
globalThis.Babel = require('./vendor/babel.min.js');
globalThis.pako = require('./vendor/pako.min.js');
globalThis.JSZip = require('./vendor/jszip.min.js');

// 2) 加载核心 + 管线
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'js', 'compiler-core.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'js', 'web-core.js'), 'utf8'));
const WC = globalThis.WebCompiler;

// 3) 工程源码 -> 内存条目
const srcRoot = path.join(readerProj, 'entry/src/main');
function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, path.posix.join(base, e.name), out);
    else out.push({ path: path.posix.join(base, e.name), data: fs.readFileSync(abs) });
  }
  return out;
}
const files = walk(srcRoot, '', []);
console.log('工程文件数:', files.length);

// 4) 编译
const res = WC.compileProject(files);
if (!res.ok) { console.error('编译失败:', res.error); process.exit(1); }
console.log('页面:', res.pages.join(', '));
console.log('HAP 条目:', res.summary.files, 'jsSize:', res.summary.jsSize);
if (res.warnings.length) console.log('警告:', res.warnings.join(' | '));

let pass = 0, fail = 0;
function eq(name, mineB, refB) {
  const a = Buffer.from(mineB), b = Buffer.from(refB);
  if (a.equals(b)) { pass++; }
  else {
    fail++;
    // 前 64 字节见差异
    let diff = -1;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) { diff = i; break; }
    console.error(`[XX] ${name} 字节不一致 mine=${a.length} ref=${b.length} 首差@${diff}`);
  }
}

// 5) 与 Linux build 产物对比
const hapMap = new Map(res.entries.map((e) => [e.path, e.data]));
const checks = [
  ['assets/js/default/app.js', path.join(linuxBuild, 'app.js')],
  ['assets/js/default/pages/index/index.js', path.join(linuxBuild, 'pages/index/index.js')],
  ['assets/js/default/pages/read/read.js', path.join(linuxBuild, 'pages/read/read.js')],
  ['assets/js/default/manifest.json', path.join(linuxBuild, 'manifest.json')],
];
for (const [hapRel, refAbs] of checks) {
  if (fs.existsSync(refAbs)) eq('比较 ' + hapRel, hapMap.get(hapRel) || '', fs.readFileSync(refAbs));
  else eq('比较 ' + hapRel + ' (ref 缺失)', hapMap.get(hapRel) || '', '');
}

// 6) 解 Linux HAP 对比 config/resources/media（pack.info 已按真机约束剥除，不对比）
(async () => {
  const JSZip = globalThis.JSZip;
  const zref = await JSZip.loadAsync(fs.readFileSync(linuxHap));
  for (const rel of ['config.json', 'assets/entry/resources.index',
    'assets/entry/resources/base/media/icon.png',
    'assets/entry/resources/base/media/nodes.key']) {
    if (zref.file(rel) && hapMap.has(rel)) eq('比较 ' + rel, hapMap.get(rel), await zref.file(rel).async('nodebuffer'));
    else { fail++; console.error('[--] 对比目标缺失: ' + rel); }
  }
  // zip 打包闭环
  const blob = await WC.buildZip(res.entries, { nodeBuffer: true });
  const z2 = await JSZip.loadAsync(Buffer.from(blob));
  const zcount = Object.keys(z2.files).filter((k) => !z2.files[k].dir).length;
  const mineSize = Buffer.isBuffer(blob) ? blob.length : blob.size;
  const refSize = fs.statSync(linuxHap).size;
  console.log(`zip 闭环 OK（条目=${zcount}）`);
  console.log(`\n===== ${pass} 通过, ${fail} 失败 (zip: mine=${mineSize}B ref=${refSize}B) =====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });