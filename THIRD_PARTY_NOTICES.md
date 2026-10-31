# 第三方代码致谢 / Third-Party Notices

本仓库包含/派生自下列开源项目；并逆向参考了华为官方编译器管线。各自的权利与许可归原所有者，使用时请遵守其条款。

## 华为 / HUAWEI HarmonyOS SDK（原编译器参考，非分发）

- 项目：HUAWEI DevEco Studio / HarmonyOS SDK API6（2.2.0）lite JS 编译管线
  （`ace-loader` webpack 管线 + `jerry-snapshot` v24 + png→bin 媒体转换）
- 权益：版权归 **华为 HUAWEI** 所有
- 关系：本仓库 `compiler/` 是参照该官方管线输出做的**独立重实现**——不依赖 SDK/wine，
  但把官方真机构建产物作为 oracle 做逐字节等价验收（HML/CSS 逐字、png→bin 逐字节、
  HAP 逐文件）。官方 SDK 二进制/代码**不在本仓库分发**（`sdk/` 位于上级 gt2-hap-sideload 工程，仅供本机参考）。
- SDK 来源：腾讯 QQ 群文件「签名用的 SDK API6~7 本地签名工具」（2025-10）。

## JerryScript

- 项目：https://github.com/jerryscript-project/jerryscript
- 作者/组织：**JS Foundation** 及贡献者（http://js.foundation）
- 许可：**Apache License 2.0**（完整文本见 `linux/third_party/jerryscript/LICENSE`）
- 版本：API v2.1.0（`JERRY_SNAPSHOT_VERSION = 24u`，即 SDK 真机 `.bc` 铁律的 v24）
- 用途：以**原样** vendoring 于 `linux/third_party/jerryscript/`。仅调用其 `jerry-snapshot`
  工具把页面/应用 JS 编译成真机 JRRY v24 字节码快照（Linux 原生二进制 + 浏览器端 wasm 版，二者

  同一份源码、同一套编译配置，产物逐字节一致）。未修改其 C 源码，仓库不包含其构建产物
  （`build/`、`build-wasm/`，重建见 [BUILD.md](BUILD.md)）。

## Babel（@babel/standalone）

- 项目：https://github.com/babel/babel
- 作者/组织：**Babel 团队**
- 许可：**MIT License**（https://github.com/babel/babel/blob/main/LICENSE）
- 版本：8.0.10（自 `babel.min.js` 的 `e.version` 读出）
- 用途：vendored 于 `linux/vendor/babel.min.js` 与 `web/vendor/babel.min.js`，用于
  ES6→ES5 转译，产出与 SDK 语义等价的 webpack4 风格 bundle。

## JSZip

- 项目：https://github.com/Stuk/jszip
- 作者：**Stuart Knightley**（及贡献者）
- 许可：**MIT / GPLv3** 双许可（本仓库按 MIT 条款使用）
  https://github.com/Stuk/jszip/blob/main/LICENSE.markdown
- 版本：v3.10.2
- 用途：vendored 于 `linux/vendor/jszip.min.js` 与 `web/vendor/jszip.min.js`，用于
  HAP 的 zip 组装/解包。

## pako

- 项目：https://github.com/nodeca/pako
- 作者/组织：**Andrey Sitnik / Vitaly Puzrin / Nodeca 项目**
- 许可：**MIT License**（https://github.com/nodeca/pako/blob/main/LICENSE）
- 版本：npm `pako`（1.x，BUILD 内嵌）
- 用途：vendored 于 `linux/vendor/pako.min.js` 与 `web/vendor/pako.min.js`，用于
  PNG 解压（png2bin）及 zip 流；JSZip 自身亦依赖 pako。

> 各 vendored 产物版权归其原作者/项目所有，本仓库作者仅做分发与集成，不声明对上述
> 第三方代码的著作权。若有遗漏或需要补充原作者署名，欢迎提 issue。