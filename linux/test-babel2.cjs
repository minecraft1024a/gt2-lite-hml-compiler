"use strict";
// 测试 SDK babel.config.js 等价配置的输出形态
const fs = require('fs');
globalThis.Babel = require('./vendor/babel.min.js');
const B = globalThis.Babel;
const BASE = '/home/yishan/gt2-hap-sideload/our app/kqakqakqa合集(GitHub)/hmlitewearable_files/entry/src/main/js/default';
function t(src) {
  return B.transform(String(src), {
    sourceType: 'module',
    comments: false,
    presets: [['env', {}]],
    plugins: [
      'transform-modules-commonjs',
      'transform-class-properties',
      'transform-runtime',
      ['transform-arrow-functions', { spec: true }],
    ],
  }).code;
}
for (const [name, rel] of [['files_index', 'pages/files_index/files_index.js'], ['index', 'pages/index/index.js']]) {
  const src = fs.readFileSync(BASE + '/' + rel, 'utf8');
  try {
    const es5 = t(src);
    console.log('===== ' + name + ' es5 (' + es5.length + 'B) =====');
    console.log(es5.slice(0, 900));
  } catch (e) {
    console.log('===== ' + name + ' FAIL: ' + (e.message || e).split('\n')[0]);
  }
}