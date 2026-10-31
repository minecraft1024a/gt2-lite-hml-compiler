"use strict";
/**
 * PNG -> .bin 图片转换（对齐 SDK png2bin 产物，逐字节）
 * 格式（实锤自黄金参考 common/*.bin）：
 *   8 字节头：00 01 00 00（版本/标志）+ width(u16 LE) + height(u16 LE)
 *   然后原始 RGBA 像素流：逐行、行内 RGBABGBA……，无预乘，w*h*4 字节
 * PNG 解码用纯 JS（pako inflate + 反滤波 + 色彩展开），浏览器/node 通用
 */

function loadPako() {
  if (typeof globalThis !== 'undefined' && globalThis.pako) return globalThis.pako;
  try { return require('../vendor/pako.min.js'); }
  catch (e) {
    try { return require('pako'); }
    catch (e2) { throw new Error('无法加载 pako（PNG 解码需要）：' + e2.message); }
  }
}
let _pako = null;
function pako() { if (!_pako) _pako = loadPako(); return _pako; }

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 解析 PNG，返回 {width, height, rgba: Uint8Array}（8 位 RGBA 逐行） */
function decodePNG(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8.length < 8 || !PNG_SIG.every((b, i) => u8[i] === b)) {
    throw new Error('不是合法的 PNG 文件');
  }
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (off + 8 <= u8.length) {
    const len = readU32(u8, off);
    const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
    const body = u8.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = readU32(body, 0);
      height = readU32(body, 4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
      if (bitDepth === 16) throw new Error('不支持 16 位深度 PNG');
      if (interlace !== 0) throw new Error('不支持 Adam7 隔行 PNG');
    } else if (type === 'PLTE') {
      palette = Array.from(body);
    } else if (type === 'tRNS') {
      trns = Array.from(body);
    } else if (type === 'IDAT') {
      idat.push(u8.subarray(off + 8, off + 8 + len));
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (!width || !height) throw new Error('PNG 缺少 IHDR');
  if (!idat.length) throw new Error('PNG 缺少 IDAT');

  // 汇聚 IDAT -> zlib 解压 -> 原始扫描行（含滤波器字节）
  const zl = pako().inflate(concatBytes(idat));
  const bpp = bytesPerPixel(colorType); // 未按位深换算：扫描行滤波器按字节口径
  const filterBpp = Math.max(1, (bpp * bitDepth) >> 3 || 1);
  const stride = Math.ceil((width * bpp * bitDepth) / 8) + 1; // +1 滤波器类型字节
  if (zl.length < stride * height) throw new Error('PNG 数据不完整');

  // 反滤波得到各通道原始字节
  const raw = new Uint8Array(stride * height);
  // 上一行的像素字节长
  const prevStride = stride - 1;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const ft = zl[row];
    for (let x = 0; x < prevStride; x++) {
      const idx = row + 1 + x;
      const left = x >= filterBpp ? raw[idx - filterBpp] : 0;
      const up = y > 0 ? raw[idx - stride] : 0;
      const upLeft = (y > 0 && x >= filterBpp) ? raw[idx - stride - filterBpp] : 0;
      let v = zl[idx];
      if (ft === 1) v = (v + left) & 0xff;
      else if (ft === 2) v = (v + up) & 0xff;
      else if (ft === 3) v = (v + ((left + up) >> 1)) & 0xff;
      else if (ft === 4) v = (v + paeth(left, up, upLeft)) & 0xff;
      raw[idx] = v;
    }
  }

  // 色彩展开 -> RGBA
  const rgba = expandToRGBA(raw, width, height, bitDepth, colorType, palette, trns);
  return { width, height, rgba };
}

function bytesPerPixel(colorType) {
  switch (colorType) {
    case 0: return 1;
    case 2: return 3;
    case 3: return 1;
    case 4: return 2;
    case 6: return 4;
    default: throw new Error('不支持的色彩类型 ' + colorType);
  }
}

