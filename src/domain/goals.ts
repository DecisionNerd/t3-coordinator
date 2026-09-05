import * as fs from 'node:fs';
import * as path from 'node:path';
import { coordinatorHome } from './bindings';

export interface OperatorGoal {
  id?: string;
  text: string;
  priority?: number;
}

export interface GoalsFile {
  version: 1;
  goals: OperatorGoal[];
  notes?: string;
}

export function goalsJsonPath(home = coordinatorHome()): string {
  return path.join(home, 'goals.json');
}

export function goalsMdPath(home = coordinatorHome()): string {
  return path.join(home, 'goals.md');
}

/** Load operator goals if present (JSON preferred, else markdown bullets/lines). */
export function readGoals(home = coordinatorHome()): GoalsFile | null {
  const jsonPath = goalsJsonPath(home);
  if (fs.existsSync(jsonPath)) {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as GoalsFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.goals)) {
      throw new Error(`Invalid goals file: ${jsonPath}`);
    }
    return parsed;
  }
  const mdPath = goalsMdPath(home);
  if (fs.existsSync(mdPath)) {
    const text = fs.readFileSync(mdPath, 'utf8');
    const goals = text
      .split('\n')
      .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
      .filter((l) => l && !l.startsWith('#'));
    if (goals.length === 0) return { version: 1, goals: [], notes: text.trim() || undefined };
    return {
      version: 1,
      goals: goals.map((text, i) => ({ id: `md-${i + 1}`, text })),
    };
  }
  return null;
}
