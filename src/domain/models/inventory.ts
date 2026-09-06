import type { T3Provider } from './types';

const STALE_MS = 10 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Normalize T3 ServerConfig.providers (forward-compatible). */
export function providersFromServerConfig(config: unknown): T3Provider[] {
  const rec = asRecord(config);
  const raw = rec?.providers;
  if (!Array.isArray(raw)) return [];
  const out: T3Provider[] = [];
  for (const item of raw) {
    const p = asRecord(item);
    if (!p) continue;
    const instanceId = asString(p.instanceId);
    if (!instanceId) continue;
    const statusRaw = asString(p.status) ?? 'error';
    const status: T3Provider['status'] =
      statusRaw === 'ready' || statusRaw === 'warning' || statusRaw === 'disabled' ? statusRaw : 'error';
    const authRec = asRecord(p.auth);
    const authStatus = asString(authRec?.status) ?? 'unknown';
    const modelsRaw = Array.isArray(p.models) ? p.models : [];
    const usageRec = asRecord(p.usageLimits);
    const windowsRaw = Array.isArray(usageRec?.windows) ? usageRec.windows : [];
    const unavailableRec = asRecord(usageRec?.unavailable);
    const unavailableReason = asString(unavailableRec?.reason);
    out.push({
      instanceId,
      driver: asString(p.driver),
      enabled: p.enabled !== false,
      installed: p.installed !== false,
      status,
      availability: asString(p.availability) === 'unavailable' ? 'unavailable' : 'available',
      auth: {
        status:
          authStatus === 'authenticated' || authStatus === 'unauthenticated' ? authStatus : 'unknown',
      },
      models: modelsRaw.flatMap((m) => {
        if (typeof m === 'string' && m.length > 0) return [{ slug: m, aliases: [] }];
        const mr = asRecord(m);
        const slug = asString(mr?.slug) ?? asString(mr?.id) ?? asString(mr?.alias) ?? asString(mr?.name);
        if (!slug) return [];
        const aliases = Array.isArray(mr?.aliases) ? mr.aliases.filter((a): a is string => typeof a === 'string') : [];
        return [{ slug, aliases }];
      }),
      usageLimits: usageRec
        ? {
            windows: windowsRaw.flatMap((w) => {
              const wr = asRecord(w);
              if (!wr) return [];
              const id = asString(wr.id) ?? 'window';
              const used = Number(wr.usedPercent ?? wr.used_percent ?? 0);
              return [{ id, usedPercent: Number.isFinite(used) ? used : 0, resetsAt: asString(wr.resetsAt) }];
            }),
            unavailable:
              unavailableReason === 'unsupported' || unavailableReason === 'probeFailed'
                ? { reason: unavailableReason, message: asString(unavailableRec?.message) }
                : undefined,
          }
        : undefined,
      checkedAt: asString(p.checkedAt),
    });
  }
  return out;
}

export function providerInventoryStale(providers: T3Provider[], now = Date.now()): boolean {
  if (providers.length === 0) return true;
  return providers.some((p) => {
    if (!p.checkedAt) return true;
    const t = Date.parse(p.checkedAt);
    if (!Number.isFinite(t)) return true;
    return now - t >= STALE_MS;
  });
}

export function needsProviderRefresh(providers: T3Provider[], now = Date.now()): boolean {
  if (providerInventoryStale(providers, now)) return true;
  return providers.some((p) => p.usageLimits?.unavailable?.reason === 'probeFailed');
}
