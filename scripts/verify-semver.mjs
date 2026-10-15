import assert from 'node:assert/strict'
import test from 'node:test'
import { isPrereleaseVersion, versionPattern } from './semver.mjs'

test('client versions use strict SemVer', () => {
  for (const version of ['1.2.3', '1.2.3-dev.1', '1.2.3-beta.10', '1.2.3-rc.1+build.5', '1.2.3+build.1'])
    assert.ok(versionPattern.test(version), version)
  for (const version of ['01.2.3', '1.02.3', '1.2.03', '1.2.3-dev..1', '1.2.3-01', '1.2.3+'])
    assert.ok(!versionPattern.test(version), version)
})

test('client release channel follows prerelease identifiers', () => {
  assert.equal(isPrereleaseVersion('1.2.3-dev.1+build.5'), true)
  assert.equal(isPrereleaseVersion('1.2.3+build.5'), false)
})
