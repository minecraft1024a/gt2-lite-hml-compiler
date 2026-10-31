"use strict";
/**
 * 验收：wasm 版 jerry-snapshot 与原生产 .bc 逐字节一致
 * 用法：
 *   node verify-wasm.cjs [工程构建js目录] [--wasm vendor-wasm/jerry-snapshot.wasm.js]
 * 逐个文件：原生产 bc（build 目录里 native 生成的） 对比 wasm 现场生成的 bc。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ARGS = process.argv.slice(2);
const buildDir = ARGS[0] || '/tmp/opencode/reader-out/build';
const wasmModule = ARGS[ARGS.indexOf('--wasm') + 1] || path.join(__dirname, '..', 'vendor-wasm', 'jerry-snapshot.wasm.js');

// 找所有 build 里的 .js（页面 bundle + app bundle）
function findJs(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) findJs(abs, path.posix.join(base, e.name), out);
    else if (/\.js$/.test(e.name)) out.push({ rel: path.posix.join(base, e.name), js: abs });
  }
  return out;
}
const jsFiles = findJs(buildDir, '', []).filter((x) => !/\/common\//.test(x.rel));
if (!jsFiles.length) { console.error('没有可用的 js 样本：' + buildDir); process.exit(2); }

async function makeModule() {
  // 注意：必须每次快照新建实例——同一实例重复 main() 会让 jerry 堆变脏，
  // 部分输入会污染后续快照的字面量表字节（见 wasm/snapshot-wasm.md）。
  const code = fs.readFileSync(wasmModule, 'utf8');
  const sandbox = {
    console, setTimeout, clearTimeout, WebAssembly, TextDecoder, TextEncoder, URL,
    process, require, Buffer, __filename: wasmModule, __dirname: path.dirname(wasmModule),
    globalThis: null,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const factory = await vm.runInContext(code + '\n;createJerrySnapshot', sandbox);
  const wasmBinPath = wasmModule.slice(0, -3); // 剥掉末尾 ".js"，文件名已是 *.wasm
  return factory({ wasmBinary: fs.readFileSync(wasmBinPath) });
}

async function main() {
  // Module.FS.writeFile('/version', '');
  {
    // 冒烟：确认模块能起
    const m0 = await makeModule();
    m0.FS.writeFile('/version', '');
  }

  async function snapshotWasm(jsSrc) {
    const Module = await makeModule(); // 每个文件一个全新实例
    Module.FS.writeFile('/in.js', jsSrc);
    const rc = Module.callMain(['generate', '-o', '/out.bc', '/in.js']);
    if (rc !== 0) throw new Error('wasm snap rc=' + rc);
    return Module.FS.readFile('/out.bc');
  }
  function snapshotNative(jsAbs, tmpOut) {
    const { execFileSync } = require('child_process');
    try {
      execFileSync('/home/yishan/gt2-hap-sideload/compiler/linux/third_party/jerryscript/build/bin/jerry-snapshot',
        ['generate', '-o', tmpOut, jsAbs], { stdio: 'ignore' });
    } catch (e) {
      throw new Error('native snap 失败 ' + jsAbs + ': ' + (String(e.stderr || e).split('\n')[0]));
    }
    return fs.readFileSync(tmpOut);
  }

  let pass = 0, fail = 0;
  for (const f of jsFiles) {
    const jsSrc = fs.readFileSync(f.js);
    const native = snapshotNative(f.js, '/tmp/wasm-verify.bc');
    let wasm;
    try { wasm = Buffer.from(await snapshotWasm(jsSrc.toString())); }
    catch (e) { fail++; console.error('[XX] wasm 失败 ' + f.rel + ': ' + e.message); continue; }
    if (native.equals(wasm)) { pass++; console.log('[ok] ' + f.rel + ' 逐字节一致 (' + native.length + 'B)'); }
    else { fail++; console.error('[XX] ' + f.rel + ' 不一致 native=' + native.length + ' wasm=' + wasm.length); }
  }
  console.log(`\n===== ${pass} 通过, ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });