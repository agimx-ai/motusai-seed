import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const nextVersion = process.argv[2]?.trim()
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/

if (!nextVersion || !semverPattern.test(nextVersion)) {
  console.error('用法：npm run version:client -- <版本号>')
  console.error('示例：npm run version:client -- 0.1.2')
  process.exit(1)
}

const projectRoot = resolve(import.meta.dirname, '..')
const packagePath = resolve(projectRoot, 'package.json')
const lockPath = resolve(projectRoot, 'package-lock.json')

const [packageSource, lockSource] = await Promise.all([
  readFile(packagePath, 'utf8'),
  readFile(lockPath, 'utf8'),
])

const packageJson = JSON.parse(packageSource)
const packageLock = JSON.parse(lockSource)
const currentVersion = packageJson.version

if (typeof currentVersion !== 'string' || !semverPattern.test(currentVersion)) {
  throw new Error('package.json 中的客户端版本号无效。')
}
if (packageLock.version !== currentVersion || packageLock.packages?.['']?.version !== currentVersion) {
  throw new Error('package-lock.json 与 package.json 的客户端版本号不一致，请先修复后再升级。')
}

if (nextVersion === currentVersion) {
  console.log(`客户端已经是 ${nextVersion}，无需修改。`)
  process.exit(0)
}

packageJson.version = nextVersion
packageLock.version = nextVersion
packageLock.packages[''].version = nextVersion

await Promise.all([
  writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8'),
  writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`, 'utf8'),
])

console.log(`客户端版本已从 ${currentVersion} 升级到 ${nextVersion}。`)
console.log('SDK 版本未修改。')
