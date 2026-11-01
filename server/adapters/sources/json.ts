// Narrowing helpers for parsing external JSON (API responses, fixture files) at the boundary.

export function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${what}: expected an object`);
  return v as Record<string, unknown>;
}

export function arr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${what}: expected an array`);
  return v;
}

export function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new Error(`${what}: expected a string`);
  return v;
}

export function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what}: expected a number`);
  return v;
}

export function optStr(v: unknown, what: string): string | undefined {
  return v === undefined ? undefined : str(v, what);
}

export function strs(v: unknown, what: string): string[] {
  return arr(v, what).map((s, i) => str(s, `${what}[${i}]`));
}
