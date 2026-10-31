/* .bc（JRRY v24）提供者：
 *   1) vendor-wasm/jerry-snapshot.wasm(.js) —— emscripten 编的 wasm（首选，浏览器自足）
 *   2) http://127.0.0.1:8735 本地快照服务    —— 无 wasm 时的过渡桥接（需先起 local-snapshot-server.cjs）
 * 探测加载到哪个用哪个；都没有则 provider=null（产物仅供模拟器，UI 会有提示）。
 *
 * 注意（wasm 路）：
 *   同一 emscripten 实例上重复 callMain → jerry_init/cleanup 时其内部堆不会清零，
 *   某些输入会留下脏状态，导致后续快照的字面量表字节漂移（部分文件还是逐字节对、
 *   部分对不齐）。所以**每次快照都用 factory() 新建一个实例 + 独立 FS**（已验证 22/22 与原生逐字节一致）。
 *   因此这里一次性 fetch 缓存 wasm 二进制，避免每个文件重新下网络。
 */
(function (g) {
  'use strict';

  var LOCAL_URL = g.__JERRY_SNAP_LOCAL__ || 'http://127.0.0.1:8735';
  var provider = null;       // 'wasm' | 'local'
  var factory = null;        // emscripten MODULARIZE 产出的 createJerrySnapshot
  var wasmBinary = null;     // 缓存的 jerry-snapshot.wasm（ArrayBuffer）

  function headersOf(bc) {
    // 校验 JRRY + v24（铁律，不合法就抛）
    if (!(bc instanceof Uint8Array) || bc.length < 8) throw new Error('.bc 太短');
    var dv = new DataView(bc.buffer, bc.byteOffset, 8);
    if (dv.getUint32(0, false) !== 0x4a525259) throw new Error('.bc 缺 JRRY 魔数');
    if (dv.getUint32(4, true) !== 24) throw new Error('.bc 版本非 v24，真机会判死');
    return bc;
  }

  async function snapshotJs(jsText) {
    if (!provider) throw new Error('没有可用的 .bc 提供者（wasm 未加载、本地服务不可达）');
    if (provider === 'wasm' && factory) {
      // 每次全新实例（见文件头注释），实例间 FS/堆相互隔离
      var M = await factory({ wasmBinary: wasmBinary });
      M.FS.writeFile('/in.js', jsText);
      var rc = M.callMain(['generate', '-o', '/out.bc', '/in.js']);
      if (rc !== 0) throw new Error('wasm jerry-snapshot 退出码 ' + rc);
      var bc = new Uint8Array(M.FS.readFile('/out.bc'));
      try { M.FS.unlink('/in.js'); M.FS.unlink('/out.bc'); } catch (e) {}
      return headersOf(bc);
    }
    if (provider === 'local') {
      var res = await fetch(LOCAL_URL + '/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: jsText,
      });
      if (!res.ok) {
        var err = null;
        try { err = (await res.json()).error; } catch (e) {}
        throw new Error('本地快照失败：' + (err || res.status));
      }
      return headersOf(new Uint8Array(await res.arrayBuffer()));
    }
    throw new Error('无 .bc 提供者');
  }

  function ping(url, timeoutMs) {
    return new Promise(function (resolve) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); resolve(false); }, timeoutMs || 1200);
      fetch(url, { method: 'GET', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) {
          clearTimeout(timer);
          resolve(r && r.ok);
        })
        .catch(function () { clearTimeout(timer); resolve(false); });
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve) {
      var el = document.createElement('script');
      el.src = src;
      el.onload = function () { resolve(true); };
      el.onerror = function () { resolve(false); };
      document.head.appendChild(el);
    });
  }

  function fetchBinary(url) {
    var _b = g.__JERRY_WASM_BIN__;
    if (_b) return Promise.resolve(_b);
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('fetch wasm 失败 ' + res.status);
      return res.arrayBuffer();
    }).then(function (b) {
      g.__JERRY_WASM_BIN__ = b;
      return b;
    });
  }

  // 加载 wasm 脚本 + 预取二进制；成功则 provider='wasm'
  async function detect() {
    try {
      var f = g.__jerrySnapshotWasm__ || (g.createJerrySnapshot && g.createJerrySnapshot);
      if (!f) {
        var loaded = await loadScript('vendor-wasm/jerry-snapshot.wasm.js');
        if (loaded === false) throw new Error('脚本不存在');
        f = g.createJerrySnapshot;
      }
      if (typeof f !== 'function') throw new Error('createJerrySnapshot 非函数');
      factory = f;
      wasmBinary = await fetchBinary('vendor-wasm/jerry-snapshot.wasm');
      provider = 'wasm';
      return { provider: provider, mode: 'wasm' };
    } catch (e) {
      factory = null; wasmBinary = null; provider = null;
    }
    // 2) 本地快照服务
    try {
      if (await ping(LOCAL_URL + '/ping')) {
        provider = 'local'; return { provider: provider, mode: 'local', url: LOCAL_URL };
      }
    } catch (e) {}
    provider = null;
    return { provider: null, mode: null };
  }

  g.JerrySnap = {
    detect: detect,
    snapshotJs: snapshotJs,
    provider: function () { return provider; },
    getProvider: function () { return provider; },
  };
})(typeof window !== 'undefined' ? window : globalThis);