# Web 端生成 `.bc`：jerry WASM 方案

## 为什么需要 wasm

`.bc` = JerryScript 引擎把 `.js` 源码编译出的 **JRRY v24 字节码快照**（`.bc` 头 `4a 52 52 59` + version 24）。
它必须在 jerry 引擎内生成——没有 `jerry` 的浏览器做不到。路线只有一条：**把 SDK 同款 jerry 的快照工具编成 WebAssembly**，在浏览器里跑同一份 C 代码。

## 工具本体

`jerry-snapshot` 不是整个 jerry 学习版 CLI，而是一个极小的程序：

```
jerry-main/main-unix-snapshot.c + jerry-main/cli.c 
+ jerry-core（JS 引擎，profile=es5.1）
+ jerry-port-default（系统接口适配）
```

它做的事就一行：读入 `.js` 文件 → `jerry_init` + `jerry_parse` → 调 `jerry_generate_snapshot` → 写 `.bc`。
我们调用：`jerry-snapshot generate -o out.bc in.js`（见 `lib/jerry.js:54`）。

## 为什么 wasm 能逐字节一致

快照字节对「引擎版本 + 编译配置」是**确定的**（同输入同配置 → 同字节，无时间戳、无随机、无绝对路径写入）。
所以 wasm 版必须镜像 linux 版构建配置。配置源：

```
compiler/linux/third_party/jerryscript/build/CMakeCache.txt
```

已提取的关键项（wasm 构建照抄）：

| 配置 | 值 | 作用 |
|---|---|---|
| `JERRY_PROFILE` | `es5.1` | 支持语法面；profile 不同会产出不同字节码 |
| `JERRY_GLOBAL_HEAP_SIZE` | `512` | 引擎堆大小，影响快照生成容量 |
| `JERRY_SNAPSHOT_VERSION`（源码） | `24u` | 决定 `.bc` 魔数后版本=24，设备铁律 |
| `JERRY_PARSER` | ON | 必须解析器 |
| `JERRY_CMDLINE_SNAPSHOT` | ON | 编译出 snapshot 工具 |
| `JERRY_LOGGING / DEBUGGER / MEM_STATS / ERROR_MESSAGES` | OFF | 与快照字节无关，但镜像确保行为一致 |

## 浏览器集成

`js/jerry-wasm.js` 会尝试加载 `vendor-wasm/jerry-snapshot.wasm.js`（emscripten MODULARIZE 产物），
并把 `.wasm` 二进制预取缓存，随后逐文件生成：

```
module = await createJerrySnapshot({ wasmBinary })   # 每个文件一个全新实例！
module.FS.writeFile('/in.js', js源码)
module.callMain(['generate','-o','/out.bc','/in.js'])
return module.FS.readFile('/out.bc')                # → Uint8Array .bc
```

加载成功 → `WebCompiler.compileProject` 自动补 `.bc`（app.js + 页面 js），并做 JRRY v24 校验；
加载失败 → 回退本机快照服务；两者都无 → 模拟器可用（UI 提示真机需补字节码）。

## ⚠️ 已知坑：同一实例重复 main() 会污染后续快照

同一 emscripten 实例上连续多次 `callMain`（＝反复 `main()` → `jerry_init`/`jerry_cleanup`）时，
jerry 内部堆不会清零，某些输入（例：`demo_arrRender`）跑过后会把引擎状态弄脏，导致**后续**快照的
字面量表字节漂移——两个输入相同、长度相同，但有 20+ 个单字节差异（如 `ba/ae/a5` 与 `00`）。

- 现象复现：`devdemo` 工程 22 个快照里，同一实例顺序生成时前 2 个与原生一致、第 3 个起全偏；
  每文件用**全新实例**后 22/22 与原生逐字节一致（`seq-bc.cjs` 复现、`seq3.cjs` 验证修复）。
- 结论/铁律：**每次快照必须新建 emscripten 实例**（实例间 FS/堆相互隔离）。`js/jerry-wasm.js`
  与 `wasm/verify-wasm.cjs` 均已按此实现。
- 顺带收益：实例各自独立 FS，一次快照后删除 `/in.js`、`/out.bc` 即可，不残留。

## 构建（离线机器装好 emsdk 后）

```bash
# 一次性：安装 emsdk（需要外网）
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh

# 构建
compiler/web/wasm/build-wasm.sh        # 产物 → compiler/web/vendor-wasm/jerry-snapshot.wasm(.js)
```

注意点（均已落入 `build-wasm.sh`）：
- 新 clang 对 `-Wenum-enum-conversion` 默认 `-Werror` 且盖不住 jerry 的 `-Werror=all`，需用
  per-warning `-Wno-error=enum-enum-conversion` 并放在 **CMAKE_C_FLAGS_RELEASE（最末尾位）**；
  同时给 `jerryscript/CMakeLists.txt` 第 197 行的 `-Werror` 后追加 `-Wno-error` 中和。
- 新版 emscripten 里 `$print`/`$printErr` 导出已废弃（会把链接炸成 -Werror），所以
  `EXPORTED_RUNTIME_METHODS` 只留 `callMain,FS`，另加 `-Wno-error=js-compiler -Wno-error=deprecated`。

验收（有 wasm 产物后）：

```bash
node compiler/web/wasm/verify-wasm.cjs  # 同一批 js 分别喂原生 vs wasm，逐字节对比 .bc（reader 3/3）
```

## 真机字节码的另一条路（无网络/无 wasm 时）

`compiler/web/local-snapshot-server.cjs`：在本机起一个 127.0.0.1 小服务，POST 源码回传原生 jerry 生成的 `.bc`。
Web 页在 localhost 打开时自动探测并可用。这条链路**现在就能跑**，不受无网络影响，因为原生 jerry 二进制已在本机。

> 说明：本地快照服务是 wasm 落地前的过渡方案，现在降级为回退。wasm 产物已 gitignore，
> 需按 `BUILD.md` §2 构建后放入 `vendor-wasm/`（`build-wasm.sh` 自动拷贝），浏览器侧即脱离任何本地依赖
> （devdemo 22 页 HAP 全部 172 条目与 Linux 编译逐字节一致）。