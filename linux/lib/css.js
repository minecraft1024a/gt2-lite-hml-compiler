"use strict";
/**
 * CSS 编译：CSS 源码(+@import) -> styleSheet JSON 字符串
 * 逆向自 SDK ace-loader lib/styler/{index,lib/validator,lib/util}.js
 *          + lib/lite/lite-transform-style.js
 */
const SPECIAL_STYLE = {
  ANIMATION_DELAY: 'animationDelay', ANIMATION_DURATION: 'animationDuration',
  ANIMATION_ITERATION_COUNT: 'animationIterationCount',
  BACKGROUND_IMAGE: 'backgroundImage', BACKGROUND_IMAGE_ACTIVE: 'backgroundImage:active',
  BACKGROUND_IMAGE_CHECKED: 'backgroundImage:checked',
};
const REGEXP_NUMBER_PX = /^[-+]?[0-9]*\.?[0-9]+(px|cm|em|deg|rad)?$/;
const REGEXP_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const REGEXP_UNIT = /px|cm|em|deg|rad/;
const REGXP_QUOTES = /["']/g;
const LENGTH_REGEXP = /^[-+]?\d*\.?\d+(\S*)$/;

// 颜色关键字（EXTENDED_COLOR_KEYWORDS 子集常用；整表太大，取关键 + 兜底 name 正则）
const COLOR_KEYWORDS = {
  black:'#000000',silver:'#C0C0C0',gray:'#808080',white:'#FFFFFF',maroon:'#800000',red:'#FF0000',
  purple:'#800080',fuchsia:'#FF00FF',green:'#008000',lime:'#00FF00',olive:'#808000',yellow:'#FFFF00',
  navy:'#000080',blue:'#0000FF',teal:'#008080',aqua:'#00FFFF',orange:'#FFA500',pink:'#FFC0CB',
  brown:'#A52A2A',gold:'#FFD700',cyan:'#00FFFF',grey:'#808080',darkgrey:'#A9A9A9',darkgray:'#A9A9A9',
  transparent:'rgba(0,0,0,0)',
};

// —— 值归一化（lite 语义） ——
function normalizeValue(prop, value) {
  const v = String(value).trim();
  if (!v) return null;
  // 数字类：opacity、zIndex、flexWeight、number
  if (/^[-+]?\d*\.?\d+$/.test(v)) {
    // 纯数字，交给 styleFormat（rule4 Number），这里原样返回（除非 iteratorCount）
    return v;
  }
  // 纯色或颜色类属性
  if (/color|background|fill|shadow|indicator/i.test(prop)) {
    if (REGEXP_COLOR.test(v)) {
      // #3 -> #6
      if (/^#[0-9a-fA-F]{3}$/.test(v)) {
        return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
      }
      return v;
    }
    if (/^#([0-9a-fA-F]{8})$/.test(v)) return v;
    const kw = COLOR_KEYWORDS[v.toLowerCase()];
    if (kw) return kw;
    const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i);
    if (rgb) {
      const a = rgb[4] !== undefined ? ',' + rgb[4] : '';
      return 'rgb' + (rgb[4] !== undefined ? 'a' : '') + '(' + rgb[1] + ',' + rgb[2] + ',' + rgb[3] + a + ')';
    }
    return v; // 保持原样（url 等）
  }
  // url(...) 路径
  if (/^url\(/.test(v)) return v;
  // 长度类：带单位保留，无单位的数字在前面已拦（无单位会被 styleFormat Number），带未知单位走原样
  if (/^[-+]?\d*\.?\d+(px|pt|fp|vp|cm|em|%|deg|rad|ms|s|'")/.test(v)) return v;
  return v;
}

// 简写展开：margin/padding/borderWidth/borderColor
function expandShorthand(prop, value) {
  const parts = String(value).split(/\s+/).filter(Boolean);
  let base, kind;
  if (prop === 'borderWidth' || prop === 'borderColor') { base = 'border'; kind = prop.replace('border', ''); }
  else { base = prop; kind = ''; }
  const sides = [base + 'Top' + kind, base + 'Right' + kind, base + 'Bottom' + kind, base + 'Left' + kind];
  const out = {};
  if (parts.length === 1) for (const s of sides) out[s] = parts[0];
  else if (parts.length === 2) { out[sides[0]] = parts[0]; out[sides[1]] = parts[1]; out[sides[2]] = parts[0]; out[sides[3]] = parts[1]; }
  else if (parts.length === 3) { out[sides[0]] = parts[0]; out[sides[1]] = parts[1]; out[sides[2]] = parts[2]; out[sides[3]] = parts[1]; }
  else { for (let i = 0; i < 4; i++) out[sides[i]] = parts[i] || ''; }
  for (const k of Object.keys(out)) out[k] = normalizeValue(prop, out[k]) || out[k];
  return out;
}

// 剥离 CSS 注释（保留引号内内容）
function stripComments(src) {
  let out = '', i = 0, n = src.length, quote = null;
  while (i < n) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// flex 简写展开（flexExpand 复刻）
function expandFlexDecls(decls) {
  const out = [];
  for (const d of decls) {
    if (d.prop !== 'flex' || d.value.toLowerCase() === 'none') { out.push(d); continue; }
    const vals = d.value.trim().split(/\s+/);
    if (vals.length === 1) {
      if (['auto','initial'].includes(vals[0].toLowerCase())) { out.push({ prop: 'flex', value: vals[0] }); }
      else if (/.*px$/.test(vals[0])) out.push({ prop: 'flexBasis', value: vals[0] });
      else out.push({ prop: 'flexGrow', value: vals[0] });
    } else if (vals.length === 2) {
      out.push({ prop: 'flexGrow', value: vals[0] });
      out.push({ prop: /px$/.test(vals[1]) ? 'flexBasis' : 'flexShrink', value: vals[1] });
    } else {
      out.push({ prop: 'flexGrow', value: vals[0] }, { prop: 'flexShrink', value: vals[1] }, { prop: 'flexBasis', value: vals[2] });
    }
  }
  return out;
}

function camelCase(name) { return name.replace(/-([a-z])/g, (m, ch) => ch.toUpperCase()); }

// —— 顶层 CSS 结构解析 ——
function splitTopLevel(src) {
  // 返回 [{type:'rule', selector, body} | {type:'import', path} | {type:'keyframes', name, blocks:[{selector, body}]}]
  const out = [];
  let i = 0;
  const n = src.length;
  let stmt = '';  // 累积 prelude（到 { 或 ;）
  // 简化：直接扫描花括号块
  while (i < n) {
    let ch = src[i];
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === '@' && /import/i.test(src.slice(i, i + 7))) {
      // @import "x" or url("x") ;
      const semi = src.indexOf(';', i);
      if (semi === -1) break;
      const imp = src.slice(i + 7, semi).trim();
      const m = imp.match(/["']([^"']+)["']/) || imp.match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
      if (m) out.push({ type: 'import', path: m[1].replace(/^['"]|['"]$/g, '') });
      i = semi + 1;
      continue;
    }
    if (ch === '@') {
      // @keyframes name { ... }
      const brace = src.indexOf('{', i);
      if (brace === -1) break;
      let depth = 1, j = brace + 1;
      while (j < n && depth > 0) {
        const c2 = src[j];
        if (c2 === '{') depth++;
        else if (c2 === '}') depth--;
        j++;
      }
      const prelude = src.slice(i + 1, brace).trim();
      const body = src.slice(brace + 1, j - 1);
      out.push({ type: 'atrule', prelude, body });
      i = j;
      continue;
    }
    const brace = src.indexOf('{', i);
    if (brace === -1) break;
    let depth = 1, k = brace + 1;
    while (k < n && depth > 0) {
      const c2 = src[k];
      if (c2 === '{') depth++;
      else if (c2 === '}') depth--;
      k++;
    }
    const selector = src.slice(i, brace).trim();
    const body = src.slice(brace + 1, k - 1);
    out.push({ type: 'rule', selector, body });
    i = k;
  }
  return out;
}

function parseDeclarationBlock(body) {
  // 解析 "prop: value; prop2: value2"（处理引号/括号内分号）
  const decls = [];
  let i = 0;
  const n = body.length;
  while (i < n) {
    while (i < n && /\s/.test(body[i])) i++;
    if (i >= n) break;
    // 找到声明结束的 ';'（忽略括号/引号内）
    let j = i, paren = 0, quote = null;
    while (j < n) {
      const c = body[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '(') paren++;
      else if (c === ')') paren--;
      else if (c === ';' && paren === 0) break;
      j++;
    }
    const decl = body.slice(i, j).trim();
    i = j + 1;
    const colon = decl.indexOf(':');
    if (colon > 0) {
      const prop = camelCase(decl.slice(0, colon).trim());
      const val = decl.slice(colon + 1).trim();
      if (prop) decls.push({ prop, value: val });
    }
  }
  return decls;
}

/**
 * 主入口
 * @param css 源码
 * @param resolveImport (relPath) => cssString | null
 * @returns {classSelectors, idSelectors, '@keyframes'?}  styleSheet 对象
 */
function compileCss(cssSource, resolveImport) {
  const root = {};
  parseInto(root, cssSource, resolveImport || (() => null));
  return buildStyleSheet(root);
}

function parseInto(acc, cssSrc, resolveImport, seen) {
  seen = seen || new Set();
  const parts = splitTopLevel(stripComments(cssSrc));
  for (const p of parts) {
    if (p.type === 'import') {
      let src = null;
      try { src = resolveImport(p.path); } catch (e) { src = null; }
      if (typeof src === 'string' && !seen.has(p.path)) {
        seen.add(p.path);
        parseInto(acc, src, resolveImport, seen);
      }
      continue;
    }
    if (p.type === 'atrule' && /^keyframes/i.test(p.prelude)) {
      const name = p.prelude.replace(/keyframes\s*/i, '').trim();
      const arr = acc['@KEYFRAMES'] = acc['@KEYFRAMES'] || {};
      const frames = arr[name] = arr[name] || [];
      const inner = parseKeyframesBlocks(p.body);
      for (const f of inner) frames.push(f);
      continue;
    }
    if (p.type === 'rule') {
      // 处理注释中的 selector（已在外层剥）
      const selectors = p.selector.split(',');
      const decls = expandFlexDecls(parseDeclarationBlock(p.body));
      // 应用到每个 selector（伪类处理属性后缀）
      for (let sel of selectors) {
        sel = sel.trim();
        if (!sel) continue;
        // 从属性中为每个类别构建对象
        const obj = {};
        for (const d of decls) {
          const prop = d.prop;
          if (['margin', 'padding', 'borderWidth', 'borderColor'].includes(prop)) {
            const exp = expandShorthand(prop, d.value);
            for (const k of Object.keys(exp)) obj[k] = exp[k];
          } else {
            obj[prop] = normalizeValue(prop, d.value) || d.value;
          }
        }
        // 伪类后缀
        const ci = sel.indexOf(':');
        let baseSel = sel, pseudo = '';
        if (ci > -1) { pseudo = sel.slice(ci); baseSel = sel.slice(0, ci); }
        let target = obj;
        if (pseudo) {
          const s2 = {};
          for (const k of Object.keys(obj)) s2[k + pseudo] = obj[k];
          target = s2;
        }
        const top = acc[baseSel] = acc[baseSel] || {};
        for (const k of Object.keys(target)) top[k] = target[k];
      }
    }
  }
}

function parseKeyframesBlocks(body) {
  // body: "from {...} to {...} 50% {...}"
  const frames = [];
  const parts = splitTopLevel('x{' + body + '}').filter(b => b.type === 'rule' && b.selector !== 'x');
  for (const p of parts) {
    const sel = p.selector.trim();
    const decls = parseDeclarationBlock(p.body);
    let time;
    if (sel === 'from') time = 0;
    else if (sel === 'to') time = 100;
    else if (/^(100|[1-9]?\d)%$/.test(sel)) time = Number(sel.replace('%', ''));
    else continue;
    const frame = { time };
    for (const d of decls) {
      let val = normalizeValue(d.prop, d.value) || d.value;
      if (REGEXP_COLOR.test(val)) val = parseInt(val.slice(1), 16);
      try { frame[d.prop] = JSON.parse(val); } catch (e) { frame[d.prop] = val; }
    }
    frames.push(frame);
  }
  return frames;
}

// —— styleFormat（lite-transform-style） ——
function styleFormatValues(styleObj) {
  const out = {};
  for (const key of Object.keys(styleObj)) {
    const v = styleObj[key];
    if (key === SPECIAL_STYLE.ANIMATION_DELAY || key === SPECIAL_STYLE.ANIMATION_DURATION) {
      out[key] = v;
    } else if (key === SPECIAL_STYLE.ANIMATION_ITERATION_COUNT) {
      out[key] = String(Number(v) === -1 ? 'infinite' : v);
    } else if (key.startsWith('backgroundImage')) {
      out[key] = String(v).replace(REGXP_QUOTES, '');
    } else if (typeof v === 'string') {
      if (!isNaN(Number(v))) out[key] = Number(v);
      else if (REGEXP_NUMBER_PX.test(v)) out[key] = parseInt(v.replace(REGEXP_UNIT, ''), 10);
      else if (REGEXP_COLOR.test(v)) out[key] = parseInt(v.slice(1), 16);
      else out[key] = v;
    } else {
      out[key] = v;
    }
  }
  return out;
}

function buildStyleSheet(root) {
  const sheet = {};
  const classes = {}, ids = {}, keyframes = {};
  for (const key of Object.keys(root)) {
    if (key === '@KEYFRAMES') continue;
    if (key.charAt(0) === '#') ids[key.slice(1)] = styleFormatValues(root[key]);
    else if (key.charAt(0) === '.') classes[key.slice(1)] = styleFormatValues(root[key]);
  }
  if (Object.keys(classes).length) sheet.classSelectors = classes;
  if (Object.keys(ids).length) sheet.idSelectors = ids;
  if (Object.keys(keyframes).length || root['@KEYFRAMES']) {
    const kf = root['@KEYFRAMES'];
    if (kf) sheet['@keyframes'] = kf;
  }
  return sheet;
}

module.exports = { compileCss, splitTopLevel, parseDeclarationBlock, normalizeValue, expandShorthand };