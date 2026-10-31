"use strict";
/**
 * HML 编译：HML 源码 -> render 渲染函数字符串
 * 逆向自 SDK ace-loader lib/templater/{index,component_validator,bind,content}.js
 *          + lib/lite/lite-transform-template.js + lib/lite/lite-enum.js
 * 输出形态与 SDK 管线一致（vm 变量名直接使用官方 mangle 后形态 e）:
 *   function (t) { var e = t || this; return _c('div',{...},[...]) }
 */
const expr = require('./expr');

// ---- 常量（对齐 lite-enum.js / transform-template） ----
const SPECIAL_STYLE = {
  OPACITY: 'opacity',
  ANIMATION_DELAY: 'animationDelay',
  ANIMATION_DURATION: 'animationDuration',
  ANIMATION_ITERATION_COUNT: 'animationIterationCount',
  BACKGROUND_IMAGE: 'backgroundImage',
  BACKGROUND_IMAGE_ACTIVE: 'backgroundImage:active',
  BACKGROUND_IMAGE_CHECKED: 'backgroundImage:checked',
};
const REGEXP_NUMBER_PX = /^[-+]?[0-9]*\.?[0-9]+(px|cm|em|deg|rad)?$/;
const REGEXP_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const REGEXP_UNIT = /px|cm|em|deg|rad/;
const REGXP_QUOTES = /["']/g;
const EVENT_START_REGEXP = /^(on:|on|@|grab:)/;
const EVENT_END_REGEXP = /(\.bubble|\.capture)$/;
const REG_EVENT = /([^(]*)\((.+)\)/;
const DATA_BINDING_REG = /{{{(.|\n)+?}}}|{{(.|\n)+?}}/;
const REG_FOR_PAREN = /^\s*\((.*)\s*,\s*(.*)\)\s*$/;
const ATTRBUTES = 'attrs', EVENTS_ON = 'on', KEY = 'key';

// ---- 编译上下文：for 变量作用域 ----
class Compiler {
  constructor() { this.paramStack = []; }
  // 表达式体：for 变量还原为局部名，其余 this.x -> e.x
  resolveBody(body) {
    let s = body;
    for (const p of this.paramStack) {
      for (const name of [p.key, p.value]) {
        if (!name) continue;
        const esc = name.charAt(0) === '$' ? '\\' : '';
        s = s.replace(new RegExp('this\\.' + esc + name + '\\b', 'g'), name);
      }
    }
    return s.replace(/this\./g, 'e.');
  }
  isParam(name) {
    for (const p of this.paramStack) {
      if (p.key === name || p.value === name) return true;
    }
    return false;
  }
}

// ---- 值字面量（checkType 复刻） ----
function checkType(v) {
  if (typeof v === 'function' || v === undefined) return formatForFunc(v);
  if (v === null) return 'null';
  if (typeof v !== 'string') return JSON.stringify(v);
  if (isNaN(Number(v))) {
    if (REGEXP_NUMBER_PX.test(v)) return String(parseInt(v.replace(REGEXP_UNIT, ''), 10));
    if (REGEXP_COLOR.test(v)) return String(parseInt(v.slice(1), 16));
    if (v === 'true') return 'true';
    if (v !== 'false') return JSON.stringify(v);
    return 'false';
  }
  return String(Number(v));
}
// validateAttr 对 value 属性的转义解释（对齐 SDK transArray，替换顺序关键）：
//   \a \b \f \n \r \t \v   -> 控制字符(a 仅去斜杠)   \\ -> \   \' -> '  \" -> "  \0 -> NUL
const VALUE_TRANSFORM = [
  [/\\a/g, 'a'], [/\\b/g, '\b'], [/\\f/g, '\f'], [/\\n/g, '\n'], [/\\r/g, '\r'],
  [/\\t/g, '\t'], [/\\v/g, '\v'], [/\\\\/g, '\\'], [/\\'/g, "'"], [/\\"/g, '"'], [/\\0/g, '\0'],
];
function unescapeTextValue(s) {
  for (const [re, rep] of VALUE_TRANSFORM) s = s.replace(re, rep);
  return s;
}
// 字符串函数字体 -> 函数字符串（event 用）
function formatAsFuncString(compiler, body) {
  return 'function (evt) {' + compiler.resolveBody(body) + '}';
}

// ---- 绑定表达式编译 ----
// 返回: {static:true, text}（无绑定）或 {body:"this.x + decodeURI('px')"}（有绑定）
function compileBinding(value) {
  return expr.compileExpr(value, false);
}

// ---- HML 解析（轻量 DOM） ----
// 结束标签处理对齐 parse5 错误恢复：
//   - name == myTag   -> 正常关闭当前元素
//   - name 属于祖先    -> 恢复性关闭（隐式关闭当前元素）
//   - 其余（杂散结束标签）-> 忽略并继续
function parseHML(source) {
  const root = { tag: '', attrs: [], children: [] };
  _parse(root, source, 0, '', []);
  return root;
}
function _parse(parent, src, pos, myTag, ancestors) {
  ancestors = ancestors || [];
  const textBuf = [];
  let i = pos;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { if (src.slice(i).trim()) textBuf.push(src.slice(i)); break; }
    if (src.slice(i, lt).trim()) textBuf.push(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end === -1) break;
      i = end + 3; continue;
    }
    if (src.startsWith('</', lt)) {
      const gt = src.indexOf('>', lt);
      if (gt === -1) break;
      const name = src.slice(lt + 2, gt).trim();
      if (name === myTag || ancestors.indexOf(name) !== -1) {
        if (textBuf.length) { parent.text = textBuf.join(' '); textBuf.length = 0; }
        return gt + 1;
      }
      i = gt + 1; // 杂散结束标签：忽略（parse5 错误恢复）
      continue;
    }
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt);
      if (end === -1) break;
      i = end + 1; continue;
    }
    const open = _parseOpenTag(src, lt);
    if (open.selfClosing) {
      parent.children.push(open.node);
      i = open.end;
    } else {
      if (textBuf.length) { open.node.text = textBuf.join(' '); textBuf.length = 0; }
      parent.children.push(open.node);
      const childAncestors = myTag ? ancestors.concat(myTag) : ancestors;
      i = _parse(open.node, src, open.end, open.node.tag, childAncestors);
    }
  }
  if (parent.text === undefined && textBuf.length) parent.text = textBuf.join(' ');
  return src.length;
}
function _parseOpenTag(src, lt) {
  let quote = null, gt = -1, selfClosing = false;
  for (let i = lt + 1; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"') { quote = '"'; continue; }
    if (ch === "'") { quote = "'"; continue; }
    if (ch === '/' && src[i + 1] === '>') { gt = i; selfClosing = true; break; }
    if (ch === '>') { gt = i; break; }
  }
  if (gt === -1) throw new Error('HML 标签未闭合: ' + src.slice(lt, lt + 64));
  const inner = src.slice(lt + 1, gt).trim();
  const sp = inner.search(/\s/);
  const name = sp === -1 ? inner : inner.slice(0, sp);
  const attrStr = sp === -1 ? '' : inner.slice(sp);
  const node = { tag: name, attrs: [], children: [], text: undefined };
  let i = 0;
  const n = attrStr.length;
  while (i < n) {
    while (i < n && /\s/.test(attrStr[i])) i++;
    if (i >= n) break;
    let nEnd = i;
    while (nEnd < n && !/[\s=]/.test(attrStr[nEnd])) nEnd++;
    const aName = attrStr.slice(i, nEnd);
    i = nEnd;
    while (i < n && /\s/.test(attrStr[i])) i++;
    let aVal = '';
    if (attrStr[i] === '=') {
      i++;
      while (i < n && /\s/.test(attrStr[i])) i++;
      if (attrStr[i] === '"' || attrStr[i] === "'") {
        const q = attrStr[i]; i++;
        const end = attrStr.indexOf(q, i);
        aVal = end === -1 ? attrStr.slice(i) : attrStr.slice(i, end);
        i = end === -1 ? n : end + 1;
      } else {
        const end = attrStr.search(/\s/, i);
        aVal = end === -1 ? attrStr.slice(i) : attrStr.slice(i, end);
        i = end === -1 ? n : end;
      }
    }
    node.attrs.push({ name: aName, value: aVal });
  }
  return { node, selfClosing, end: gt + (selfClosing ? 2 : 1) };
}

