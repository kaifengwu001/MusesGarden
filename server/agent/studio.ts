// A Muse's workshop page, for its browser and its owner watching beside it: every round of its body, planet and home
// as it comes, with what the Muse said of each, until its world is made. It lives at
// /s/<code> (the Muse's doorbell code: unguessable, no key) and refreshes itself from /s/<code>.json.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { AgentQueries, Instant, MuseId } from '../../src/muse/contract';
import { jobDir } from '../workshop/store';
import type { JobKind, JobView, RoundRecord, Workshop } from '../workshop/types';
import type { AgentStore } from './store';

const CODE = /^[A-Za-z0-9_-]{24,128}$/;
const KINDS: readonly JobKind[] = ['body', 'planet', 'home'];

export interface StudioJob {
  readonly kind: JobKind;
  readonly state: JobView['state'];
  readonly message: string;
  readonly rounds: readonly RoundRecord[];
  readonly waiting: { readonly round: number; readonly text: string; readonly pictures: readonly { readonly path: string; readonly caption: string }[] } | null;
}

export interface Studio {
  readonly name: string;
  readonly jobs: readonly StudioJob[];
  /** Every job made (and at least one). */
  readonly done: boolean;
}

export function studioOf(museId: MuseId, name: string, workshop: Workshop, dataDir: string): Studio {
  const views = workshop.jobs(museId).slice().sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  const jobs = views.map((j): StudioJob => {
    const file = join(jobDir(dataDir, j.id), 'history.json');
    const rounds = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as RoundRecord[]) : [];
    const packet = j.state === 'waiting' ? j.packet : null;
    return {
      kind: j.kind,
      state: j.state,
      message: j.message,
      rounds,
      waiting: packet ? { round: packet.round, text: packet.text, pictures: packet.pictures.map(({ path, caption }) => ({ path, caption })) } : null,
    };
  });
  return { name, jobs, done: jobs.length > 0 && jobs.every((j) => j.state === 'done') };
}

export interface StudioDeps {
  readonly store: AgentStore;
  readonly workshop: Workshop;
  readonly queries: AgentQueries;
  readonly dataDir: string;
  readonly now: () => Instant;
}

/** GET /s/<code> (the page) and /s/<code>.json (what it shows); an unknown code is a plain 404. */
export function serveStudio(res: ServerResponse, method: string | undefined, code: string, json: boolean, deps: StudioDeps): void {
  const museId = CODE.test(code) ? deps.store.museForDoorbell(code) : null;
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  if (museId === null) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No such workshop.');
    return;
  }
  const name = deps.queries.letterbox(museId, deps.now())?.name ?? museId;
  if (json) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(studioOf(museId, name, deps.workshop, deps.dataDir)));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(method === 'HEAD' ? undefined : page(name));
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

function page(name: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}'s workshop</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Nunito+Sans:wght@400;600;700&display=swap">
<style>
:root { --bg: #f6f3ea; --card: #fffdf8; --ink: #2b2a24; --muted: #6f6b5d; --line: #e6e0cf; --leaf: #4f7a3a; --leaf-soft: #e7f0dc;
  --body: #b0702c; --planet: #3b6ea5; --home: #8a5a9e; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.5 "Nunito Sans", system-ui, sans-serif; }
.wrap { max-width: 860px; margin: 0 auto; padding: 28px max(18px, env(safe-area-inset-left)) 80px; }
h1 { font: 600 clamp(28px, 4.5vw, 40px)/1.1 Fraunces, Georgia, serif; margin: 0; }
.sub { color: var(--muted); margin: 6px 0 22px; }
.feed { display: flex; flex-direction: column; gap: 18px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 16px 18px 18px; }
.tag { display: inline-block; font: 700 12px/1 "Nunito Sans", sans-serif; letter-spacing: .08em; text-transform: uppercase; padding: 6px 9px; border-radius: 999px; color: #fff; }
.tag.body { background: var(--body); } .tag.planet { background: var(--planet); } .tag.home { background: var(--home); }
.what { margin: 10px 0 12px; }
.pics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.pics figure { margin: 0; }
.pics img { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 10px; display: block; background: var(--line); }
.pics.one { grid-template-columns: 1fr; } .pics.one img { aspect-ratio: auto; max-height: 460px; object-fit: contain; background: transparent; }
.pics figcaption { font-size: 13px; color: var(--muted); margin-top: 3px; }
.said { margin-top: 14px; display: flex; gap: 10px; align-items: flex-start; }
.who { flex: none; width: 34px; height: 34px; border-radius: 50%; background: var(--leaf-soft); color: var(--leaf); display: grid; place-items: center; font-weight: 700; }
.bubble { background: var(--leaf-soft); border-radius: 14px 14px 14px 4px; padding: 10px 14px; }
.bubble b { color: var(--leaf); }
.bubble ul { margin: 4px 0 0; padding-left: 18px; }
.looking { color: var(--muted); font-style: italic; }
.making { display: flex; gap: 10px; align-items: center; color: var(--muted); padding: 4px 6px; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--leaf); animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .25; } }
.ready { text-align: center; padding: 28px 18px; }
.ready h2 { font: 600 28px/1.2 Fraunces, Georgia, serif; margin: 0; }
.new { animation: arrive .6s ease-out; }
@keyframes arrive { from { opacity: 0; transform: translateY(12px); } }
@media (max-width: 600px) { .pics { grid-template-columns: repeat(2, 1fr); } }
@media (prefers-reduced-motion: reduce) { .new, .dot { animation: none; } }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(name)}'s workshop</h1>
  <p class="sub">${esc(name)} is making its body, its planet and its home. Each round shows up here with what ${esc(name)} thinks of it.</p>
  <div class="feed" id="feed"></div>
