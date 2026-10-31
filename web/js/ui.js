/* Web 版 UI：拖拽/选目录/选 zip → 编译 → 下载 HAP */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var logBox = $('log');
  var current = { entries: null, bundleName: '', version: '', lastResult: null };

  function log(text, cls) {
    var span = document.createElement('div');
    span.textContent = text;
    if (cls) span.className = cls;
    logBox.appendChild(span);
  }
  function clearLog() { logBox.innerHTML = ''; }

  function show(id) { var el = $(id); if (el) el.classList.remove('hidden'); }
  function hide(id) { var el = $(id); if (el) el.classList.add('hidden'); }

  // ---------- 目录条目遍历（webkitGetAsEntry） ----------
  function walkEntry(entry, base) {
    return new Promise(function (resolve) {
      if (entry.isFile) {
        entry.file(function (f) {
          f._rel = base ? base + '/' + entry.name : entry.name;
          resolve([f]);
        }, function () { resolve([]); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader();
        var acc = [];
        var read = function () {
          reader.readEntries(function (entries) {
            if (!entries.length) { resolve(acc); return; }
            var next = entries.map(function (e) {
              return walkEntry(e, base ? base + '/' + entry.name : entry.name);
            });
            Promise.all(next).then(function (groups) {
              groups.forEach(function (g) { acc.push.apply(acc, g); });
              read();
            });
          }, function () { resolve(acc); });
        };
        read();
      } else {
        resolve([]);
      }
    });
  }

  // 把 webkitRelativePath（如 reader/entry/src/main/config.json）规整为工程相对路径
  function relFromWebkit(p) {
    p = p.replace(/\\/g, '/');
    var i = p.indexOf('/entry/src/main');
    if (i >= 0) return p.slice(i + 1); // 从 entry/... 开始
    var j = p.indexOf('/config.json');
    if (j >= 0) return p.slice(j + 1); // 退化为 config.json 顶层
    var k = p.indexOf('/');
    return k >= 0 ? p.slice(k + 1) : p;
  }

  async function filesToEntries(fileList) {
    var rows = [];
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      var path = f._rel || (f.webkitRelativePath ? relFromWebkit(f.webkitRelativePath) : f.name);
      var ab = await f.arrayBuffer();
      rows.push({ path: path, data: new Uint8Array(ab) });
    }
    return rows;
  }

  // ---------- 入口：拿到 File→路径 列表后编译 ----------
  async function handleFiles(fileList) {
    if (!fileList || !fileList.length) return;
    clearLog();
    hide('summary'); hide('pipeline'); hide('error-box');
    $('btn-download').disabled = true;
    log('读取工程文件… ' + fileList.length + ' 个');
    var entries;
    try {
      entries = await filesToEntries(fileList);
    } catch (e) {
      showErr('读取文件失败：' + e.message);
      return;
    }
    doCompile(entries);
  }

  async function handleZip(file, logIt) {
    if (!file) return;
    clearLog();
    hide('summary'); hide('pipeline'); hide('error-box');
    $('btn-download').disabled = true;
    if (logIt) log('解压 ' + file.name + ' …');
    try {
      var ab = await file.arrayBuffer();
      var entries = await WebCompiler.loadZip(ab);
      log('解压完成，共 ' + entries.length + ' 个文件');
      doCompile(entries);
    } catch (e) {
      showErr('zip 解析失败：' + e.message);
    }
  }

  function doCompile(entries) {
    show('pipeline');
    log('开始编译（HML/CSS→bundle→png→资源索引）…');
    var t0 = performance.now();
    var res;
    try {
      res = WebCompiler.compileProject(entries);
    } catch (e) {
      showErr('编译内部错误：' + e.message);
      return;
    }
    var ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      showErr(res.error || '编译失败');
      return;
    }

    current.lastResult = res;
    current.bundleName = res.bundleName;
    current.version = res.version;
    renderSummary(res);
    show('summary');
    $('btn-download').disabled = false;
    log('[OK] 编译完成，用时 ' + ms + ' ms，' + res.entries.length + ' 个 HAP 条目（未含 .bc）', 'ok');
    log('页面：' + (res.pages.join(', ') || '无'));
    res.warnings.forEach(function (x) { log('⚠ ' + x, 'warn'); });
    applyBcIfNeeded();
  }

  function renderSummary(res) {
    current.entries = res.entries;
    $('s-bundle').textContent = res.bundleName || '（未设置）';
    $('s-version').textContent = res.version || '-';
    $('s-pages').textContent = res.pages.length ? res.pages.join(' · ') : '（无页面）';
    $('s-files').textContent = res.entries.length + (res.hasBc ? '（含 .bc）' : '');
    $('s-js').textContent = (res.summary.jsSize / 1024).toFixed(1) + ' KB';
    $('s-bc').textContent = res.hasBc ? '已含 (' + res.bcCount + ')' : '未含（见真机提示）';

    var w = $('warnings');
    w.innerHTML = '';
    if (res.warnings.length) w.textContent = '⚠ ' + res.warnings.join(' ｜ ');
    else w.textContent = '';
  }

  // 开关要求且提供者就绪时补 .bc
  function applyBcIfNeeded() {
    var wantBc = $('bc-toggle') && $('bc-toggle').checked;
    var res = current.lastResult;
    if (!wantBc || !res || res.hasBc || !window.JerrySnap) return;
    var prov = window.JerrySnap.getProvider();
    if (!prov) { log('字节码提供者不可用，跳过 .bc', 'err'); return; }
    log('正在生成真机字节码（.bc，JRRY v24）…');
    WebCompiler.generateBc(res.entries, function (src) { return window.JerrySnap.snapshotJs(src); }, log)
      .then(function (out) {
        if (!out.error && out.snapshots.length) {
          res.entries = out.entries;
          res.hasBc = true;
          res.bcCount = out.snapshots.length;
          current.entries = out.entries;
          renderSummary(res);
          log('[OK] 已补 ' + out.snapshots.length + ' 个 .bc（' +
            out.snapshots.map(function (p) { return p.split('/').pop(); }).join(', ') + '）', 'ok');
        } else {
          log('.bc 生成失败：' + (out.snapshots && !out.snapshots.length ? '0 个成功' : out.error), 'err');
        }
        $('btn-download').disabled = false;
      })
      .catch(function (e) { log('.bc 生成异常：' + e.message, 'err'); $('btn-download').disabled = false; });
  }

  function showErr(msg) {
    var box = $('error-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'error-box';
      document.querySelector('main').appendChild(box);
    }
    box.textContent = msg;
    show('error-box');
    log(msg, 'err');
  }

  // ---------- 下载 ----------
  $('btn-download').addEventListener('click', async function () {
    if (!current.entries) return;
    $('btn-download').disabled = true;
    log('[OK] 正在压缩 HAP（DEFLATE）…', 'ok');
    try {
      var blob = await WebCompiler.buildZip(current.entries);
      var name = (current.bundleName || 'app') + '-' + (current.version || '0.0.0') + '.hap';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      log('[OK] 已开始下载 ' + name + '（' + (blob.size / 1024).toFixed(1) + ' KB）', 'ok');
    } catch (e) {
      showErr('打包失败：' + e.message);
    } finally {
      $('btn-download').disabled = false;
    }
  });

  // ---------- 输入绑定 ----------
  var zone = $('drop-zone');
  ['dragenter', 'dragover'].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('dragover'); });
  });

  zone.addEventListener('drop', async function (e) {
    var items = e.dataTransfer.items;
    var dropped = [];
    var sawEntry = false;
    if (items && items.length) {
      var jobs = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.webkitGetAsEntry) {
          sawEntry = true;
          jobs.push(walkEntry(it.webkitGetAsEntry(), ''));
        }
      }
      var groups = await Promise.all(jobs);
      groups.forEach(function (g) { dropped.push.apply(dropped, g); });
    }
    if (sawEntry && dropped.length) {
      await handleFiles(dropped);
    } else if (e.dataTransfer.files && e.dataTransfer.files.length) {
      // 拖的 zip
      var zip = Array.prototype.find.call(e.dataTransfer.files, function (f) { return /\.zip$/i.test(f.name); });
      if (zip) await handleZip(zip, true);
      else await handleFiles(e.dataTransfer.files);
    }
  });

  $('btn-folder').addEventListener('click', function () { $('inp-folder').click(); });
  $('btn-zip').addEventListener('click', function () { $('inp-zip').click(); });

  $('inp-folder').addEventListener('change', function () { handleFiles($('inp-folder').files); $('inp-folder').value = ''; });
  $('inp-zip').addEventListener('change', function () { handleZip($('inp-zip').files[0], true); $('inp-zip').value = ''; });

  // ---------- 真机字节码 ----------
  $('bc-toggle').addEventListener('change', function () {
    var res = current.lastResult;
    if (!res) return;
    if (this.checked) {
      applyBcIfNeeded();
    } else {
      res.entries = res.entries.filter(function (e) { return !/\.bc$/.test(e.path); });
      res.hasBc = false;
      current.entries = res.entries;
      renderSummary(res);
      log('已移除 .bc（重新勾选可再次生成）', '');
    }
  });

  $('bc-bar').hidden = false;
  var provEl = $('bc-provider');
  provEl.textContent = '检测字节码提供者…';
  if (window.JerrySnap) {
    window.JerrySnap.detect().then(function (st) {
      if (st.provider === 'wasm') provEl.textContent = '✅ wasm 快照已就绪（浏览器内生成字节码）';
      else if (st.provider === 'local') provEl.textContent = '✅ 已连接本机快照服务 http://127.0.0.1:8735';
      else provEl.textContent = '➖ 未检测到 .bc 提供者（产物流入模拟器；真机需补字节码）';
    });
  } else {
    provEl.textContent = '➖ .bc 提供者脚本未加载';
  }

  log('就绪：可拖入工程文件夹或 zip。', 'ok');
  log('提示：勾选「真机字节码 .bc」并在有提供者（wasm/本机快照服务）时，产物可直接装机；否则仅模拟器可用。', '');
})();