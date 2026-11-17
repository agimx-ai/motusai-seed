import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const finderDirectoryListing = `
ObjC.import('Foundation');

function run(argv) {
  const defaults = $.NSUserDefaults.alloc.initWithSuiteName('com.apple.finder');
  if (defaults.boolForKey('AppleShowAllFiles')) return 'null';

  const directory = $.NSURL.fileURLWithPath(argv[0]);
  const entries = $.NSFileManager.defaultManager.contentsOfDirectoryAtURLIncludingPropertiesForKeysOptionsError(
    directory, [$.NSURLNameKey], $.NSDirectoryEnumerationSkipsHiddenFiles, null
  );
  if (entries.isNil()) throw new Error('Directory enumeration failed');
  const names = [];
  for (let index = 0; index < entries.count; index++) {
    names.push(ObjC.unwrap(entries.objectAtIndex(index).lastPathComponent));
  }
  return JSON.stringify(names);
}
`

const explorerDirectoryListing = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$settings = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -ErrorAction SilentlyContinue
$showHidden = $settings.Hidden -eq 1
$showSystem = $settings.ShowSuperHidden -eq 1
if ($showHidden -and $showSystem) { 'null'; exit }

$names = Get-ChildItem -LiteralPath $env:MOTUSAI_FILE_LIST_DIRECTORY -Force | ForEach-Object {
  $hidden = ($_.Attributes -band [IO.FileAttributes]::Hidden) -ne 0
  $system = ($_.Attributes -band [IO.FileAttributes]::System) -ne 0
  if ((-not $hidden -or $showHidden) -and (-not ($hidden -and $system) -or $showSystem)) { $_.Name }
}
ConvertTo-Json -InputObject @($names) -Compress
`

function listedNames(stdout: string): ReadonlySet<string> | null {
  const names: unknown = JSON.parse(stdout)
  if (names === null) return null
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) {
    throw new Error('Invalid system directory listing')
  }
  return new Set(names)
}

async function readDirectoryPreference(path: string, limit = 64 * 1024) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null)
  if (!file) return ''
  try {
    if (!(await file.stat()).isFile()) return ''
    const content = Buffer.alloc(limit)
    const { bytesRead } = await file.read(content)
    return content.toString('utf8', 0, bytesRead)
  } finally {
    await file.close()
  }
}

function kdeBoolean(settings: string, group: string, key: string) {
  const section = settings.split(/^\[/m).find((entry) => entry.startsWith(`${group}]`))
  const line = section?.split(/\r?\n/).find((entry) => entry.split('=')[0]?.trim() === key)
  const value = line?.slice(line.indexOf('=') + 1).trim()
  return value === 'true' ? true : value === 'false' ? false : undefined
}

async function readDolphinVisibility(path: string) {
  const file = kdeBoolean(await readDirectoryPreference(join(path, '.directory')), 'Settings', 'HiddenFilesShown')
  if (file !== undefined) return file
  const attribute = await run('/usr/bin/getfattr', ['--only-values', '-n', 'user.kde.fm.viewproperties#1', '--', path],
    { timeout: 1_000, maxBuffer: 64 * 1024 }).catch(() => null)
  return kdeBoolean(attribute?.stdout || '', 'Settings', 'HiddenFilesShown')
}

async function linuxShowHidden(path: string, desktop: string) {
  const read = async (program: string, args: string[]) => {
    const result = await run(program, args, { timeout: 1_000, maxBuffer: 4 * 1024 }).catch(() => null)
    const value = result?.stdout.trim()
    return value === 'true' ? true : value === 'false' ? false : undefined
  }
  if (desktop.includes('kde')) {
    const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
    const general = await readDirectoryPreference(join(config, 'dolphinrc'))
    if (kdeBoolean(general, 'General', 'GlobalViewProps') === false) {
      const local = await readDolphinVisibility(path)
      if (local !== undefined) return local
    }
    const data = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
    return readDolphinVisibility(join(data, 'dolphin', 'view_properties', 'global'))
  }
  if (desktop.includes('xfce')) return read('/usr/bin/xfconf-query', ['-c', 'thunar', '-p', '/last-show-hidden'])
  if (desktop.includes('cinnamon')) return read('/usr/bin/gsettings', ['get', 'org.nemo.preferences', 'show-hidden-files'])
  if (desktop.includes('mate')) return read('/usr/bin/gsettings', ['get', 'org.mate.caja.preferences', 'show-hidden-files'])
  if (desktop.includes('gnome') || desktop.includes('unity')) {
    return await read('/usr/bin/gsettings', ['get', 'org.gtk.gtk4.Settings.FileChooser:/org/gtk/gtk4/settings/file-chooser/', 'show-hidden'])
      ?? await read('/usr/bin/gsettings', ['get', 'org.gtk.Settings.FileChooser', 'show-hidden'])
  }
}

export async function systemVisibleDirectoryNames(
  path: string,
  entryNames: readonly string[],
  platform = process.platform,
): Promise<ReadonlySet<string> | null> {
  const commandOptions = { timeout: 5_000, maxBuffer: 16 * 1024 * 1024 }
  if (platform === 'darwin') {
    const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', finderDirectoryListing, '--', path], commandOptions)
    return listedNames(stdout)
  }
  if (platform === 'win32') {
    const executable = win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const script = Buffer.from(explorerDirectoryListing, 'utf16le').toString('base64')
    const { stdout } = await run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', script], {
      ...commandOptions, windowsHide: true, env: { ...process.env, MOTUSAI_FILE_LIST_DIRECTORY: path },
    })
    return listedNames(stdout)
  }
  if (platform !== 'linux') return null
  const desktop = (process.env.XDG_CURRENT_DESKTOP || process.env.XDG_SESSION_DESKTOP || '').toLowerCase()
  if (await linuxShowHidden(path, desktop)) return null
  const hidden = new Set((await readDirectoryPreference(join(path, '.hidden'))).split(/\r?\n/))
  const hideBackups = desktop.includes('gnome') || desktop.includes('unity') || desktop.includes('cinnamon')
  return new Set(entryNames.filter((name) => !name.startsWith('.') && !hidden.has(name) && !(hideBackups && name.endsWith('~'))))
}
