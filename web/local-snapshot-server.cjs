"use strict";
/**
 * 本地快照服务：为 Web 编译器补 .bc（真机字节码，JRRY v24）。
 * 在没有 wasm 前，浏览器产物缺 .bc；本服务在本机把 page js 交给原生
 * jerry-snapshot（与 SDK 逐字节一致），回传 .bc。页面只需 fetch http://127.0.0.1:8735。
 *
 * 用法：node local-snapshot-server.cjs [--port 8735] [--jerry <bin>]
 * 端点：
 *   GET  /ping                 → {ok:true, jerry}<-- 网页探测用（短超时）
 *   POST /snapshot  body=源码  → application/octet-stream .bc（非 v24 会 500）
 *   GET  /v24                  → 校验记录
 *
 * 安全：只绑 127.0.0.1，建议仅在本机调试时运行。
 */
const http = require('http');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : def;
}
const PORT = parseInt(arg('port', process.env.JERRY_SNAP_PORT || '8735'), 10);

const CANDIDATES = [
  arg('jerry', null),
  process.env.JERRY_SNAPSHOT,
  path.join(__dirname, '..', '..', 'linux', 'third_party', 'jerryscript', 'build', 'bin', 'jerry-snapshot'),
  path.join(__dirname, '..', 'linux', 'third_party', 'jerryscript', 'build', 'bin', 'jerry-snapshot'),
].filter(Boolean).filter(fs.existsSync);

if (!CANDIDATES.length) {
  console.error('找不到 jerry-snapshot 二进制（用 --jerry 指定）');
  process.exit(1);
}
const BIN = CANDIDATES[0];

function snapshot(jsBytes) {
  const dir = fs.mkdtempSync('/tmp/jssnap-');
  const inJs = path.join(dir, 'in.js');
  const outBc = path.join(dir, 'out.bc');
  try {
    fs.writeFileSync(inJs, jsBytes);
    execFileSync(BIN, ['generate', '-o', outBc, inJs], { stdio: ['ignore', 'pipe', 'pipe'] });
    const bc = fs.readFileSync(outBc);
    // 铁律：JRRY + v24
    if (bc.length < 8 || bc[0] !== 0x4a || bc[1] !== 0x52 || bc[2] !== 0x52 || bc[3] !== 0x59) {
      throw new Error('.bc 缺 JRRY 魔数');
    }
    if (bc.readUInt32LE(4) !== 24) throw new Error('.bc 版本非 v24');
    return bc;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, jerry: BIN }));
    return;
  }
  if (req.method === 'GET' && req.url === '/v24') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ril: 24 }));
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }
  if (req.method === 'POST' && req.url === '/snapshot') {
    const chunks = [];
    let size = 0;
    for await (const c of req) { chunks.push(c); size += c.length; if (size > 4 * 1024 * 1024) break; }
    const js = Buffer.concat(chunks);
    try {
      const bc = snapshot(js);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': bc.length,
      });
      res.end(bc);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`本地快照服务 http://127.0.0.1:${PORT}  jerry=${BIN}`);
});