"use strict";
/**
 * manifest.json 生成（对齐 build-lite-hap.sh 第 1 步 python，逐字节）
 *   appID=app.bundleName / appName=abilities[0].label / versionName / versionCode
 *   minPlatformVersion=apiVersion.compatible / pages=js[0].pages / deviceType
 */
function generateManifest(cfg, pageList) {
  const app = cfg.app || {};
  const module = cfg.module || {};
  const abilities = module.abilities || [];
  const js0 = (module.js || [])[0] || {};
  const av = app.apiVersion;
  const compat = (av && typeof av === 'object') ? (av.compatible !== undefined ? av.compatible : 3) : 3;
  return {
    appID: app.bundleName,
    appName: abilities[0] && abilities[0].label !== undefined ? abilities[0].label : '',
    versionName: app.version && app.version.name !== undefined ? app.version.name : '',
    versionCode: app.version && app.version.code !== undefined ? app.version.code : 0,
    minPlatformVersion: compat,
    pages: pageList || js0.pages || [],
    deviceType: module.deviceType || [],
  };
}

/** 2 空格缩进、不转义非 ASCII，与 python json.dump(ensure_ascii=False, indent=2) 对齐 */
function stringify(obj) {
  return JSON.stringify(obj, null, 2);
}

module.exports = { generateManifest, stringify };