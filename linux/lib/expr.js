"use strict";
/**
 * 表达式编译（逆向自 SDK ace-loader lib/templater/{bind,content,data}.js）
 * - parseText: 把 {{expr}} / {{{expr}}} 与静态文本拆成段
 * - parseExpression: 给裸标识符加 this. 前缀（复刻 content.js 的 babel 语义）
 * - parseExp: 复刻 bind.js parseExp —— 静态文本转 decodeURI('...')，表达式转函数体
 */
let Babel = null;
function getBabel() {
  if (Babel) return Babel;
  if (typeof globalThis !== 'undefined' && globalThis.Babel) return (Babel = globalThis.Babel);
  try {
    Babel = require('../vendor/babel.min.js');
    if (typeof globalThis !== 'undefined') globalThis.Babel = Babel;
  } catch (e) {
    throw new Error('babel.min.js 未初始化：请先执行 require("../vendor/babel.min.js") 或传入 Babel（' + e.message + '）');
  }
  return Babel;
}

// 与 content.js 相同的保留字列表（注意：不含 Math —— 这是原版行为，必须保持一致）
const GLOBAL_REG = /^(NaN|isNaN|isFinite|decodeURI|decodeURIComponent|this|true|false|encodeURI|encodeURIComponent|parseInt|parseFloat|null|undefined|Infinity)$/;
const RESERVED = /^(var|while|with|yield|enum|await|implements|package|for|function|if|import|protected|static|interface|private|public|break|case|class|catch|const|continue|debugger|default|delete|do|else|export|extends|finally|in|instanceof|let|return|super|switch|throw|try)$/;

const DATA_REG = /{{{(.|\n)+?}}}|{{(.|\n)+?}}/g;
const EXPR_REG = /{{{(.|\n)+?}}}|{{(.|\n)+?}}/;
const DATA_REG_NOG = /(({{{(?:.|\n)+?}}})|({{(?:.|\n)+?}}))/g; // 用于提取

/**
 * data.js parseData -> 段数组
 * 返回 [{value: string}] 或 [{tag:true, value:string}]
 * 注意：不能用捕获组提取内容（(.|\n)+? 对组只会保留末次迭代），用完整匹配切片
 */
function parseText(text) {
  if (!EXPR_REG.test(text)) return null;
  let idx = 0;
  const items = [];
  const re = /{{{(.|\n)+?}}}|{{(.|\n)+?}}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (m.index > idx) items.push({ value: text.slice(idx, m.index) });
    if (raw.startsWith('{{{')) items.push({ tag: true, value: raw.slice(3, -3).trim() });
    else items.push({ tag: true, value: raw.slice(2, -2).trim() });
    idx = m.index + raw.length;
  }
  if (idx < text.length) items.push({ value: text.slice(idx) });
  return items;
}

/**
 * content.js parseExpression：递归所有 Identifier，按 addPrefix 规则加 this. 前缀
 * @param code 表达式源码
 * @param isEvent 事件模式（值影响不大，兼容）
 */
function parseExpression(code, isEvent) {
  const b = getBabel();
  const wrapper = 'var __ace_v_ = ' + (isEvent ? '(' + code + ')' : code) + ';';
  let js;
  try {
    const out = b.transform(wrapper, {
      sourceType: 'module',
      compact: true,
      plugins: [() => ({
        visitor: {
          Identifier(path) {
            if (path.node.name === '__ace_v_') return;
            const node = path.node;
            const parent = path.parent;
            if (!parent || parent.type === 'Program' && parent.body[0].declarations[0].id === node) return;
            let add = false;
            // 第一组条件（content.js 写在 || 最前）
            if (parent.type === 'ConditionalExpression' || parent.type === 'BinaryExpression') {
              add = true;
            } else if (parent.type === 'CallExpression' && parent.callee === node) {
              add = true;
            } else if (parent.type === 'ObjectProperty' && !parent.computed && parent.value === node) {
              add = true;
            } else if (parent.type === 'ObjectExpression' && parent.properties && parent.properties.includes(node)) {
              add = true;
            } else if (parent.type === 'VariableDeclarator' && parent.init === node) {
              // SDK 顶层表达式父节点是 ExpressionStatement（expression 键命中 addPrefix）；
              // 我们的 var 包装使父节点变为 VariableDeclarator，等效补上
              add = true;
            } else if (parent.type === 'ExpressionStatement' && parent.expression === node) {
              add = true;
            } else {
              add = addPrefix(node, parent);
            }
            if (add && !GLOBAL_REG.test(node.name)) {
              path.node.name = 'this.' + node.name;
            }
          },
        },
      })],
    });
    js = out.code;
  } catch (err) {
    if (RESERVED.test(code)) {
      throw new Error(isEvent ? 'An event parsing error occurred. Do not use the reserved:' + code
        : 'A data binding parsing error occurred. Do not use the reserved:' + code);
    }
    throw new Error(isEvent ? 'An event parsing error occurred:' + code : 'A data binding parsing error occurred:' + code);
  }
  // 提取 RHS
  const m = js.match(/^var\s+__ace_v_\s*=\s*([\s\S]+?)\s*;?\s*$/m);
  const rhs = m ? m[1].trim().replace(/;\s*$/, '') : js;
  return rhs.replace(/\"/g, "'").replace(/\n/g, '');
}

/** content.js 的 addPrefix */
function addPrefix(node, parent) {
  if (!parent) return false;
  const nKeys = ['expression', 'argument', 'expressions', 'elements', 'left', 'right'];
  const tKeys = ['object', 'property', 'id', 'key'];
  const pkeys = Object.keys(parent);
  for (const k of nKeys) {
    if (pkeys.includes(k)) {
      if (parent[k] === node || (['expressions', 'elements'].includes(k) && Array.isArray(parent[k]) && parent[k].includes(node))) {
        return true;
      }
    }
  }
  for (const k of tKeys) {
    if (pkeys.includes(k)) {
      if (parent.computed && parent[k] === node) return true;
      if (parent.type === 'Property' &&
          parent.key.range && parent.value.range &&
          parent.key.range[0] === parent.value.range[0] &&
          parent.key.range[1] === parent.value.range[1]) {
        node.name = node.name + ':this.' + node.name;
      } else if (parent.object === node) return true;
    }
  }
  return false;
}

/**
 * bind.js parseExp 的文本级版本（lite）
 * 根据是否含表达式返回：
 *   - 纯静态：返回原始字符串（调用方再走 checkType）
 *   - 含表达式：返回 { body: "this.uiSizes.x + decodeURI('px')" } 即函数体
 * @param value 原始值字符串
 * @param asFn 为 true 时返回函数字符串 "function () {return ...}"
 */
function compileExpr(value, asFn) {
  const text = String(value);
  const texts = parseText(text);
  if (!texts) return { static: true, text };
  const parts = [];
  for (const t of texts) {
    if (t.tag) {
      let e = parseExpression(t.value, false);
      if (texts.length > 1) e = '(' + e + ')';
      parts.push(e);
    } else {
      const enc = encodeURI(t.value).replace(/'/g, '%27');
      parts.push("decodeURI('" + enc + "')");
    }
  }
  const body = parts.join(' + ');
  if (asFn) return { fn: 'function () {return ' + body + '}' };
  return { body };
}

module.exports = {
  parseText,
  parseExpression,
  compileExpr,
  GLOBAL_REG,
};