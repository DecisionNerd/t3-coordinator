import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const { greet } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/** Smoke-test workflow from the Temporal scaffold. */
export async function example(name: string): Promise<string> {
  return greet(name);
}
