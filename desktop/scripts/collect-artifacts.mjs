#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { arch, platform } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const releaseDir = join(desktopDir, "release");
const packageJson = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8"));
const version = packageJson.version;
const mode = process.argv[2];

function fail(message) {
  console.error(`错误 ${message}`);
  process.exit(1);
}

function walk(root, accept) {
  if (!existsSync(root)) return [];
  const results = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (accept(path)) results.push(path);
    }
  }
  return results;
}

function newest(paths) {
  return [...paths].sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
}

function copy(source, targetName) {
  mkdirSync(releaseDir, { recursive: true });
  const target = join(releaseDir, targetName);
  copyFileSync(source, target);
  const sizeMb = (statSync(target).size / 1024 / 1024).toFixed(1);
  console.log(`已汇总 release/${targetName} (${sizeMb} MB)`);
}

function collectDesktop() {
  const bundleFiles = walk(join(desktopDir, "src-tauri", "target"), (path) => {
    const normalized = path.replaceAll("\\", "/");
    if (!normalized.includes("/release/bundle/")) return false;
    return [".msi", ".exe", ".dmg", ".deb", ".rpm", ".appimage"]
      .includes(extname(path).toLowerCase());
  });
  if (bundleFiles.length === 0) fail("没有找到桌面端安装包，请先确认 Tauri 构建成功。");

  const platformNames = { win32: "windows", darwin: "macos", linux: "linux" };
  const archNames = { x64: "x64", arm64: "arm64" };
  const newestByExtension = new Map();
  for (const source of bundleFiles) {
    const extension = extname(source).toLowerCase();
    const current = newestByExtension.get(extension);
    if (!current || statSync(source).mtimeMs > statSync(current).mtimeMs) {
      newestByExtension.set(extension, source);
    }
  }
  for (const source of newestByExtension.values()) {
    const extension = extname(source);
    copy(source, `AI-Todo-${version}-${platformNames[platform()] || platform()}-${archNames[arch()] || arch()}${extension}`);
  }
}

function androidClassifier(path, suffix) {
  const stem = basename(path).slice(0, -suffix.length)
    .replace(/^app-?/, "")
    .replace(/-release$/, "")
    .replace(/-release-signed$/, "");
  return stem || "universal";
}

function collectApk() {
  const root = join(desktopDir, "src-tauri", "gen", "android", "app", "build", "outputs", "apk");
  const source = newest(walk(root, (path) => path.endsWith("-release-signed.apk")));
  if (!source) fail("没有找到已签名 APK，请先运行 npm run android:release。");
  copy(source, `AI-Todo-${version}-android-${androidClassifier(source, ".apk")}.apk`);
}

function collectAab() {
  const root = join(desktopDir, "src-tauri", "gen", "android", "app", "build", "outputs", "bundle");
  const source = newest(walk(root, (path) => path.endsWith(".aab")));
  if (!source) fail("没有找到 AAB，请先确认 Tauri Android 构建成功。");
  copy(source, `AI-Todo-${version}-android-${androidClassifier(source, ".aab")}.aab`);
}

if (mode === "desktop") collectDesktop();
else if (mode === "apk") collectApk();
else if (mode === "aab") collectAab();
else fail("用法：node scripts/collect-artifacts.mjs <desktop|apk|aab>");
