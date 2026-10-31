# GT2 lite HML 编译器 · Web 版（compiler/web）

浏览器内完成 DevEco 2.x lite 工程 → 未签名 HAP 的编译管线，产物可直接拖入 hmlwsim 模拟运行。
编译核心**单一来源** = `compiler/linux/lib`（`build-core.js` 打包成 `js/compiler-core.js`），
页面 JS bundle / resources.index / config 与 Linux 版**逐字节一致**（见 `smoke.cjs`）。
pack.info 与 .hml/.css 与 Linux 版一致**剥除**（真机实测约束，见 linux/README）。

## 使用

```bash
# 方式一：直接双击 index.html（file://）——可编译/下载，但 .bc 需本机快照服务或改走 http（file:// 禁止 fetch wasm）
# 方式二：起本地静态服务（推荐；需已按 BUILD.md §2 构建 vendor-wasm/ 才 .bc 全自足）
python3 -m http.server 8080 -d compiler/web
# 打开 http://localhost:8080/
```

把工程文件夹（含 `entry/src/main/config.json`）拖进页面，或点击按钮选文件夹/zip。
编译完点「下载 HAP」。产物未签名、含全部 bundle 产物，模拟器直接用；真机需要 `.bc`：
勾选「真机字节码 .bc」后在浏览器内用 **wasm 版 jerry-snapshot** 直接生成（JRRY v24，与 Linux 编译逐字节一致），
无需任何本地服务；也可在 Linux 端用 `node compiler/linux/bin/gt2-build.js <工程根> -o out.hap` 补字节码。

## 结构

| 路径 | 说明 |
|---|---|
| `index.html` / `css/style.css` / `js/ui.js` | 单页 UI：拖拽/选目录/选 zip → 编译 → 下载 |
| `js/web-core.js` | 浏览器主管线：内存文件树、HAP 组装、resources.index（Uint8Array）、加载 zip |
| `js/compiler-core.js` | 生成的浏览器核心（打包自 `linux/lib`，勿手改） |
| `build-core.js` | 重新生成 `compiler-core.js` 的脚本（`node build-core.js`） |
| `smoke.cjs` | 端到端验收：与 Linux 版 build/HAP 逐字节对比（node 模拟浏览器） |
| `vendor/` | babel / pako / jszip（复制自 linux/vendor） |
| `vendor-wasm/` | wasm 版 jerry-snapshot 产物（gitignore，克隆后按 **BUILD.md §2** 用 emsdk 构建） |
| `wasm/` | wasm 构建/验收脚本：`build-wasm.sh`、`verify-wasm.cjs`、`snapshot-wasm.md` |
| `local-snapshot-server.cjs` | 本地快照服务（127.0.0.1:8735，wasm 加载失败时的回退） |

## 与 Linux 版差异

- `.bc`：真机字节码（JRRY v24）由 jerry 快照工具生成。Web 版两种接入：
  1. **wasm（首选，浏览器自足）**：`vendor-wasm/` 需先按 `BUILD.md` §2 构建（emscripten 编的 jerry-snapshot）。
     注意：**每次快照必须新建 emscripten 实例**，同一实例重复 `main()` 会让 jerry 堆变脏、后续快照
     字面量表漂移（详见 `wasm/snapshot-wasm.md`「已知坑」）。`verify-wasm.cjs` 已验证 wasm 与原生
     产物逐字节一致（reader 3/3、devdemo 22/22）。
  2. **本机快照服务（回退）**：`node local-snapshot-server.cjs` 在 127.0.0.1:8735 跑原生 jerry。
     仅当 wasm 探测失败时兜底（如 `file://` 直接打开页面）。
- 无 fs：输入走拖拽/zip，输出走 Blob 下载；其余编译路径共用同一套逻辑根。
- 无签名：下载的是未签名 HAP（等价 Linux `NOSIGN=1`）。签名用 `scripts/sign-app-to-hap.js`（输入 `.app` 壳 + 调试 p7b）。

## 真机字节码 .bc

`js/jerry-wasm.js` 负责探测提供者（wasm → 本地服务 → 无），
`js/web-core.js::generateBc` 对已编译 bundle（app.js + 页面）逐文件快照并做 **JRRY v24** 铁律校验。
产物含 `.bc` 后即可沿 README 流程签名装机。

## 验收

```bash
node build-core.js              # 重新打包核心（改 linux/lib 后必须跑）
node smoke.cjs                  # 对 reader 工程：9/9 关键产物与 Linux 版逐字节一致
node wasm/verify-wasm.cjs       # wasm 版 *.bc 与原生 jerry 产物逐字节一致
node local-snapshot-server.cjs  # 起本地 .bc 快照服务（仅回退用）
```