"use strict";
// 测试 babelToEs5 当前输出形态
const fs = require('fs');
globalThis.Babel = require('./vendor/babel.min.js');
const bundle = require('./lib/bundle');
const BASE = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default';
for (const [name, rel] of [['files_index', 'pages/files_index/files_index.js'], ['index', 'pages/index/index.js']]) {
  const src = fs.readFileSync(BASE + '/' + rel, 'utf8');
  try {
    const es5 = bundle.babelToEs5(src);
    console.log('===== ' + name + ' es5 (' + es5.length + 'B) =====');
    console.log(es5.slice(0, 1200));
  } catch (e) {
    console.log('===== ' + name + ' FAIL: ' + e.message.split('\n')[0]);
  }
}