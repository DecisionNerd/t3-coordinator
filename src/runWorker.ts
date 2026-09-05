import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { TASK_QUEUE } from './domain/contracts';

export interface RunWorkerOptions {
  address?: string;
  namespace?: string;
}

export async function runWorker(options: RunWorkerOptions = {}): Promise<void> {
  const address = options.address ?? process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = options.namespace ?? process.env.TEMPORAL_NAMESPACE ?? 'default';

  const connection = await NativeConnection.connect({ address });
  try {
    const worker = await Worker.create({
      connection,
      namespace,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./workflows'),
      activities,
    });
    console.error(`[t3-coordinator] worker listening on queue=${TASK_QUEUE} @ ${address}`);
    await worker.run();
  } finally {
    await connection.close();
  }
}
