"use strict";
// 用 @babel/parser 解析 render，带标签 dump：找出多出来的层级
const fs = require('fs');
globalThis.Babel = require('./vendor/babel.min.js');
const hml = require('./lib/hml');
const parser = require('/home/yishan/gt2-hap-sideload/sdk/hmscore/2.2.0/js/build-tools/ace-loader/node_modules/@babel/parser');
const P = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default/pages/files_index';
const src = fs.readFileSync(P + '/files_index.hml', 'utf8');
const doc = hml.parseHML(src);
const root = doc.children.find(c => c.tag);
const compiler = new hml.Compiler();
const tree = hml.buildNode(compiler, root);
const render = 'function (t) { var e = t || this; return ' + hml.transformNode(compiler, tree) + ' }';

const prog = parser.parse('(' + render + ')').program.body[0].expression;
const ret = prog.body.body.filter(b => b.type === 'ReturnStatement')[0].argument;

function dump(node, d) {
  const pad = '  '.repeat(d);
  if (node.type === 'CallExpression' && node.callee.name === '_c') {
    let tag = node.arguments[0] && node.arguments[0].value;
    if (!tag) { console.log(pad + '_c(' + node.arguments[0].name + ')'); return; }
    // 事件/attrs 摘要
    let notes = '';
    const opts = node.arguments[1];
    if (opts && opts.type === 'ObjectExpression') {
      for (const p of opts.properties) {
        const k = p.key.name || p.key.value;
        if (k === 'on' || k === 'attrs') {
          const inner = p.value.properties ? p.value.properties.map(q => (q.key.name || q.key.value)).join(',') : String(p.value.extra && p.value.extra.raw);
          notes += ' [' + k + '=' + inner + ']';
        }
      }
    }
    console.log(pad + '_c(' + tag + ')' + notes);
    const kids = node.arguments[2];
    if (kids && kids.elements) for (const el of kids.elements) dump(el, d + 1);
    else if (node.arguments.length === 2 && opts && opts.type === 'ArrayExpression') {
      for (const el of opts.elements) dump(el, d + 1);
    }
    return;
  }
  if (node.type === 'CallExpression' && node.callee.name === '_l') {
    console.log(pad + '_l(for)');
    const inner = node.arguments[1];
    if (inner && inner.body && inner.body.body) {
      for (const st of inner.body.body) if (st.type === 'ReturnStatement') dump(st.argument, d + 1);
    }
    return;
  }
  if (node.type === 'CallExpression' && node.callee.name === '_i') {
    console.log(pad + '_i(if)');
    const inner = node.arguments[1];
    if (inner && inner.body && inner.body.body) {
      for (const st of inner.body.body) if (st.type === 'ReturnStatement') dump(st.argument, d + 1);
    }
    return;
  }
  if (node.type === 'CallExpression') { console.log(pad + node.callee.name + '()'); return; }
  console.log(pad + node.type);
}
dump(ret, 0);