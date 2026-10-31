"use strict";
// 追踪 menu_sponsor 文本值在各阶段的形态
const fs = require('fs');
globalThis.Babel = require('./vendor/babel.min.js');
const hml = require('./lib/hml');
const P = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default/pages/menu_sponsor';
const src = fs.readFileSync(P + '/menu_sponsor.hml', 'utf8');
const doc = hml.parseHML(src);
const root = doc.children.find(c => c.tag);

function find(n) {
  if (n.tag === 'text' && n.children && n.children.some(c => c.tag === 'text' && /(^▽|感谢|爱发电)/.test(c.text || ''))) return n;
  for (const c of (n.children || [])) { const r = find(c); if (r) return r; }
  return null;
}
// 直接找含 (^▽ 的 text 元素
let txt = null;
(function walk(n) {
  if (!txt && n.tag === 'text' && /(^▽|感谢)/.test(String(n.text || '').replace(/\s/g, ''))) txt = n;
  for (const c of (n.children || [])) walk(c);
})(root);

if (txt) {
  console.log('parseHML text (repr):');
  console.log(JSON.stringify(txt.text));
  const compiler = new hml.Compiler();
  const tree = hml.buildNode(compiler, root);
  console.log('buildNode attr.value (repr):');
  console.log(JSON.stringify(tree.children[0].attr));
  const render = hml.transformNode(compiler, tree);
  const i = render.indexOf('感谢');
  console.log('render 片段 (repr):');
  console.log(JSON.stringify(render.slice(i - 30, i + 90)));
}