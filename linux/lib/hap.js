"use strict";
/**
 * HAP 组装：config 规范化 + pack.info + zip 打包（对齐 build-lite-hap.sh 第 3 步）
 */
const fs = require('fs');
const path = require('path');

function loadJszip() {
  if (typeof globalThis !== 'undefined' && (globalThis.JSZip || globalThis.jszip)) {
    return globalThis.JSZip || globalThis.jszip;
  }
  try { return require('../vendor/jszip.min.js'); }
  catch (e) { try { return require('jszip'); } catch (e2) { throw new Error('无法加载 jszip（HAP 打包需要）'); } }
}

/**
 * config.json 规范化为官方"包形态"（就地修改）
 *  - apiVersion 恒为对象 {compatible, releaseType:'Release', target}
 *  - deviceConfig 非对象时置 {}
 *  - module 去掉 moduleName（只在 distro 里）
 *  - distro 缺省 {moduleType:'entry', deliveryWithInstall:true, moduleName:'entry'}
 *  - abilities[0] 补 iconId=0x01000001 / labelId=0x01000000 / homeAbility=false
 */
function normalizeConfig(c) {
  const app = c.app = c.app || {};
  const av = app.apiVersion;
  const compat = (av && typeof av === 'object') ? (av.compatible !== undefined ? av.compatible : 3)
    : (typeof av === 'number' ? av : 3);
  const target = (av && typeof av === 'object') ? (av.target !== undefined ? av.target : 6) : 6;
  app.apiVersion = { compatible: Number(compat), releaseType: 'Release', target: Number(target) };
  if (!(c.deviceConfig && typeof c.deviceConfig === 'object' && !Array.isArray(c.deviceConfig))) {
    c.deviceConfig = {};
  }
  const mod = c.module = c.module || {};
  delete mod.moduleName;
  if (!(mod.distro && typeof mod.distro === 'object')) {
    mod.distro = { moduleType: 'entry', deliveryWithInstall: true, moduleName: 'entry' };
  }
  const abilities = mod.abilities;
  if (Array.isArray(abilities) && abilities[0]) {
    if (abilities[0].iconId === undefined) abilities[0].iconId = 16777217;
    if (abilities[0].labelId === undefined) abilities[0].labelId = 16777216;
    if (abilities[0].homeAbility === undefined) abilities[0].homeAbility = false;
  }
  return c;
}

/** pack.info（4 空格缩进，对齐 python indent=4） */
function buildPackInfo(cfg) {
  const app = cfg.app || {};
  const mod = cfg.module || {};
  const ab = (mod.abilities || [])[0] || {};
  return {
    summary: {
      app: {
        bundleName: app.bundleName,
        version: {
          code: (app.version || {}).code,
          name: (app.version || {}).name,
        },
      },
      modules: [{
        deviceType: mod.deviceType,
        abilities: [{ name: ab.name, label: ab.label }],
        distro: mod.distro,
        apiVersion: app.apiVersion,
      }],
    },
    packages: [{
      deviceType: mod.deviceType,
      moduleType: (mod.distro || {}).moduleType,
      deliveryWithInstall: (mod.distro || {}).deliveryWithInstall,
      name: 'entry-release-lite',
    }],
  };
}

/**
 * 打包 HAP 目录 -> Buffer（DEFLATE）
 * @param {string} hapDir 含 config.json/pack.info/assets/... 的目录
 * @returns {Promise<Buffer>}
 */
async function packHap(hapDir) {
  const JSZip = loadJszip();
  const zip = new JSZip();
  const all = [];
  const walk = (root) => {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      const p = path.join(root, e.name);
      if (e.isDirectory()) walk(p);
      else all.push(p);
    }
  };
  walk(hapDir);
  all.sort();
  for (const abs of all) {
    const rel = path.relative(hapDir, abs).split(path.sep).join('/');
    zip.file(rel, fs.readFileSync(abs));
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return Buffer.from(buf);
}

module.exports = { normalizeConfig, buildPackInfo, packHap, loadJszip };