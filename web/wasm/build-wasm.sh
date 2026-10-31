#!/usr/bin/env bash
# 把 jerry-snapshot（JRRY v24 快照工具）编译成浏览器可用的 WebAssembly。
#
# 原理：.bc = jerry 引擎把 JS 编译成 v24 字节码快照。v24 判死规则见 lib/jerry.js。
# linux 端跑的是原生 jerry-snapshot；wasm 端用同一份 jerry 源码、**同一套配置**编译，
# 快照字节对配置是确定的 → 产出应与原生逐字节一致（verify-wasm.cjs 验收）。
# 配置镜像来源：compiler/linux/third_party/jerryscript/build/CMakeCache.txt
#
# 依赖：emsdk（emcmake/emmake）。产物：web/vendor-wasm/jerry-snapshot.wasm(.js)
set -euo pipefail

JSRC="$(cd "$(dirname "$0")/../../linux/third_party/jerryscript" && pwd)"
OUT="$(cd "$(dirname "$0")/.." && pwd)/vendor-wasm"
mkdir -p "$OUT"
cd "$JSRC"

BUILD=build-wasm
rm -rf "$BUILD"

# MODULARIZE + callMain 等参数直接走 CMAKE_EXE_LINKER_FLAGS，交给 emcc 链接
# 注意：新版 emscripten 里 $print/$printErr 导出已废弃（会 -Werror 炸链接），所以不导出它们；
# 链接步仍可能继承 C 层的 -Werror，故补 -Wno-error=js-compiler / -Wno-error=deprecated。
LINK_FLAGS="-sMODULARIZE=1 -sEXPORT_NAME=createJerrySnapshot -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node -sEXPORTED_FUNCTIONS=_main,_malloc,_free -sEXPORTED_RUNTIME_METHODS=callMain,FS -Wno-error=js-compiler -Wno-error=deprecated"

emcmake cmake -S . -B "$BUILD" -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_C_FLAGS="-Wno-error -Wno-unused-function -Wno-unused-variable -Wno-deprecated-declarations" \
  -DCMAKE_C_FLAGS_RELEASE="-O3 -DNDEBUG -Wno-error=enum-enum-conversion" \
  -DCMAKE_EXE_LINKER_FLAGS="$LINK_FLAGS" \
  -DJERRY_PROFILE=es5.1 \
  -DJERRY_CMDLINE=ON \
  -DJERRY_CMDLINE_SNAPSHOT=ON \
  -DJERRY_CMDLINE_TEST=OFF \
  -DJERRY_EXT=ON \
  -DJERRY_LIBM=ON \
  -DJERRY_PORT_DEFAULT=ON \
  -DJERRY_GLOBAL_HEAP_SIZE=512 \
  -DJERRY_PARSER=ON \
  -DJERRY_SNAPSHOT_EXEC=OFF \
  -DJERRY_SNAPSHOT_SAVE=OFF \
  -DJERRY_LOGGING=OFF \
  -DJERRY_DEBUGGER=OFF \
  -DJERRY_ERROR_MESSAGES=OFF \
  -DJERRY_LINE_INFO=OFF \
  -DJERRY_MEM_STATS=OFF

emmake make -C "$BUILD" jerry-snapshot -j$(nproc)

# 产物从 build-wasm/bin 拷贝出去
cp "$BUILD"/bin/jerry-snapshot "$OUT/jerry-snapshot.wasm.js" 2>/dev/null \
  || cp "$BUILD"/bin/jerry-snapshot.js "$OUT/jerry-snapshot.wasm.js" 2>/dev/null
cp "$BUILD"/bin/jerry-snapshot.wasm "$OUT/jerry-snapshot.wasm"

echo "完成：$OUT/jerry-snapshot.wasm(.js)"
ls -la "$OUT"
echo "验收：node compiler/web/wasm/verify-wasm.cjs"