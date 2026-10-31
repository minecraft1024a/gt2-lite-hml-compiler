"use strict";
// 调试：buildNode/transform 后的树 vs 官方 render
const fs = require('fs');
globalThis.Babel = require('./vendor/babel.min.js');
const hml = require('./lib/hml');
const P = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default/pages/files_index';
const src = fs.readFileSync(P + '/files_index.hml', 'utf8');
const doc = hml.parseHML(src);
const root = doc.children.find(c => c.tag);
const compiler = new hml.Compiler();
const tree = hml.buildNode(compiler, root);

function find(node, pred) { if (pred(node)) return node; for (const c of (node.children || [])) { const r = find(c, pred); if (r) return r; } return null; }
function ndump(n, d) {
  console.log('  '.repeat(d) + '<' + n.tag + '> attr=' + JSON.stringify(n.attr || {}) + ' class=' + JSON.stringify(n.classList || []));
  for (const c of (n.children || [])) ndump(c, d + 1);
}
const menu = find(tree, n => n.on && n.on.click && String(n.on.click).includes('pageTo'));
console.log('--- menu 卡 buildNode 树 ---');
ndump(menu, 0);
console.log('--- menu 列表项的 render 文本 ---');
const render = 'function (t) { var e = t || this; return ' + hml.transformNode(compiler, tree) + ' }';
const i = render.indexOf('pageTo');
console.log(render.slice(i - 200, i + 700));
console.log('--- 从 go-icon (chevron 最后一次出现) 后面 120 字符 ---');
const c = render.lastIndexOf('chevron_right-30px-gray.png');
console.log(JSON.stringify(render.slice(c, c + 130)));