function expandToRGBA(raw, w, h, bitDepth, colorType, palette, trns) {
  const out = new Uint8Array(w * h * 4);
  // raw 缓冲区每行含 1 字节滤波器头：行步长 +1
  const rawStride = Math.ceil((w * bytesPerPixel(colorType) * bitDepth) / 8) + 1;
  // 用于位深 < 8 的按像素位拆解
  const samplesPerByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;

  function sampleBytes(bytes, x, ch) {
    // 返回字节数组（1（位数<8）或 bitDepth/8（8 位））
    const chStride = bytesPerPixel(colorType);
    if (bitDepth === 8) {
      return bytes[1 + x * chStride + ch]; // 跳过滤波器字节
    }
    // bitDepth 1/2/4：每字节 samplesPerByte 个样本
    const idx = Math.floor(x / samplesPerByte);
    const shift = 8 - ((x % samplesPerByte) + 1) * bitDepth;
    return (bytes[1 + idx] >> shift) & mask;
  }

  const scale = bitDepth === 8 ? 1 : (255 / mask);
  for (let y = 0; y < h; y++) {
    const row = y * rawStride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (colorType === 6) { // RGBA
        const i = row + 1 + x * 4;
        out[o] = raw[i]; out[o + 1] = raw[i + 1]; out[o + 2] = raw[i + 2]; out[o + 3] = raw[i + 3];
      } else if (colorType === 2) { // 真彩 RGB
        const i = row + 1 + x * 3;
        out[o] = raw[i]; out[o + 1] = raw[i + 1]; out[o + 2] = raw[i + 2]; out[o + 3] = 255;
      } else if (colorType === 4) { // 灰度+alpha
        const i = row + 1 + x * 2;
        out[o] = raw[i]; out[o + 1] = raw[i]; out[o + 2] = raw[i]; out[o + 3] = raw[i + 1];
      } else if (colorType === 0) { // 灰度
        const v = Math.round(sampleBytes(raw.subarray(row), x, 0) * scale);
        out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
      } else if (colorType === 3) { // 调色板
        const idx = sampleBytes(raw.subarray(row), x, 0);
        if (!palette) throw new Error('PNG 缺 PLTE');
        const pi = idx * 3;
        out[o] = palette[pi]; out[o + 1] = palette[pi + 1]; out[o + 2] = palette[pi + 2];
        // tRNS 可提供调色板 alpha（可含 1/2 位透明表）
        if (trns) {
          if (trns.length <= idx) out[o + 3] = 255;         // 后续缺省全不透明
          else if (trns.length >= idx + 1) out[o + 3] = trns[idx];
        } else out[o + 3] = 255;
      }
    }
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readU32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }

function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/**
 * PNG 字节 -> .bin 字节（对齐 SDK lite-image2bin.js，逐字节）
 *   头 8 字节：
 *     u32 LE @0 = 256            (00 01 00 00)
 *     u32 LE @4 = width | (height<<16)
 *   像素：BGRA 顺序（Jimp bitmap.data 为 RGBA，SDK 反转为 B,G,R,A 写盘）
 * @param {Uint8Array|Buffer|string} pngData PNG 文件字节
 * @returns {Uint8Array}
 */
function pngToBin(pngData) {
  const { width, height, rgba } = decodePNG(pngData);
  const bin = new Uint8Array(8 + width * height * 4);
  bin[0] = 0x00; bin[1] = 0x01; bin[2] = 0x00; bin[3] = 0x00;
  const wh = width + (height << 16);
  bin[4] = wh & 0xff; bin[5] = (wh >> 8) & 0xff;
  bin[6] = (wh >> 16) & 0xff; bin[7] = (wh >> 24) & 0xff;
  // BGRA（对照 SDK: idx+2=B, idx+1=G, idx+0=R, idx+3=A）
  for (let i = 0, o = 8; i < rgba.length; i += 4, o += 4) {
    bin[o] = rgba[i + 2];
    bin[o + 1] = rgba[i + 1];
    bin[o + 2] = rgba[i];
    bin[o + 3] = rgba[i + 3];
  }
  return bin;
}

// 供 node 文件路径便捷调用
function pngFileToBin(pngPath) {
  const fs = require('fs');
  return pngToBin(fs.readFileSync(pngPath));
}

module.exports = { pngToBin, pngFileToBin, decodePNG };