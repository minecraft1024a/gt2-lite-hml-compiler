# GT2 轻智能手表 lite 编译器（纯本地 / 无 SDK 依赖）

逆向华为 GT2 轻智能（liteWearable，SDK API6）JS/HML 编译链路的自有实现。
对 `hmlitewearable_files` 工程（15 页 + app）产出与真 SDK 语义等价的未签名 HAP：

- `.js` = webpack4 风格 bundle（页面: helpers 0/1 + entry/render/styles/script/deps；app: 0/1 按需填 helper，无 helper 引用时数组带洞 `[,,entry,script,manifest]`）
- `.bc` = JerryScript **v24** 字节码快照（`JRRY 0x18`，校验失败直接报错）
- `common/*.bin` = PNG → BGRA 原始像素（8B 头 + `width|height<<16`）
- `resources.index` / 规范化 `config.json` = 与官方包字节级一致
- `pack.info` / .hml / .css **默认剥除**（真机实测约束：bin 含这三类会被拒装 103，SDK 真机构建也是编进 JS、不安装）

## 用法

```
node bin/gt2-build.js <工程根> -o out.hap [--app out.app] [--build buildDir]
```

工程根 = 含 `entry/src/main/config.json` 的 DevEco 2.x lite 工程。
输出未签名 HAP（等价 SDK `NOSIGN=1`）；`--build` 保留中间产物便于对照参考构建。

依赖：仅 `node`（jszip/pako/babel 已内置 vendor）+ 原生 `jerry-snapshot` v24 二进制
（`third_party/jerryscript/build/bin/jerry-snapshot`，可用 `--jerry <path>` 覆盖；与 SDK wine 版输出逐字节一致）。

## 管线库（lib/）

| 文件 | 作用 | 对齐依据 |
|---|---|---|
| `hml.js` | HML → render 函数（`_c/_l/_i`、事件键 `on`） | SDK ace-loader templater + oracle 逐字 |
| `css.js` | CSS → styleSheet（classSelectors/@keyframes/@import） | SDK transformStyle + oracle 逐字 |
| `expr.js` | `{{}}` 插值/bind 解析（babel 语义补 `this.` 前缀） | SDK content/bind |
| `bundle.js` | ES6 → ES5（SDK 等价 babel 配置）+ webpack4 bundle 组装 | 黄金参考 bundle 结构 |
| `png2bin.js` | PNG 解码（pako+反滤波）→ `00 01 00 00 + w/h + BGRA` | SDK lite-image2bin + 19/19 逐字节 |
| `jerry.js` | `.js` → `.bc`（v24 头校验，非 v24 判死） | 参考 `.bc` 逐字节 |
| `manifest.js` | config → manifest.json | build-lite-hap.sh python |
| `resources.js` | `resources.index` 二进制构建（字符串/媒体记录） | 官方包样本逆向 |
| `hap.js` | config 规范化 / jszip 打包 | build-lite-hap.sh python |
| `build.js` | 主编排：compileBuild → HAP 组装 | 参考构建 + 参考 HAP 逐文件 |

## 验收（全绿）

```
node test-all-pages.cjs     15/15  render + styleSheet 与 SDK oracle 逐字等价
node test-bundle-run.cjs    15/15  页面 bundle 在 VM 执行语义等价（data/方法/装配）
node test-app-bundle.cjs    3/3  app bundle：无 import 空洞保持 + 带 import helper 填充 + 仅箭头函数（VM 执行 + manifest 挂载）
node test-e2e-hap.cjs       30/30  build/HAP 与参考构建逐文件对比
node test-final-hap.cjs     17/17  产物 HAP 内全部 js 执行 + .bc 全 v24
```

验收对照基线（真 SDK 产物）：
- 参考构建：`/tmp/tmp.2s2eHN3Kax/build/`
- 未签名参考 HAP：`/tmp/opencode/ref-build.lock.hap`

关键实测结论（2026-10-31）：
- **bin 内禁止 pack.info / .hml / .css**：devdemo 剥掉这三类后装表成功（此前 142 条含
  21 hml + 22 css + pack.info 一律 103 拒装）；现编译器默认剥除。
- `common/*.bin` 是 **BGRA**（`data[idx+2], data[idx+1], data[idx+0], data[idx+3]` 写盘），
  灰阶图标 RGBA/BGRA 看不出差异——彩色图（exclamation/ifdian）与索引色（icon.png）是反例。
- 原生 Linux `jerry-snapshot` 对参考 app.js/index.js/viewer_dir.js 的输出与 SDK wine 版**逐字节相同**。
- `resources.index` 记录布局：`收 size + 类型码(9=字符串/0x13=媒体) + id + u16字符串×2`，
  字符串记录先值后键、媒体记录先路径后名；offsets 从 `0x9C+8n` 起。

## 浏览器版（规划）

编译核心（hml/css/expr/bundle/png2bin/manifest/resources）全部纯 JS，浏览器可直接复用；
`.bc` 快照需 WASM 化 jerry-snapshot（JerryScript 支持 Emscripten 构建）；fs/child_process
相关（hap/jerry/build 的 node 部分）改为内存态接口后即可并入。