import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { versionPattern } from './semver.mjs'

const projectRoot = resolve(import.meta.dirname, '..')

function requirePublishableVersion(version) {
  if (typeof version !== 'string' || !versionPattern.test(version)) {
    throw new Error('用法：npm run version:client -- <版本号>（同时更新客户端和 SDK）')
  }
  if (version.includes('+')) {
    throw new Error('客户端与 SDK 绑定发布不使用 +构建元数据，请使用补丁版本号或预发布后缀。')
  }
}

async function readVersions(root) {
  const paths = ['package.json', 'package-lock.json', 'packages/seed-sdk/package.json']
    .map((path) => resolve(root, path))
  const [client, lock, sdk] = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))))

  for (const [name, version] of [['客户端', client.version], ['SDK', sdk.version]]) {
    if (typeof version !== 'string' || !versionPattern.test(version)) {
      throw new Error(`${name} package.json 中的版本号无效。`)
    }
  }
  if (lock.version !== client.version || lock.packages?.['']?.version !== client.version) {
    throw new Error('package-lock.json 与 package.json 的客户端版本号不一致，请先修复后再升级。')
  }
  if (lock.packages?.['packages/seed-sdk']?.version !== sdk.version) {
    throw new Error('package-lock.json 与 SDK package.json 的版本号不一致，请先修复后再升级。')
  }
  return { paths, client, lock, sdk }
}

export async function checkReleaseVersions(root = projectRoot) {
  const { client, sdk } = await readVersions(root)
  requirePublishableVersion(client.version)
  if (client.version !== sdk.version) {
    throw new Error(`客户端 ${client.version} 与 SDK ${sdk.version} 版本不一致。请用 npm run version:client -- <新版本号> 同步准备下一版。`)
  }
  return client.version
}

export async function updateClientVersion(nextVersion, root = projectRoot) {
  requirePublishableVersion(nextVersion)
  const { paths, client, lock, sdk } = await readVersions(root)
  if (nextVersion === client.version) {
    if (sdk.version !== nextVersion) {
      throw new Error('不能沿用已有客户端版本重新绑定 SDK，请为下一次发布指定新版本号。')
    }
    return `客户端和 SDK 已经是 ${nextVersion}，无需修改。`
  }

  const previous = `客户端 ${client.version}、SDK ${sdk.version}`
  client.version = nextVersion
  sdk.version = nextVersion
  lock.version = nextVersion
  lock.packages[''].version = nextVersion
  lock.packages['packages/seed-sdk'].version = nextVersion

  await Promise.all([client, lock, sdk].map((value, index) =>
    writeFile(paths[index], `${JSON.stringify(value, null, 2)}\n`, 'utf8'),
  ))
  return `${previous} 已同步更新为 ${nextVersion}。`
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    if (process.argv.length !== 3) throw new Error('用法：npm run version:client -- <版本号>；只校验用 npm run version:check。')
    const argument = process.argv[2].trim()
    console.log(argument === '--check'
      ? `客户端和 SDK 版本一致：${await checkReleaseVersions()}`
      : await updateClientVersion(argument))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
