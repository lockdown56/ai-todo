#!/usr/bin/env node
// 使用 apksigner 为 Tauri 产出的未签名 release APK 签名。
//
// 默认使用 Android 标准的 debug keystore（~/.android/debug.keystore），
// 测试阶段零配置即可用。需要换正式 release keystore 时，设置以下环境
// 变量即可，无需改脚本：
//   APK_KEYSTORE_PATH   keystore 文件路径
//   APK_KEY_ALIAS       密钥别名
//   APK_KEYSTORE_PASS   keystore 密码
//   APK_KEY_PASS        密钥密码
//
// 用法：npm --prefix desktop run android:sign

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const isWin = process.platform === 'win32'
const scriptDir = dirname(fileURLToPath(import.meta.url))
// 脚本位于 desktop/scripts/，src-tauri 在 desktop/src-tauri/
const desktopDir = resolve(scriptDir, '..')

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function fail(msg) {
  console.error(`${RED}错误${RESET} ${msg}`)
  process.exit(1)
}

function info(msg) {
  console.log(`${CYAN}信息${RESET} ${msg}`)
}

// 1. 定位 Android SDK
function findSdkDir() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), isWin ? 'AppData/Local/Android/Sdk' : 'Library/Android/sdk'),
  ].filter(Boolean)
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  fail(
    '找不到 Android SDK。请设置环境变量 ANDROID_HOME 或 ANDROID_SDK_ROOT，' +
      '指向 SDK 根目录（包含 build-tools、platform-tools 子目录）。',
  )
}

// 2. 取最高版本的 build-tools 目录（数字段比较，避免写死版本号）
function findBuildTools(sdkDir) {
  const btDir = join(sdkDir, 'build-tools')
  if (!existsSync(btDir)) {
    fail(`SDK 下没有 build-tools 目录：${btDir}。请在 Android Studio 里安装 Build Tools。`)
  }
  const versions = readdirSync(btDir)
    .filter((v) => /^\d+\.\d+(\.\d+)*$/.test(v))
    .map((v) => ({ name: v, parts: v.split('.').map(Number) }))
    .sort((a, b) => {
      const len = Math.max(a.parts.length, b.parts.length)
      for (let i = 0; i < len; i++) {
        const diff = (a.parts[i] || 0) - (b.parts[i] || 0)
        if (diff !== 0) return diff
      }
      return 0
    })
  if (versions.length === 0) {
    fail(`${btDir} 下没有有效的 build-tools 版本目录。`)
  }
  return join(btDir, versions[versions.length - 1].name)
}

// 3. 解析 apksigner 可执行文件：Windows 用 .bat，Unix 用无后缀
function resolveApksigner(buildToolsDir) {
  const exe = isWin ? 'apksigner.bat' : 'apksigner'
  const p = join(buildToolsDir, exe)
  if (!existsSync(p)) {
    fail(`找不到 apksigner：${p}。build-tools 版本太旧？请升级到 30 或更高。`)
  }
  return p
}

// Windows 上 .bat 文件需要通过 cmd.exe 执行
function runApksigner(apksigner, args) {
  if (isWin) {
    return spawnSync('cmd.exe', ['/c', apksigner, ...args], { encoding: 'utf8' })
  }
  return spawnSync(apksigner, args, { encoding: 'utf8' })
}

// 4. 签名配置（环境变量覆盖，debug keystore 作默认值）
function loadSignConfig() {
  const keystorePath =
    process.env.APK_KEYSTORE_PATH || join(homedir(), '.android', 'debug.keystore')
  const keyAlias = process.env.APK_KEY_ALIAS || 'androiddebugkey'
  const keystorePass = process.env.APK_KEYSTORE_PASS || 'android'
  const keyPass = process.env.APK_KEY_PASS || 'android'
  if (!existsSync(keystorePath)) {
    fail(
      `找不到 keystore：${keystorePath}\n` +
        'debug keystore 不存在时，先跑一次 Android Studio 的构建或执行：\n' +
        '  keytool -genkey -v -keystore ~/.android/debug.keystore ' +
        '-storepass android -alias androiddebugkey -keypass android ' +
        '-keyalg RSA -keysize 2048 -validity 10000',
    )
  }
  return { keystorePath, keyAlias, keystorePass, keyPass }
}

