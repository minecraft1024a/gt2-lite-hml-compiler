#!/usr/bin/env node
"use strict";
/**
 * GT2 lite 纯本地编译器 CLI
 * 用法: node bin/gt2-build.js <工程根> [-o out.hap] [--app out.app]
 *                              [--build buildDir] [--jerry <v24二进制>]
 *   SRC = 工程根/entry/src/main
 *   输出无签名 HAP（等价 NOSIGN=1 的 SDK 构建），并校验全部 .bc 为 JRRY v24
 */
const fs = require('fs');
const path = require('path');
const build = require('../lib/build');
const jerry = require('../lib/jerry');
const manifestLib = require('../lib/manifest');

function fail(msg) {
  console.error('错误: ' + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { out: null, app: null, build: null, jerry: null, project: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a === '--app') opts.app = argv[++i];
    else if (a === '--build') opts.build = argv[++i];
    else if (a === '--jerry') opts.jerry = argv[++i];
    else rest.push(a);
  }
  opts.project = rest[0] || null;
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.project) fail('用法: gt2-build.js <工程根> [-o out.hap] [--app out.app] [--build dir]');
  const proj = path.resolve(opts.project);
  const configPath = path.join(proj, 'entry/src/main/config.json');
  if (!fs.existsSync(configPath)) fail('找不到 ' + configPath);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  process.stdout.write('[1/5] manifest + 编译 JS（app + ' +
    ((config.module.js && config.module.js[0] && config.module.js[0].pages || []).length) + ' 页）...\n');
  const buildOut = build.compileBuild({ projectRoot: proj, config, manifest: null, jerryBin: opts.jerry });
  const jsCount = Object.keys(buildOut).filter((p) => p.endsWith('.js')).length;
  const bcCount = Object.keys(buildOut).filter((p) => p.endsWith('.bc')).length;
  const binCount = Object.keys(buildOut).filter((p) => p.endsWith('.bin') && !p.endsWith('.bc')).length;
  process.stdout.write('   JS ' + jsCount + ' / .bc ' + bcCount + ' / .bin ' + binCount + ' 项\n');

  // .bc v24 全量自检
  process.stdout.write('[2/5] .bc 版本校验（必须 JRRY v24）...\n');
  for (const [p, data] of Object.entries(buildOut)) {
    if (!p.endsWith('.bc')) continue;
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (b.length < 8 || b[0] !== 0x4a || b[1] !== 0x52 || b[2] !== 0x52 || b[3] !== 0x59 || b.readUInt32LE(4) !== 24) {
      fail('.bc 非法版本: ' + p + '（v49 会被设备判死）');
    }
  }
  process.stdout.write('   全部 ' + bcCount + ' 个 .bc 为 v24 ✓\n');

  // build 产物目录（调试用）
  if (opts.build) {
    process.stdout.write('[3/5] 输出 build 产物到 ' + opts.build + ' ...\n');
    fs.rmSync(opts.build, { recursive: true, force: true });
    fs.mkdirSync(opts.build, { recursive: true });
    for (const [rel, data] of Object.entries(buildOut)) {
      const dst = path.join(opts.build, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, data);
    }
  }

  process.stdout.write('[4/5] 组装 HAP（resources.index / config 规范化；剥 hml/css、不写 pack.info）...\n');
  const hapBuf = await build.assembleHap({ projectRoot: proj, config, buildOut });
  const out = opts.out || path.join(proj, 'entry-release-lite.hap');
  if (!opts.out) opts.out = out;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(path.resolve(out), hapBuf);
  process.stdout.write('   HAP: ' + path.resolve(out) + ' (' + hapBuf.length + ' B)\n');

  if (opts.app) {
    process.stdout.write('[5/5] 壳 in.app ...\n');
    const JSZip = hapApp_();
    const zip = new JSZip();
    zip.file('entry-release-lite.hap', hapBuf);
    const appBuf = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    fs.writeFileSync(path.resolve(opts.app), appBuf);
    process.stdout.write('   APP: ' + path.resolve(opts.app) + ' (' + appBuf.length + ' B)\n');
  }

  process.stdout.write('完成 ✓\n');
}

function hapApp_() {
  // 复用 hap 库的 jszip 加载
  return require('../lib/hap').loadJszip();
}

main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });