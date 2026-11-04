// npm run agent:key -- <museId> [--name <Name>] [--planet <id>] [--look <id>] [--timezone <zone>] [--server <url>]
// Makes <museId> a real Muse (adding it to the garden if it isn't there yet), then gives it a new API key and its
// doorbell. It asks the running garden server (default http://localhost:8787, or MUSE_PORT) with the admin token the
// server wrote at boot to <MUSE_DATA or .muse>/admin.token. A new key replaces the old one; the doorbell stays.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const USAGE = 'usage: npx tsx server/cli/agent-key.ts <museId> [--name <Name>] [--planet <id>] [--look <id>] [--timezone <zone>] [--server <url>]';

interface Minted {
  readonly muse: string;
  readonly added: boolean;
  readonly key: string;
  readonly connector: string;
  readonly doorbell: string;
  readonly guide: string;
}

function fail(line: string): never {
  console.error(line);
  process.exit(1);
}

function adminToken(dataDir: string): string {
  const path = join(dataDir, 'admin.token');
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return fail(`No admin token at ${path}: start the garden server first (npm run serve), with the same MUSE_DATA.`);
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      planet: { type: 'string' },
      look: { type: 'string' },
      timezone: { type: 'string' },
      server: { type: 'string' },
    },
  });
  const [muse] = positionals;
  if (muse === undefined || positionals.length > 1) fail(USAGE);
  const server = (values.server ?? process.env.MUSE_SERVER ?? `http://localhost:${process.env.MUSE_PORT ?? 8787}`).replace(/\/+$/, '');
  const token = adminToken(process.env.MUSE_DATA ?? '.muse');
  const body = {
    muse,
    ...(values.name === undefined ? {} : { name: values.name }),
    ...(values.planet === undefined ? {} : { planet: values.planet }),
    ...(values.look === undefined ? {} : { look: values.look }),
    timezone: values.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const res = await fetch(`${server}/api/agent-admin/keys`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => fail(`The garden server isn't answering at ${server}: start it with npm run serve.`));
  const reply = (await res.json().catch(() => null)) as (Minted & { readonly error?: string }) | null;
  if (!res.ok || reply === null) fail(`${res.status}: ${reply?.error ?? 'the server refused'}`);

  const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(reply.connector);
  console.info(`${reply.muse} is a real Muse${reply.added ? ' (new to the garden)' : ''}. Its key, shown this once (only its hash is kept):`);
  console.info('');
  console.info(`  ${reply.key}`);
  console.info('');
  console.info(`Connector URL: ${reply.connector}`);
  console.info(`Doorbell:      ${reply.doorbell}`);
  console.info(`Guide:         ${reply.guide}`);
  console.info('');
  console.info("Paste the key into the app's connector setup (never into a chat with Muse).");
  if (local) console.info('These links say localhost: start the server with MUSE_PUBLIC_ORIGIN=https://<tunnel host> to give Muse the public ones.');
}

await main();