// ---- 属性值处理 helpers ----
function toCamelCase(name) { return name.replace(/-([a-z])/g, (m, ch) => ch.toUpperCase()); }
function hasBinding(v) { return typeof v === 'string' && DATA_BINDING_REG.test(v); }

// ---- 事件编译（validateEvent 复刻） ----
function compileEvent(compiler, eventName, rawVal, node) {
  const name = eventName.replace(EVENT_START_REGEXP, '').replace(EVENT_END_REGEXP, '');
  if (!name || !rawVal) return;
  let ev = node.on || (node.on = {});
  let val = rawVal;
  if (hasBinding(val)) val = val.replace(/^{{/, '').replace(/}}$/, '');
  const empty = val.match(/(.*)\(\)$/);
  if (empty) { ev[name] = empty[1]; return; }
  const content = val.match(REG_EVENT);
  if (content) {
    const fn = content[1];
    let paramList = content[2];
    if (paramList) {
      if (hasBinding(paramList)) paramList = paramList.replace(/^{{/, '').replace(/}}$/, '');
      try {
        paramList = expr.parseExpression(paramList, true);
      } catch (e) { throw new Error('事件表达式错误: `' + rawVal + '`'); }
    }
    ev[name] = { __evtFn: true, body: 'this.' + fn + '(' + paramList + ',evt)' };
    return;
  }
  ev[name] = val;
}

