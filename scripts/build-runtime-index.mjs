import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const crate = path.join(repoRoot, "packages", "bridge", "native", "runtime-index");

export function buildRuntimeIndex({ arch = process.arch, optional = false } = {}) {
  const system = { darwin: "apple-darwin", linux: "unknown-linux-gnu" }[process.platform];
  const cpu = { arm64: "aarch64", x64: "x86_64" }[arch];
  if (!system || !cpu) {
    if (optional) return;
    throw new Error(`Rust Runtime 索引不支持 ${process.platform}/${arch}`);
  }
  const target = `${cpu}-${system}`;
  const targetDir = path.join(crate, "target");
  const result = spawnSync("cargo", ["build", "--locked", "--release", "--target", target, "--target-dir", targetDir], { cwd: crate, stdio: "inherit" });
  if (optional && result.error?.code === "ENOENT") {
    console.warn("未找到 Cargo：跳过重新构建 Rust Runtime 索引。");
    return;
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Rust Runtime 索引构建失败（${result.status ?? result.signal}）`);

  const output = path.join(repoRoot, "packages", "bridge", "dist-app", "native");
  const extension = process.platform === "darwin" ? "dylib" : "so";
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(path.join(targetDir, target, "release", `libtapmakerwork_runtime_index.${extension}`), path.join(output, `runtime-index-${process.platform}-${arch}.node`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildRuntimeIndex({ arch: process.argv[2] });
}
