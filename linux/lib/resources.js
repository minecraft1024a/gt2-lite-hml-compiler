"use strict";
/**
 * resources.index 自产（对齐 build-lite-hap.sh 第 3 步 python，逐字节）
 * 格式实测：IDSS 表 = magic+count+{id,绝对偏移}×n；记录 = {rest_size, 类型码, id, u16字符串×2}
 *   类型码：字符串=9（先值后键），媒体=0x13（先路径后名）
 */

const w16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; };
const w32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v, 0); return b; };

/**
 * 解析字符串引用与 string.json 值（label 可能为 $string:appName）
 * @param {string} labelRef   abilities[0].label
 * @param {object} stringJson 已解析的 string.json（含 string[]）
 * @returns {{key: string, value: string}}
 */
function resolveStringLabel(labelRef, stringJson) {
  const skey = labelRef && labelRef.startsWith('$string:') ? labelRef.slice('$string:'.length) : 'appName';
  let sval = labelRef || '';
  if (stringJson && Array.isArray(stringJson.string)) {
    for (const it of stringJson.string) {
      if (it.name === skey) { sval = it.value !== undefined ? it.value : sval; break; }
    }
  }
  return { key: skey, value: sval };
}

/**
 * 构建 resources.index 二进制（逐字节对齐 SDK 参考产物）
 * @param {string} labelRef     abilities[0].label（如 "$string:appName"）
 * @param {object} stringJson   已解析 string.json
 * @param {string[]} mediaStems 媒体文件名（无扩展名），icon 恒排第一
 * @returns {Buffer}
 */
function buildResourcesIndex(labelRef, stringJson, mediaStems) {
  const records = []; // {id, bytes}
  // 1) 字符串资源记录（id=0x01000000，先值后键）
  const { key, value } = resolveStringLabel(labelRef, stringJson);
  const v = Buffer.from(value, 'utf8');
  const k = Buffer.from(key, 'utf8');
  const sbody = Buffer.alloc(4 + 4 + 2 + v.length + 1 + 2 + k.length + 1);
  sbody.writeUInt32LE(9, 0);                       // 类型码 9 = 字符串
  sbody.writeUInt32LE(0x01000000, 4);              // 资源 id（字符串固定 0x01000000）
  sbody.writeUInt16LE(v.length + 1, 8);
  v.copy(sbody, 10);
  sbody[10 + v.length] = 0;
  const kl = 10 + v.length + 1;
  sbody.writeUInt16LE(k.length + 1, kl);
  k.copy(sbody, kl + 2);
  sbody[kl + 2 + k.length] = 0;
  records.push({ id: 0x01000000, bytes: Buffer.concat([w32(sbody.length), sbody]) });

  // 2) 媒体资源记录（id 从 0x01000001 起，先路径后名）
  let rid = 0x01000001;
  for (const stem of mediaStems) {
    const p = Buffer.from(`entry/resources/base/media/${stem}.png`, 'utf8');
    const n = Buffer.from(stem, 'utf8');
    const body = Buffer.alloc(4 + 4 + 2 + p.length + 1 + 2 + n.length + 1);
    body.writeUInt32LE(0x13, 0);                   // 类型码 0x13 = 媒体
    body.writeUInt32LE(rid, 4);
    body.writeUInt16LE(p.length + 1, 8);
    p.copy(body, 10);
    body[10 + p.length] = 0;
    const nl = 10 + p.length + 1;
    body.writeUInt16LE(n.length + 1, nl);
    n.copy(body, nl + 2);
    body[nl + 2 + n.length] = 0;
    records.push({ id: rid, bytes: Buffer.concat([w32(body.length), body]) });
    rid += 1;
  }

  // 3) 组装 IDSS 外表
  const REC_BASE = 0x9C + 8 * records.length;
  let cur = REC_BASE;
  const offs = records.map((r) => { const o = cur; cur += r.bytes.length; return o; });
  const entries = Buffer.concat(
    records.map((r, i) => Buffer.concat([w32(r.id), w32(offs[i])]))
  );

  let idx = Buffer.concat([Buffer.from('Restool 1.022', 'ascii'), Buffer.alloc(0x80 - 13)]);
  let payload = Buffer.concat([Buffer.from('KEYS', 'ascii'), w32(0x94), w32(0)]);
  payload = Buffer.concat([
    payload,
    Buffer.from('IDSS', 'ascii'),
    w32(records.length),
    entries,
    Buffer.concat(records.map((r) => r.bytes)),
  ]);
  idx = Buffer.concat([
    idx,
    w32(0x80 + 4 + 4 + payload.length),
    w32(1),
    payload,
  ]);
  return idx;
}

module.exports = { buildResourcesIndex, resolveStringLabel };