// ---- 样式编译（validateStyle + sortStyle 复刻） ---- 
const cssStyle = require('./css');
function compileInlineStyle(compiler, styleStr) {
  const staticStyle = {};
  const dynamicStyle = {};
  if (!styleStr) return { staticStyle, dynamicStyle };
  const segs = String(styleStr).split(';');
  for (let seg of segs) {
    seg = seg.trim();
    if (!seg) continue;
    const idx = seg.indexOf(':');
    if (idx === -1) continue;
    const key = toCamelCase(seg.slice(0, idx).trim());
    const value = seg.slice(idx + 1).trim();
    if (!key) continue;
    if (hasBinding(value)) {
      const c = expr.compileExpr(value, false);
      dynamicStyle[key] = c.body;
    } else if (key === 'margin' || key === 'padding' || key === 'borderWidth' || key === 'borderColor') {
      const exp = cssStyle.expandShorthand(key, value);
      for (const k of Object.keys(exp)) staticStyle[k] = exp[k];
    } else if (key === 'flex') {
      const parts = value.split(/\s+/);
      if (/^[-+]?\d*\.?\d+$/.test(parts[0])) staticStyle.flexGrow = cssStyle.normalizeValue('flexGrow', parts[0]);
      else staticStyle.flex = cssStyle.normalizeValue('flex', value);
    } else {
      staticStyle[key] = cssStyle.normalizeValue(key, value) || value;
    }
  }
  return { staticStyle, dynamicStyle };
}
function styleLiteral(compiler, key, value) {
  if (key === SPECIAL_STYLE.ANIMATION_DELAY || key === SPECIAL_STYLE.ANIMATION_DURATION) {
    return JSON.stringify(value);
  }
  if (key === SPECIAL_STYLE.ANIMATION_ITERATION_COUNT) {
    const n = Number(value);
    return JSON.stringify(n === -1 ? 'infinite' : String(value));
  }
  if (key === SPECIAL_STYLE.BACKGROUND_IMAGE || key === SPECIAL_STYLE.BACKGROUND_IMAGE_ACTIVE || key === SPECIAL_STYLE.BACKGROUND_IMAGE_CHECKED) {
    return checkType(String(value).replace(REGXP_QUOTES, ''));
  }
  return checkType(value);
}

