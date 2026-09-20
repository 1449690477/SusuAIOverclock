'use strict';

const { assertBuildInputsSafe, assertPortableBuilderPatched } = require('./preflight-security.cjs');

// Registered as beforePack: beforeBuild is skipped with npmRebuild:false.
// Do not return false or mark node modules externally handled. The fresh,
// verified builder must collect the real production dependency graph itself.
module.exports = async function beforePack() {
  assertBuildInputsSafe();
  assertPortableBuilderPatched();
};