// 5. 递归查找所有 *-release-unsigned.apk
function findUnsignedApks() {
  const apkRoot = join(
    desktopDir,
    'src-tauri/gen/android/app/build/outputs/apk',
  )
  if (!existsSync(apkRoot)) {
    fail(
      `找不到 APK 输出目录：${apkRoot}\n` +
        '请先执行打包：npm --prefix desktop run android:apk',
    )
  }
  const results = []
  const stack = [apkRoot]
  while (stack.length) {
    const dir = stack.pop()
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) stack.push(full)
      else if (name.endsWith('-release-unsigned.apk')) results.push(full)
    }
  }
  if (results.length === 0) {
    fail(`${apkRoot} 下没有 *-release-unsigned.apk。请先执行打包。`)
  }
  return results
}

// 把 spawnSync 的 stdout/stderr Buffer 合成可读字符串
function asText(buf) {
  return (buf || '').toString().trim()
}

// 6. 对单个 APK 签名，产出同目录下的 *-signed.apk
function signApk(apksigner, cfg, apkPath) {
  const signedPath = apkPath.replace(/-unsigned\.apk$/, '-signed.apk')
  const args = [
    'sign',
    '--ks',
    cfg.keystorePath,
    '--ks-key-alias',
    cfg.keyAlias,
    '--ks-pass',
    `pass:${cfg.keystorePass}`,
    '--key-pass',
    `pass:${cfg.keyPass}`,
    '--v1-signing-enabled',
    'true',
    '--v2-signing-enabled',
    'true',
    '--v3-signing-enabled',
    'true',
    '--out',
    signedPath,
    apkPath,
  ]
  const r = runApksigner(apksigner, args)
  if (r.status !== 0) {
    console.error(`${RED}签名失败${RESET} ${relative(desktopDir, apkPath)}`)
    if (asText(r.stdout)) console.error(asText(r.stdout))
    if (asText(r.stderr)) console.error(asText(r.stderr))
    return false
  }
  return signedPath
}

// 7. 验证签名（apksigner verify），确认产物可用
function verifyApk(apksigner, signedPath) {
  const r = runApksigner(apksigner, ['verify', '--print-certs', signedPath])
  if (r.status !== 0) {
    console.error(`${RED}验证失败${RESET} ${relative(desktopDir, signedPath)}`)
    if (asText(r.stderr)) console.error(asText(r.stderr))
    return false
  }
  return true
}

function main() {
  const sdkDir = findSdkDir()
  const buildToolsDir = findBuildTools(sdkDir)
  const apksigner = resolveApksigner(buildToolsDir)
  const cfg = loadSignConfig()
  const apks = findUnsignedApks()

  info(`Android SDK      ${DIM}${sdkDir}${RESET}`)
  info(`build-tools      ${DIM}${relative(sdkDir, buildToolsDir)}${RESET}`)
  info(`keystore         ${DIM}${cfg.keystorePath}${RESET}`)
  info(`待签名 APK 数    ${apks.length}`)

  let ok = 0
  for (const apk of apks) {
    console.log(`\n→ ${relative(desktopDir, apk)}`)
    const signedPath = signApk(apksigner, cfg, apk)
    if (!signedPath) continue
    if (!verifyApk(apksigner, signedPath)) continue
    ok++
    const sizeMb = (statSync(signedPath).size / 1024 / 1024).toFixed(1)
    console.log(`${GREEN}已签名${RESET} ${relative(desktopDir, signedPath)} ${DIM}(${sizeMb} MB)${RESET}`)
  }

  console.log('')
  if (ok === apks.length) {
    console.log(`${GREEN}完成${RESET} 全部 ${ok} 个 APK 签名成功。`)
  } else {
    fail(`仅 ${ok}/${apks.length} 个 APK 签名成功。`)
  }
}

main()
