'use strict';
// A resource icon_small.png must not be replaced by common/icon.bin.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const build = require('../linux/lib/build');
const image = require('../linux/lib/png2bin');
const JSZip = require('./vendor/jszip.min.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt2-media-test-'));

async function main() {
  const original = path.join(root, 'hmlitewearable_devdemo/entry/src/main');
  const mainDir = path.join(temp, 'entry/src/main');
  const config = JSON.parse(fs.readFileSync(path.join(original, 'config.json')));
  config.module.js[0].pages = [];
  const entries = [
    ['config.json', Buffer.from(JSON.stringify(config))],
    ['js/default/app.js', Buffer.from('export default {};')],
    ['js/default/common/icon.png', fs.readFileSync(path.join(original, 'resources/base/media/icon.png'))],
    ['resources/base/media/icon.png', fs.readFileSync(path.join(original, 'resources/base/media/icon.png'))],
    ['resources/base/media/icon_small.png', fs.readFileSync(path.join(original, 'resources/base/media/icon_small.png'))],
  ];
  for (const [name, bytes] of entries) {
    const dest = path.join(mainDir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes);
  }
  function verify(map, label) {
    const small = Buffer.from(map.get('assets/entry/resources/base/media/icon_small.bin'));
    const large = Buffer.from(map.get('assets/entry/resources/base/media/icon.bin'));
    assert.equal(small.readUInt16LE(4), 80, label);
    assert.equal(small.readUInt16LE(6), 80, label);
    assert.equal(small.length, 8 + 80 * 80 * 4, label);
    assert.equal(large.readUInt16LE(4), 114, label);
    assert.equal(large.readUInt16LE(6), 114, label);
    assert.notDeepEqual(small, large, label);
    console.log(label + ': resource small icon stays 80x80; common icon is 114x114');
  }
  const hap = await build.assembleHap({ projectRoot: temp, config,
    buildOut: { 'common/icon.bin': Buffer.from(image.pngToBin(entries[2][1])) } });
  const z = await JSZip.loadAsync(hap), linux = new Map();
  for (const name of Object.keys(z.files)) if (!z.files[name].dir) linux.set(name, await z.file(name).async('nodebuffer'));
  verify(linux, 'Linux');
  globalThis.Babel = require('./vendor/babel.min.js');
  globalThis.pako = require('./vendor/pako.min.js');
  globalThis.JSZip = JSZip;
  for (const name of ['compiler-core.js', 'web-core.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'js', name), 'utf8'));
  const res = globalThis.WebCompiler.compileProject(entries.map(([p, data]) => ({ path: p, data })));
  assert.equal(res.ok, true, res.error);
  verify(new Map(res.entries.map(e => [e.path, e.data])), 'Web');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => fs.rmSync(temp, { recursive: true, force: true }));
