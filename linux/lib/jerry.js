"use strict";
/**
 * jerry-snapshot .js -> .bc（v24）封装
 * 用原生 Linux v24 二进制（third_party/jerryscript/build/bin/jerry-snapshot），
 * 与 SDK wine 版逐字节一致（已实测 app.js/index.js/viewer_dir.js）。
 * 产物头校验：JRRY + version 0x18 (=24)，非 v24 直接判死。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let _bin = null;
function resolveBin(explicit) {
  if (explicit) return explicit;
  const root = path.dirname(__dirname);
  const candidates = [
    path.join(root, 'third_party/jerryscript/build/bin/jerry-snapshot'),
    path.join(root, 'bin/jerry-snapshot'),
    process.env.JERRY_SNAPSHOT,
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('找不到 jerry-snapshot v24 二进制。请设置 JERRY_SNAPSHOT 或提供 third_party/jerryscript/build/bin/jerry-snapshot');
}

function setBin(p) {
  if (p && !fs.existsSync(p)) throw new Error('jerry-snapshot 不存在: ' + p);
  _bin = p || null;
}

function checkVersion(jbcPath) {
  const buf = fs.readFileSync(jbcPath);
  if (buf.length < 8 ||
      buf[0] !== 0x4a || buf[1] !== 0x52 || buf[2] !== 0x52 || buf[3] !== 0x59) {
    throw new Error('生成的 .bc 缺少 JRRY 魔数: ' + jbcPath);
  }
  const ver = buf.readUInt32LE(4);
  if (ver !== 24) {
    throw new Error('.bc 版本为 ' + ver + '，必须是 v24（' + jbcPath + '）。v49 会被设备判死。');
  }
  return true;
}

/**
 * 生成 .bc 快照
 * @param {string} jsFile .js 文件路径
 * @param {string} [outFile] 输出 .bc；缺省 jsFile 去 .js 加 .bc
 * @returns {string} 输出 .bc 路径
 */
function snapshot(jsFile, outFile, binPath) {
  const bin = resolveBin(binPath || _bin);
  const out = outFile || jsFile.replace(/\.js$/, '.bc');
  const args = ['generate', '-o', out, jsFile];
  try {
    execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const detail = (e.stderr ? String(e.stderr) : e.message).split('\n').slice(0, 4).join(' | ');
    throw new Error('jerry-snapshot 失败(' + jsFile + '): ' + detail);
  }
  checkVersion(out);
  return out;
}

/** 批量快照（app.js + 页面 js），返回产物路径数组 */
function snapshotAll(jsFiles, { binPath, outDir } = {}) {
  const outs = [];
  for (const f of jsFiles) {
    const out = outDir ? path.join(outDir, path.basename(f).replace(/\.js$/, '.bc')) : undefined;
    outs.push(snapshot(f, out, binPath));
  }
  return outs;
}

module.exports = { snapshot, snapshotAll, checkVersion, setBin, resolveBin };