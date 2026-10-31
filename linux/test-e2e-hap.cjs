"use strict";
// E2E 验收：本编译器产物 vs 真 SDK 黄金参考（逐文件对比）
const fs = require('fs');
const path = require('path');
const build = require('./lib/build');
const PROJ = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files';
const REF_BUILD = '/tmp/tmp.2s2eHN3Kax/build';
const REF_HAP = '/tmp/opencode/ref-build.lock.hap';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [OK] ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  [XX] ' + name + (extra ? '  ' + extra : '')); }
}

(async () => {
  const config = JSON.parse(fs.readFileSync(path.join(PROJ, 'entry/src/main/config.json'), 'utf8'));
  console.log('== 1. build 产物 vs 参考构建 ==');
  const out = build.compileBuild({ projectRoot: PROJ, config, manifest: null, jerryBin: null });

  // deterministic 文件逐字节
  const det = ['manifest.json', 'image_convert_result.txt'];
  for (const p of det) {
    const my = Buffer.from(out[p]);
    const ref = fs.readFileSync(path.join(REF_BUILD, p));
    check(p, my.equals(ref), my.length + 'B');
  }
  // common bin 逐字节
  for (const p of Object.keys(out)) {
    if (p.startsWith('common/') && p.endsWith('.bin')) {
      const my = Buffer.from(out[p]);
      const rp = path.join(REF_BUILD, p);
      check(p, fs.existsSync(rp) && my.equals(fs.readFileSync(rp)), my.length + 'B');
    }
  }
  // 页面文件集一致
  const myPageSet = new Set(Object.keys(out).filter((p) => p.startsWith('pages/') && p.endsWith('.js')).map((p) => p.split('/')[1]));
  const refPageDirs = fs.readdirSync(path.join(REF_BUILD, 'pages'));
  check('页面清单一致', myPageSet.size === refPageDirs.length && [...myPageSet].every((name) => refPageDirs.includes(name)),
    'my=' + myPageSet.size + ' ref=' + refPageDirs.length);

  console.log('== 2. .bc 版本全部 v24 ==');
  let all24 = true;
  for (const p of Object.keys(out)) {
    if (!p.endsWith('.bc')) continue;
    const b = Buffer.from(out[p]);
    if (!(b.length >= 8 && b[0] === 0x4a && b[1] === 0x52 && b[2] === 0x52 && b[3] === 0x59 && b.readUInt32LE(4) === 24)) {
      all24 = false; console.log('   [XX] ' + p + ' 非 v24');
    }
  }
  check('全部 ' + Object.keys(out).filter((p) => p.endsWith('.bc')).length + ' 个 .bc 为 v24', all24);

  console.log('== 3. HAP 内容对比参考 HAP ==');
  const hapBuf = await build.assembleHap({ projectRoot: PROJ, config, buildOut: out });
  // 用 tar 工具的 unzip 展开
  fs.mkdirSync('/tmp/opencode/e2e-hap-my', { recursive: true });
  fs.writeFileSync('/tmp/opencode/e2e/myhap.zip', hapBuf);
  const { execSync } = require('child_process');
  execSync('rm -rf /tmp/opencode/e2e-hap-my && mkdir -p /tmp/opencode/e2e-hap-my && unzip -q /tmp/opencode/e2e/myhap.zip -d /tmp/opencode/e2e-hap-my');

  const refEntries = {};
  execSync('rm -rf /tmp/opencode/e2e-hap-ref && mkdir -p /tmp/opencode/e2e-hap-ref && unzip -q ' + REF_HAP + ' -d /tmp/opencode/e2e-hap-ref');

  // detHap 逐字节对比（config / resources.index；pack.info/.hml/.css 按真机约束已剥除，不对比）
  const detHap = ['config.json', 'assets/entry/resources.index'];
  for (const p of detHap) {
    const a = fs.readFileSync(path.join('/tmp/opencode/e2e-hap-my', p));
    const b = fs.readFileSync(path.join('/tmp/opencode/e2e-hap-ref', p));
    check('HAP/' + p, a.equals(b), a.length + 'B');
  }
  // media 目录逐文件
  const myM = '/tmp/opencode/e2e-hap-my/assets/entry/resources/base/media';
  const rfM = '/tmp/opencode/e2e-hap-ref/assets/entry/resources/base/media';
  const mfMy = fs.readdirSync(myM).sort();
  const mfRef = fs.readdirSync(rfM).sort();
  check('media 文件清单一致', JSON.stringify(mfMy) === JSON.stringify(mfRef), '[' + mfMy.join(',') + ']');
  for (const f of mfMy) {
    const a = fs.readFileSync(path.join(myM, f));
    const b = fs.readFileSync(path.join(rfM, f));
    if (!a.equals(b)) check('media/' + f, false, '');
  }
  check('media 全部文件逐字节', mfMy.every((f) => fs.readFileSync(path.join(myM, f)).equals(fs.readFileSync(path.join(rfM, f)))));
  // js 资产清单（源码+build 覆盖）
  const myJs = '/tmp/opencode/e2e-hap-my/assets/js/default';
  const rfJs = '/tmp/opencode/e2e-hap-ref/assets/js/default';
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(d, path.join(d, e.name))]);
  // 简化：递归 relative
  const walkRel = (d, base) => {
    const res = [];
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) res.push(...walkRel(p, base));
      else res.push(path.relative(base, p));
    }
    return res;
  };
  const listMy = walkRel(myJs, myJs).sort();
  const listRef = walkRel(rfJs, rfJs).filter((p) => !/\.(hml|css)$/.test(p)).sort();
  // 我方按真机约束剥除 .hml/.css（编译进 JS、不安装），故参考清单同样剔除后对比
  check('assets/js/default 文件清单一致（源码+build，剔除 hml/css）', JSON.stringify(listMy) === JSON.stringify(listRef),
    'my=' + listMy.length + ' ref(剔除hml/css)=' + listRef.length);
  // 源码文件（hml/css/js 源/公共）与 bin 等逐字节
  let srcEq = true;
  for (const rel of listMy) {
    // .js 编译产物与 .bc 语义不等价跳过；其余必须逐字节
    if (rel.endsWith('.js') || rel.endsWith('.bc')) continue;
    const a = fs.readFileSync(path.join(myJs, rel));
    const b = fs.readFileSync(path.join(rfJs, rel));
    if (!a.equals(b)) { srcEq = false; console.log('   [XX] js资产不同: ' + rel); }
  }
  check('assets/js/default 非编译文件逐字节一致', srcEq);

  console.log('===== ' + pass + ' passed, ' + fail + ' failed =====');
  process.exitCode = fail ? 1 : 0;
})();