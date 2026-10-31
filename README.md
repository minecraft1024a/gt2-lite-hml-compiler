# GT2 lite 编译器（compiler/）

自研 GT2 轻智能（liteWearable）应用编译工具，替代原 `scripts/build-lite-hap.sh`（SDK + wine 旧流程，已弃用）。

| 目录 | 版本 | 说明 |
|---|---|---|
| `linux/` | ✓ 已可用 | **纯本地 Node 编译一条龙**：`node linux/bin/gt2-build.js <工程根> -o out.hap` |
| `web/` | ✓ 已可用 | **浏览器版 HML 编译器**：拖入工程 zip → 编译 → 下载 HAP；`.bc` 用 wasm 版 jerry 在浏览器内生成（与 Linux 逐字节一致） |

> **克隆后先看 [BUILD.md](BUILD.md)**：`jerryscript/build/`、`build-wasm/`、`web/vendor-wasm/` 等编译产物已被
> gitignore，动手前需按教程重建（原生 `jerry-snapshot` 只需 cmake/make；wasm 版需 emsdk，详见 §2）。

## linux/（纯本地 Node 编译一条龙）

输入：DevEco 2.x lite 工程根（含 `entry/src/main/config.json`）。
输出：未签名 HAP（等价 SDK `NOSIGN=1`）+ 可选 `in.app` 壳 + build 中间产物。

```
node linux/bin/gt2-build.js <工程根> -o out.hap [--app out.app] [--build buildDir] [--jerry <v24二进制>]
```

- 无 SDK、无 wine、无 webpack 依赖；仅需 node + 原生 `jerry-snapshot` v24 二进制（默认取 `linux/third_party/jerryscript/build/bin/jerry-snapshot`）。
- `.bc` 全量校验 `JRRY` + version 24，非 v24 直接判死。
- 验收套件全绿：15/15 页面 HML/CSS 与 SDK oracle 逐字等价、19/19 png→bin 逐字节、E2E 30/30 对比参考 HAP、产物 HAP 内全部 js 可执行（hmlwsim 模拟运行 ✓）。

详见 `linux/README.md`。

## web/（浏览器版）

- 拖拽/选择工程 zip（`entry/src/main` 结构）→ 内存编译管线（与 linux 共用 hml/css/expr/bundle/png2bin/manifest/resources 核心）→ 预览 + 下载 HAP。
- 产物可被 hmlwsim 直接加载；真机所需 `.bc` 由内置 **wasm 版 jerry-snapshot** 在浏览器内生成（JRRY v24 铁律校验），
  与 Linux 原生 jerry 的产物**逐字节一致**（`wasm/verify-wasm.cjs` 验收；wasm 按 `BUILD.md` §2 用 emsdk 构建到
  `vendor-wasm/`，`js/jerry-wasm.js` 探测加载；构建前可先跑 `local-snapshot-server.cjs` 兜底）。
- 可整体发布到 **GitHub Pages**（纯静态、前端全相对路径）：把 `compiler/web` 内容放仓库根（或 `docs/`）+ `.nojekyll`。
  部署前需先按 `BUILD.md` §2 构建 wasm 放入 `web/vendor-wasm/`，之后浏览器内编译+补字节码全自足。

## 致谢

### 原编译器参考（HUAWEI / HarmonyOS SDK）

本编译器是**参照华为 HUAWEI / HarmonyOS SDK API6（2.2.0）官方 lite JS 编译管线**的独立重实现：
官方 DevEco `ace-loader`（webpack 管线 + `jerry-snapshot` v24 字节码 + png→bin 媒体转换）旧流程由原
`scripts/build-lite-hap.sh`（SDK + wine）调用，已弃用。本仓库实现不依赖 SDK/wine，但以 SDK 真机构建
产物作为 **oracle** 逐字节对齐验收（HML/CSS 逐字等价、png→bin 逐字节、HAP 逐文件）。官方 SDK 版权归
华为/HUAWEI 所有，不在本仓库分发（`sdk/` 位于上级 `gt2-hap-sideload` 工程，仅作参考）。

### 集成 / vendored 的开源项目

本仓库集成了多个开源项目（JerryScript / Babel / JSZip / pako），版权归原作者所有，
许可与版本信息见 **[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)**。