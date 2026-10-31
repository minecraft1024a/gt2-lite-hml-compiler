# 从源码重新构建编译产物（BUILD.md）

仓库刻意 gitignore 了以下**编译产物**，克隆下来后需按本教程重建。其余代码 / 资源
（Node 编译器核心、`linux/vendor`、`web/vendor` 的 babel/pako/jszip 等）随仓库附带，无需构建。

| 产物 | 用途 | 构建方式 | 输出位置 |
|---|---|---|---|
| 原生 `jerry-snapshot` | Linux 端把 `.js` 编译成真机 `.bc`（JRRY v24） | CMake（见 §1） | `linux/third_party/jerryscript/build/bin/jerry-snapshot` |
| wasm 版 `jerry-snapshot` | 浏览器端生成真机 `.bc`（与原生逐字节一致） | emsdk + `build-wasm.sh`（见 §2） | `web/vendor-wasm/jerry-snapshot.wasm(.js)` |
| `web/js/compiler-core.js` | 浏览器版编译核心（打包自 `linux/lib`） | `node build-core.js`（见 §3） | `web/js/compiler-core.js` |

> 为什么 gitignore：`.bc` 字节只依赖「jerry 引擎版本 + 编译配置」，不依赖机器；
> 但二进制产物（CMake `.o` 树、wasm `.wasm`）体积大、纯属构建副产物，任何机器都能一键重建。

---

## 1. 构建原生 jerry-snapshot（Linux / macOS）

依赖：`cmake ≥ 3.5`、`make`、C 编译器（gcc/clang）。**只需 node + 本二进制**即可跑 Linux 编译器。

配置镜像自 `linux/third_party/jerryscript/build/CMakeCache.txt`
（**必须**照抄这些开关：`JERRY_PROFILE=es5.1` + 各功能开关决定快照字节，配错会产出无法装机的 `.bc`）：

```bash
cd linux/third_party/jerryscript

cmake -S . -B build -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DJERRY_CMDLINE=ON \
  -DJERRY_CMDLINE_SNAPSHOT=ON \
  -DJERRY_CMDLINE_TEST=OFF \
  -DJERRY_PROFILE=es5.1 \
  -DJERRY_GLOBAL_HEAP_SIZE=512 \
  -DJERRY_PARSER=ON \
  -DJERRY_SNAPSHOT_EXEC=OFF \
  -DJERRY_SNAPSHOT_SAVE=OFF \
  -DJERRY_EXT=ON \
  -DJERRY_LIBM=ON \
  -DJERRY_PORT_DEFAULT=ON \
  -DJERRY_LOGGING=OFF \
  -DJERRY_DEBUGGER=OFF \
  -DJERRY_ERROR_MESSAGES=OFF \
  -DJERRY_LINE_INFO=OFF \
  -DJERRY_MEM_STATS=OFF

make -C build jerry-snapshot -j$(nproc)
```

产物：`build/bin/jerry-snapshot`、`build/bin/jerry`。验证入口（全绿）：

```bash
node linux/test-final-hap.cjs     # 产物 HAP 内全部 .bc 为 JRRY v24 且可执行
node linux/test-e2e-hap.cjs       # 30/30 与参考构建逐文件对比
```

> 指定别的二进制路径：`node linux/bin/gt2-build.js <工程根> -o out.hap --jerry /path/to/jerry-snapshot`

## 2. 构建 wasm 版 jerry-snapshot（浏览器端）

依赖：**emsdk**（emcmake / emmake）。这是网页版开箱生成真机 `.bc` 的前提。

```bash
# 一次性：安装 emsdk（需要外网，装好后 reactivate）
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source ./emsdk/emsdk_env.sh

# 构建（自动 cmake 镜像原生配置 → emcc 链接 → 产物拷到 web/vendor-wasm/）
compiler/web/wasm/build-wasm.sh
```

产物：`web/vendor-wasm/jerry-snapshot.wasm` + `jerry-snapshot.wasm.js`。

验收——把同一批 JS 分别喂原生 vs wasm，逐字节对比 `.bc`：

```bash
node compiler/web/wasm/verify-wasm.cjs   # reader 3/3、devdemo 22/22 与原生一致
```

⚠️ 构建已知坑（`build-wasm.sh` 已内置修复）：
- 新 clang 对 `-Wenum-enum-conversion` 默认 `-Werror`，需在 **`CMAKE_C_FLAGS_RELEASE` 末尾**加
  `-Wno-error=enum-enum-conversion`，并中和 `jerryscript/CMakeLists.txt` 里的全局 `-Werror`。
- 新版 emscripten 中 `$print/$printErr` 导出已废弃，`LINK_FLAGS` 只导出 `_main,_malloc,_free` +
  运行时 `callMain,FS`，并补 `-Wno-error=js-compiler -Wno-error=deprecated`。

浏览器侧行为（`web/js/jerry-wasm.js`）：探测 `vendor-wasm/jerry-snapshot.wasm.js` → 加载成功用
wasm 逐文件生成 `.bc`；失败回退本机快照服务；都无则仅可模拟器运行（UI 会提示）。

## 3. 重新生成浏览器编译核心（改了 linux/lib 后必跑）

`web/js/compiler-core.js` 是 `linux/lib` 纯 JS 核心的浏览器打包，**勿手改**：

```bash
node compiler/web/build-core.js        # 重新生成 web/js/compiler-core.js
node compiler/web/smoke.cjs            # 9/9 与 Linux 版构建逐字节一致
```

## 4. 免构建回退方案（临时）

`compiler/web/local-snapshot-server.cjs` 起 127.0.0.1:8735 本机服务，用**已构建好的原生
jerry** 回传 `.bc`；网页在 localhost 打开时自动探测使用。构建 wasm 之前，可用它先真机验证。

```bash
node compiler/web/local-snapshot-server.cjs
```

## 5. Linux 编译器完整试跑

```bash
# 前置：执行完 §1，确认 build/bin/jerry-snapshot 存在
node compiler/linux/bin/gt2-build.js <DevEco 2.x lite 工程根> -o out.hap
```

工程根 = 含 `entry/src/main/config.json` 的目录。输出**未签名 HAP**（等价 SDK `NOSIGN=1`）。
详细产物格式 / 验收结论见 `linux/README.md`。