// ---- for / if 编译（validateFor / validateIf 复刻） ----
function compileFor(compiler, value) {
  let e = String(value);
  if (e.startsWith('{{') && e.endsWith('}}')) e = e.slice(2, -2);
  e = e.trim();
  const mIn = e.match(/(.*?)\s+in\s+(.*)/);
  if (mIn) {
    const left = mIn[1].trim();
    const right = mIn[2].trim();
    let key = null, item = left;
    const pair = left.match(REG_FOR_PAREN);
    if (pair) { key = pair[1].trim(); item = pair[2].trim(); }
    if (item.startsWith('{{')) item = item.slice(2, -2).trim();
    if (key && key.startsWith('{{')) key = key.slice(2, -2).trim();
    const exp = expBody(compiler, '{{' + right + '}}');
    return { exp, key, item };
  }
  return { exp: expBody(compiler, '{{' + e + '}}'), key: null, item: '$item' };
}
// 表达式 -> 字符串代码（e. 前缀）
function expBody(compiler, raw) {
  const c = expr.compileExpr(String(raw), false);
  if (c.static) return JSON.stringify(c.text);
  return compiler.resolveBody(c.body);
}
function compileIf(compiler, value) {
  const v = String(value);
  if (hasBinding(v)) return expBody(compiler, v);
  return expBody(compiler, '{{' + v + '}}');
}

// ---- 节点转换（transformTemplate 复刻） ----
function transformNode(compiler, node) {
  if (node.repeat && !node.forCompiled) {
    node.forCompiled = true;
    const f = node.repeat;
    compiler.paramStack.push({ key: f.key, value: f.item });
    let child;
    try { child = transformNode(compiler, node); }
    finally { compiler.paramStack.pop(); }
    const params = [f.item || '$item', f.key || '$idx'];
    const expFn = 'function(){return ' + f.exp + '}';
    return '_l((' + expFn + '),function(' + params.join(',') + '){return ' + child + '})';
  }
  if (node.shown !== undefined && !node.ifCompiled) {
    node.ifCompiled = true;
    const child = transformNode(compiler, node);
    const shownFn = 'function(){return ' + node.shown + '}';
    return '_i((' + shownFn + '),function(){return ' + child + '})';
  }
  return nodeCall(compiler, node);
}
function nodeCall(compiler, node) {
  const opts = transformOptions(compiler, node);
  const children = transformChildren(compiler, node);
  let s = "_c('" + node.tag + "'";
  if (opts) s += ',' + opts;
  if (children) s += ',' + children;
  s += ')';
  return s;
}
function transformOptions(compiler, node) {
  const parts = [];
  if (node.attr && Object.keys(node.attr).length) parts.push("'attrs' : " + transformAttrs(compiler, node.attr));
  if (node.on && Object.keys(node.on).length) parts.push("'on' : " + transformEvents(compiler, node.on));
  if (node.classList && node.classList.length) parts.push("'staticClass' : " + checkType(node.classList));
  if (node.staticStyle && Object.keys(node.staticStyle).length) {
    let e = '';
    for (const k of Object.keys(node.staticStyle)) {
      e += "'" + k + "' : " + styleLiteral(compiler, k, node.staticStyle[k]) + ',';
    }
    parts.push("'staticStyle' : {" + e.replace(/,$/, '') + '}');
  }
  if (node.dynamicStyle && Object.keys(node.dynamicStyle).length) {
    let e = '';
    for (const k of Object.keys(node.dynamicStyle)) {
      e += "'" + k + "' : function(){return " + compiler.resolveBody(node.dynamicStyle[k]) + '},';
    }
    parts.push("'dynamicStyle' :{" + e.replace(/,$/, '') + '}');
  }
  if (node.key !== undefined && node.key !== null) parts.push("'key' : " + node.key);
  return parts.length ? '{' + parts.join(',') + '}' : null;
}
function transformAttrs(compiler, attrs) {
  let e = '';
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v && typeof v === 'object' && v.__fn) {
      e += "'" + k + "' : function(){return " + compiler.resolveBody(v.body) + '},';
    } else if (k === 'value') {
      e += "'" + k + "' : " + JSON.stringify(v === undefined || v === null ? '' : String(v)) + ',';
    } else {
      e += "'" + k + "' : " + checkType(v === undefined || v === null ? '' : String(v)) + ',';
    }
  }
  return '{' + e.replace(/,$/, '') + '}';
}
function transformEvents(compiler, events) {
  let e = '';
  for (const k of Object.keys(events)) {
    const v = events[k];
    if (v && typeof v === 'object' && v.__evtFn) {
      // formatForFunc：paramStack 参数（$item/$idx）还原，其余 this->e
      e += "'" + k + "' : function (evt) {" + compiler.resolveBody(v.body) + '},';
    } else if (typeof v === 'string' && v.indexOf('function (evt)') === 0) {
      e += "'" + k + "' : " + v + ',';
    } else if (hasBinding(v)) {
      e += "'" + k + "' : function(){return " + expBody(compiler, v) + '},';
    } else {
      const evtName = String(v);
      e += "'" + k + "' : " + (compiler.isParam(evtName) ? evtName : 'e.' + evtName) + ',';
    }
  }
  return '{' + e.replace(/,$/, '') + '}';
}
function transformChildren(compiler, node) {
  const kids = node.children || [];
  if (!kids.length) return null;
  const out = [];
  let prevCompiled = null; // 上一个 if/elif 条件完整式（用于 elif/else 取反）
  for (const ch of kids) {
    if (!ch.tag) continue; // 忽略文本节点
    if (ch.ifType === 'if' || ch.ifType === 'elif' || ch.ifType === 'else') {
      let shown;
      if (ch.ifType === 'if') {
        shown = ch.cond;
      } else if (ch.ifType === 'elif') {
        shown = prevCompiled !== null ? '(' + ch.cond + ')&&!(' + prevCompiled + ')' : ch.cond;
      } else {
        shown = prevCompiled !== null ? '!(' + prevCompiled + ')' : 'true';
      }
      prevCompiled = shown;
      out.push(transformNode(compiler, Object.assign({}, ch, { shown })));
    } else {
      prevCompiled = null;
      out.push(transformNode(compiler, ch));
    }
  }
  return '[' + out.join(',') + ']';
}

