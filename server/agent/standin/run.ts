// A stand-in Muse, for tests only (never in a real garden): an agent on Meta's chat completions that follows
// CONNECTOR.md through the garden's connector, does its first visit and one check-in, and is scored.
//   npx tsx server/agent/standin/run.ts --server <url> --key <key> [--model muse-spark-1.3-contributor] [--steps 40]
//     [--effort low|medium|high] [--out transcript.json]
//   npx tsx server/agent/standin/run.ts --rescore transcript.json   (scores a saved run again, no model calls)
// --steps caps the model's turns in each session. It reads MODEL_API_KEY from the environment, or from
// ~/.muse-garden.env. Its Memory is the privacy test's (server/fixtures/privacy/MEMORY.sensitive.md), so the
// contributor model only ever sees fixtures. Exits 1 when the score fails.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { DEFAULT_STANDIN_MODEL, metaModel } from './model';
import type { CallRecord } from './loop';
import { formatScore, score } from './score';
import { runStandin } from './standin';
import { PLANTED } from './stub';

const { values } = parseArgs({
  options: {
    rescore: { type: 'string' },
    server: { type: 'string' },
    key: { type: 'string' },
    model: { type: 'string', default: DEFAULT_STANDIN_MODEL },
    steps: { type: 'string', default: '40' },
    effort: { type: 'string', default: 'medium' },
    out: { type: 'string' },
  },
});
if (values.rescore) {
  // Scores a saved run again (--out's file) without calling the model.
  const saved = JSON.parse(readFileSync(values.rescore, 'utf8')) as { transcript: CallRecord[] };
  const again = score(saved.transcript, { planted: PLANTED });
  console.info(formatScore(again));
  process.exit(again.pass ? 0 : 1);
}
if (!values.server || !values.key) {
  console.error('usage: run.ts --server <url> --key <key> [--model <id>] [--steps 40] [--effort medium] [--out file.json]');
  process.exit(2);
}
const effort = values.effort;
if (effort !== 'minimal' && effort !== 'low' && effort !== 'medium' && effort !== 'high') throw new Error('--effort is minimal, low, medium or high');

const apiKey = process.env.MODEL_API_KEY ?? envFile(`${homedir()}/.muse-garden.env`).MODEL_API_KEY;
if (!apiKey) {
  console.error('MODEL_API_KEY is unset (and not in ~/.muse-garden.env)');
  process.exit(2);
}

const started = Date.now();
const run = await runStandin({
  server: values.server,
  key: values.key,
  model: metaModel({ apiKey, model: values.model, effort, ...(process.env.MUSE_LLM_BASE_URL ? { baseUrl: process.env.MUSE_LLM_BASE_URL } : {}) }),
  steps: Number(values.steps),
  planted: PLANTED,
  log: (line) => console.info(line),
});
for (const s of run.sessions) console.info(`${s.session}: ${s.steps} turns, ${s.stopped}${s.final ? `\n  "${s.final.replace(/\s+/g, ' ').slice(0, 600)}"` : ''}`);
console.info(`to its owner: ${run.toOwner.length} messages`);
for (const m of run.toOwner) console.info(`  > ${m.replace(/\s+/g, ' ').slice(0, 400)}`);
console.info(`${run.transcript.length} calls in ${Math.round((Date.now() - started) / 1000)} s`);
console.info(formatScore(run.score));
if (values.out) writeFileSync(values.out, JSON.stringify({ model: values.model, sessions: run.sessions, toOwner: run.toOwner, transcript: run.transcript, score: run.score }, null, 2));
process.exit(run.score.pass ? 0 : 1);

/** KEY=value lines, with or without `export`. */
function envFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
