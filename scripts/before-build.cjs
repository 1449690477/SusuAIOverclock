'use strict';

/**
 * app-builder-bin 5.0.0-alpha.10 的 `node-dep-tree` 在本仓库会返回空串，
 * electron-builder 再 JSON 解析成空对象后于 computeNodeModuleFileSets 抛
 * `deps is not iterable`。返回 false 跳过该路径；生产依赖改由 package.json
 * build.files 显式打入 asar。
 */
module.exports = async function beforeBuild() {
  return false;
};
