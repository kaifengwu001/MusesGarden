// Tripo costs real credits, so it's spent only on purpose: never in tests, never without TRIPO_LIVE=1, at most
// TRIPO_DAILY_CAP runs a day (default 1, the owner's ask: test with the fake, spend once), and never twice for the same picture (the caller caches by hash).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SpendRecord {
  readonly at: string;
  readonly hash: string;
  readonly purpose: string;
}

export class TripoBudget {
  constructor(
    private readonly ledger: string,
    private readonly cap = Number(process.env.TRIPO_DAILY_CAP ?? 1),
    private readonly live = process.env.TRIPO_LIVE === '1',
  ) {}

  static hash(image: Buffer): string {
    return createHash('sha256').update(image).digest('hex');
  }

  private read(): SpendRecord[] {
    return existsSync(this.ledger) ? (JSON.parse(readFileSync(this.ledger, 'utf8')) as SpendRecord[]) : [];
  }

  /** Throws a plain reason when a run isn't allowed; otherwise records it. Call just before the paid request. */
  spend(image: Buffer, purpose: string, now = new Date()): void {
    if (!this.live) throw new Error('Tripo is off: set TRIPO_LIVE=1 to spend credits (tests always use the fake)');
    const day = now.toISOString().slice(0, 10);
    const records = this.read();
    const today = records.filter((r) => r.at.startsWith(day)).length;
    if (today >= this.cap) throw new Error(`Tripo's daily cap is reached (${today} of ${this.cap} runs today)`);
    mkdirSync(dirname(this.ledger), { recursive: true });
    writeFileSync(this.ledger, JSON.stringify([...records, { at: now.toISOString(), hash: TripoBudget.hash(image), purpose }], null, 2));
  }
}
