"use strict";
// 调试：render 函数缩进打印（定位括号层级问题）
const fs = require('fs');
globalThis.Babel = require('./vendor/babel.min.js');
const hml = require('./lib/hml');
const P = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default/pages/files_index';
const ours = hml.compileTemplate(fs.readFileSync(P + '/files_index.hml', 'utf8'));

let out = '', depth = 0, i = 0;
const s = ours;
while (i < s.length) {
  const c = s[i];
  if (c === '_') {
    if (out && !/[\s(,[]$/.test(out)) out += ' ';
    out += '\n' + '  '.repeat(depth) + '_c';
    i += 2;
    continue;
  }
  if (c === '(') { out += '('; depth++; i++; continue; }
  if (c === ')' || c === ']') {
    depth = Math.max(0, depth - 1);
    out += ')';
    i++;
    if (s[i] === ',' || s[i] === ']') { out += s[i]; i++; }
    continue;
  }
  if (c === ',') {
    out += ',';
    if (s[i - 1] === ')' || s[i - 1] === ']') out += '\n' + '  '.repeat(depth);
    i++;
    continue;
  }
  out += c;
  i++;
}
const st = out.indexOf('pageTo');
console.log(out.slice(st - 700, st + 1000));