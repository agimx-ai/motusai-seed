import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

test('desktop packaging uses current build scripts without the removed Python preparation', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['macos', 'windows']) {
    const steps = workflow.jobs[name].steps;
    assert.ok(!steps.some((step) => step.uses?.startsWith('astral-sh/setup-uv@')));
    const commands = steps.map((step) => step.run ?? '').join('\n');
    assert.ok(!commands.includes('python:prepare'));
    assert.ok(commands.includes('npm run build'));
    for (const [, script] of commands.matchAll(/npm run ([a-z0-9:-]+)/g)) {
      assert.equal(typeof scripts[script], 'string', `Missing packaging script: ${script}`);
    }
  }
});
