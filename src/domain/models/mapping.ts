import * as fs from 'node:fs';
import * as path from 'node:path';
import { coordinatorHome } from '../bindings';
import { shippedTemplatesRoot } from '../process/catalog';
import type { T3ModelMapEntry } from './types';

export function loadT3ToAaMapping(projectCwd?: string): T3ModelMapEntry[] {
  const files = [
    path.join(shippedTemplatesRoot(), 'models', 't3-to-aa.json'),
    path.join(coordinatorHome(), 'models', 't3-to-aa.json'),
  ];
  if (projectCwd) files.push(path.join(projectCwd, '.t3', 'models', 't3-to-aa.json'));
  const byKey = new Map<string, T3ModelMapEntry>();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { models?: T3ModelMapEntry[] };
    for (const row of parsed.models ?? []) {
      byKey.set(`${row.instanceHint ?? ''}::${row.t3Model}`, row);
    }
  }
  return [...byKey.values()];
}
