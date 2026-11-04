import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { agentsMd, museCodeBuilder } from './builder';

const tmp = mkdtempSync(join(tmpdir(), 'planet-builder-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A stand-in for `muse`: records how it was called (and what it read) and edits the workspace, or sleeps. */
function fakeMuse(record: string): string {
  const bin = join(tmp, 'muse');
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('Muse Code 0.0.0'); process.exit(0); }
let key = '';
process.stdin.on('data', (c) => (key += c));
process.stdin.on('end', () => {
  const at = (flag) => args[args.indexOf(flag) + 1];
  const prompt = fs.readFileSync(at('--prompt-file'), 'utf8');
  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, key, prompt, cwd: process.cwd() }));
  if (prompt.includes('SLEEP')) return setTimeout(() => {}, 60000);
  fs.writeFileSync(at('--workspace') + '/shore.ts', 'export const SHORE = 1;\\n');
  console.log(JSON.stringify({ type: 'done' }));
});
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

describe('Muse Code as the builder', () => {
  const record = join(tmp, 'record.json');
  const workspace = join(tmp, 'environments/muse-test');
  mkdirSync(workspace, { recursive: true });
  const instructions = agentsMd({ title: 'Pale Tide Pools', contract: 'Pale Tide Pools\n\nIt must show:\n- still pools', notes: ['shorter grass', 'slate rocks'], draft: 2 });

  it('isn’t available without the command or a key', async () => {
    expect(await museCodeBuilder({ bin: join(tmp, 'nowhere'), apiKey: () => 'k' }).available()).toBe(false);
    expect(await museCodeBuilder({ bin: fakeMuse(record), apiKey: () => '' }).available()).toBe(false);
    expect(await museCodeBuilder({ bin: fakeMuse(record), apiKey: () => 'k' }).available()).toBe(true);
  });

  it('runs headless in the planet’s folder, the key on stdin and every instruction in the prompt file', async () => {
    const builder = museCodeBuilder({ bin: fakeMuse(record), apiKey: () => 'secret-key' });
    const out = await builder.run({ workspace, instructions, prompt: 'Answer the notes.', timeoutMs: 30_000 });
    expect(out.ok).toBe(true);
    expect(out.log).toContain('"type":"done"');
    const seen = JSON.parse(readFileSync(record, 'utf8')) as { args: string[]; key: string; prompt: string; cwd: string };
    expect(seen.args).toEqual(['exec', '--api-key-stdin', '--model', 'muse-spark-1.3', '--reasoning-effort', 'low', '--workspace', workspace, '--prompt-file', expect.any(String) as string, '--json']);
    expect(seen.key).toBe('secret-key');
    expect(seen.args.join(' ')).not.toContain('secret-key');
    expect(seen.prompt).toContain('Edit only files in this folder');
    expect(seen.prompt).toContain('1. shorter grass');
    expect(seen.prompt).toContain('- still pools');
    expect(seen.prompt.trimEnd().endsWith('Answer the notes.')).toBe(true);
    expect(existsSync(seen.args[9])).toBe(false); // the prompt file is cleaned up
    expect(readFileSync(join(workspace, 'AGENTS.md'), 'utf8')).toBe(instructions);
    expect(existsSync(join(workspace, 'shore.ts'))).toBe(true);
  });

  it('stops a run at its time limit and says so', async () => {
    const builder = museCodeBuilder({ bin: fakeMuse(record), apiKey: () => 'k' });
    const out = await builder.run({ workspace, instructions: 'SLEEP', prompt: 'wait', timeoutMs: 1_500 });
    expect(out.ok).toBe(false);
    expect(out.log).toMatch(/^stopped after/);
  }, 20_000);
});
