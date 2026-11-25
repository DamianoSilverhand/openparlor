#!/usr/bin/env node
// Checks every content pack and exits with 1 if anything is wrong. Used by `npm run validate` and CI.
const { validateAll } = require('../server/content');

const { problems, summary } = validateAll();
summary.forEach((line) => console.log(line));
if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} found:`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log('\nAll content packs are valid.');
