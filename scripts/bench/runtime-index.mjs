import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { listMakerCacheNames, nativeMakerCacheNames } from "../../packages/bridge/src/runtime-cache-index.ts";

assert.ok(nativeMakerCacheNames, "请先运行 npm run build:runtime-index");
const directory = process.argv[2] ?? os.tmpdir();
const previous = () => fs.readdirSync(directory).filter((name) => name.startsWith("maker-cache"));
const rust = () => listMakerCacheNames(directory);
const samples = { JavaScript: [], Rust: [] };

function measure(operation, values, collect) {
  const started = performance.now();
  const result = operation();
  if (collect) values.push(performance.now() - started);
  return result;
}

for (let index = 0; index < 270; index += 1) {
  const collect = index >= 20;
  const [first, second] = index % 2 === 0
    ? [measure(previous, samples.JavaScript, collect), measure(rust, samples.Rust, collect)]
    : [measure(rust, samples.Rust, collect), measure(previous, samples.JavaScript, collect)];
  assert.deepEqual(first, second);
}

console.log(`目录项：${fs.readdirSync(directory).length}；匹配：${rust().length}；270 轮结果逐项一致`);
for (const [label, values] of Object.entries(samples)) {
  values.sort((left, right) => left - right);
  const percentile = (fraction) => values[Math.floor(values.length * fraction)].toFixed(3);
  console.log(`${label}: p50=${percentile(0.5)} ms，p95=${percentile(0.95)} ms`);
}