// ---- DOM 元素 -> 编译 AST ----
function buildNode(compiler, el) {
  const node = { tag: el.tag };
  if (el.attrs) {
    for (const a of el.attrs) {
      const n = a.name, v = a.value;
      if (n === 'style') {
        const s = compileInlineStyle(compiler, v);
        node.staticStyle = s.staticStyle;
        node.dynamicStyle = s.dynamicStyle;
      } else if (n === 'class') {
        node.classList = v.trim().split(/\s+/).filter(Boolean);
      } else if (n === 'for') {
        node.repeat = compileFor(compiler, v);
      } else if (n === 'if') {
        node.ifType = 'if'; node.cond = compileIf(compiler, v);
      } else if (n === 'elif') {
        node.ifType = 'elif'; node.cond = compileIf(compiler, v);
      } else if (n === 'else') {
        node.ifType = 'else'; node.cond = 'true';
      } else if (n === 'append') {
        // 暂不处理 append
      } else if (EVENT_START_REGEXP.test(n)) {
        compileEvent(compiler, n, v, node);
      } else {
        if (!node.attr) node.attr = {};
        const cam = toCamelCase(n);
        const raw = String(v);
        // validateAttr：value 属性先过 transArray；bind() 内部 transExp 先 trim
        const val = (n === 'value' ? unescapeTextValue(raw) : raw).trim();
        if (hasBinding(val)) {
          const c = expr.compileExpr(val, false);
          node.attr[cam] = { __fn: true, body: c.body };
        } else {
          node.attr[cam] = val;
        }
      }
    }
  }
  // 文本内容 -> value（validateAttr 的 value 路径：先 transArray 再 trim）
  const elTextRaw = el.text === undefined ? undefined : String(el.text);
  const elText = elTextRaw === undefined ? undefined : unescapeTextValue(elTextRaw).trim();
  if (elText) {
    if (!node.attr) node.attr = {};
    if (hasBinding(elText)) {
      const c = expr.compileExpr(elText, false);
      node.attr.value = { __fn: true, body: c.body };
    } else {
      node.attr.value = elText;
    }
  }
  if (el.children && el.children.length) {
    node.children = el.children.map(c => buildNode(compiler, c));
  }
  return node;
}

// ---- 主入口 ----
function compileTemplate(hmlSource) {
  const doc = parseHML(hmlSource);
  const rootEl = (doc.children || []).find(c => c.tag);
  if (!rootEl) return 'function (t) { var e = t || this; return _c(\'div\') }';
  const compiler = new Compiler();
  const node = buildNode(compiler, rootEl);
  const tree = transformNode(compiler, node, null);
  return 'function (t) { var e = t || this; return ' + tree + ' }';
}

module.exports = { compileTemplate, parseHML, buildNode, Compiler, transformNode };