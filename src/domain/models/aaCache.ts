import * as fs from 'node:fs';
import * as path from 'node:path';
import { coordinatorHome } from '../bindings';
import { AA_TTL_MS } from '../process/types';
import type { AaCacheFile, AaModelRow } from './types';

export function aaCachePath(home = coordinatorHome()): string {
  return path.join(home, 'cache', 'aa-llms.json');
}

function readAaKeyFile(home = coordinatorHome()): string | undefined {
  const file = path.join(home, 'aa-api-key');
  if (!fs.existsSync(file)) return undefined;
  return fs.readFileSync(file, 'utf8').trim() || undefined;
}

export function readAaCache(filePath = aaCachePath()): AaCacheFile | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as AaCacheFile;
}

export function writeAaCache(cache: AaCacheFile, filePath = aaCachePath()): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

export function aaCacheStale(cache: AaCacheFile | null, now = Date.now(), ttlMs = AA_TTL_MS): boolean {
  if (!cache) return true;
  const fetched = Date.parse(cache.fetchedAt);
  if (!Number.isFinite(fetched)) return true;
  return now - fetched >= ttlMs;
}

export async function refreshAaCatalogIfStale(input: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: number;
  cachePath?: string;
}): Promise<{ cache: AaCacheFile | null; fetched: boolean; rankingSource: 'aa' | 'aa_stale' | 'unranked' }> {
  const filePath = input.cachePath ?? aaCachePath();
  const existing = readAaCache(filePath);
  const now = input.now ?? Date.now();
  if (!aaCacheStale(existing, now)) {
    return { cache: existing, fetched: false, rankingSource: 'aa' };
  }
  const key =
    input.apiKey ??
    process.env.AA_API_KEY ??
    process.env.ARTIFICIAL_ANALYSIS_API_KEY ??
    readAaKeyFile();
  if (!key) {
    if (existing) return { cache: existing, fetched: false, rankingSource: 'aa_stale' };
    return { cache: null, fetched: false, rankingSource: 'unranked' };
  }
  const fetchFn = input.fetchImpl ?? fetch;
  try {
    const res = await fetchFn('https://artificialanalysis.ai/api/v2/data/llms/models', {
      headers: { 'x-api-key': key, Accept: 'application/json' },
    });
    if (!res.ok) {
      if (existing) return { cache: existing, fetched: false, rankingSource: 'aa_stale' };
      return { cache: null, fetched: false, rankingSource: 'unranked' };
    }
    const body = (await res.json()) as { data?: AaModelRow[] };
    const cache: AaCacheFile = {
      fetchedAt: new Date(now).toISOString(),
      data: body.data ?? [],
    };
    writeAaCache(cache, filePath);
    return { cache, fetched: true, rankingSource: 'aa' };
  } catch {
    if (existing) return { cache: existing, fetched: false, rankingSource: 'aa_stale' };
    return { cache: null, fetched: false, rankingSource: 'unranked' };
  }
}