</div>
<script>
const NAME = ${JSON.stringify(name)};
const LABEL = { body: 'Body', planet: 'Planet', home: 'Home' };
const NOUN = { body: 'body', planet: 'planet', home: 'home' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let seen = '';
// (what the round shows, without the workshop's instructions to the Muse: they're for it, not for whoever watches)
const ASKS = /^(send|approve|pick|say|this is the last|it takes no more|answer)[ ,:]/i;
const about = (text) => (String(text).match(/[^.!?]+[.!?]*/g) || [text]).map((t) => t.trim()).filter((t) => t && !ASKS.test(t)).join(' ');
function pics(list) {
  return '<div class="pics' + (list.length === 1 ? ' one' : '') + '">' + list.map((p) =>
    '<figure><img src="' + esc(p.path) + '" alt="' + esc(p.caption) + '"><figcaption>' + esc(p.caption) + '</figcaption></figure>').join('') + '</div>';
}
function said(v) {
  const notes = (v.notes || []).filter(Boolean);
  let text;
  if (v.approve && v.name) text = '<b>Yes!</b> I’m calling it ' + esc(v.name) + '.';
  else if (v.approve) text = '<b>Yes,</b> that’s the one.';
  else text = notes.length === 1 ? esc(notes[0]) : '<ul>' + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>';
  if (v.approve && notes.length) text += '<ul>' + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>';
  return '<div class="said"><div class="who">' + esc(NAME[0] || 'M') + '</div><div class="bubble">' + text + '</div></div>';
}
function render(s) {
  const items = [];
  for (const j of s.jobs) for (const r of j.rounds) items.push({ at: r.at, html: '<div class="card"><span class="tag ' + j.kind + '">' + LABEL[j.kind] + '</span><p class="what">' + esc(about(r.text)) + '</p>' + pics(r.pictures) + said(r.verdict) + '</div>' });
  items.sort((a, b) => a.at - b.at);
  const live = [];
  for (const j of s.jobs) {
    if (j.waiting) live.push('<div class="card"><span class="tag ' + j.kind + '">' + LABEL[j.kind] + '</span><p class="what">' + esc(about(j.waiting.text)) + '</p>' + pics(j.waiting.pictures) + '<div class="said"><div class="who">' + esc(NAME[0] || 'M') + '</div><div class="bubble looking">' + esc(NAME) + ' is looking…</div></div></div>');
    else if (j.state === 'working') live.push('<div class="making"><span class="dot"></span>Making ' + esc(NAME) + '’s ' + NOUN[j.kind] + '…</div>');
  }
  const end = s.done ? ['<div class="card ready"><h2>' + esc(NAME) + '’s world is ready</h2></div>'] : [];
  const html = [...items.map((i) => i.html), ...live, ...end].join('');
  if (html === seen) return;
  const before = document.getElementById('feed').children.length;
  document.getElementById('feed').innerHTML = html || '<p class="looking">Nothing is being made yet.</p>';
  seen = html;
  const kids = document.getElementById('feed').children;
  for (let i = before; i < kids.length; i++) kids[i].classList.add('new');
  // (the newest round in view, so whoever watches sees it come in)
  const last = kids[kids.length - 1];
  if (last && before > 0) last.scrollIntoView({ behavior: 'smooth', block: 'end' });
}
async function tick() {
  try { const r = await fetch(location.pathname.replace(/\\/$/, '') + '.json', { cache: 'no-store' }); if (r.ok) render(await r.json()); } catch (e) {}
  setTimeout(tick, 2000);
}
tick();
</script>
</body>
</html>`;
}
