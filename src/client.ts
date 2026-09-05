import { Connection, Client } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import { nanoid } from 'nanoid';
import { TASK_QUEUE } from './domain/contracts';
import { assignmentWorkflow, example } from './workflows';

async function run() {
  const mode = process.argv[2] ?? 'example';
  const config = loadClientConnectConfig();
  const connection = await Connection.connect(config.connectionOptions);
  const client = new Client({ connection });

  if (mode === 'example') {
    const handle = await client.workflow.start(example, {
      taskQueue: TASK_QUEUE,
      args: ['Temporal'],
      workflowId: 'example-' + nanoid(),
    });
    console.log(`Started ${handle.workflowId}`);
    console.log(await handle.result());
    return;
  }

  if (mode === 'assignment') {
    const handle = await client.workflow.start(assignmentWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: 'assignment-' + nanoid(),
      args: [
        {
          repo: process.env.COORD_REPO ?? 'scratch',
          specSha: process.env.COORD_SPEC_SHA ?? 'deadbeef',
          baseCommit: process.env.COORD_BASE_COMMIT ?? 'deadbeef',
          environmentId: process.env.COORD_ENV_ID ?? 'env-local',
          instanceId: process.env.COORD_INSTANCE_ID ?? 'opencode',
          modelId: process.env.COORD_MODEL_ID ?? 'glm',
          goal: process.env.COORD_GOAL ?? 'noop',
          projectCwd: process.env.COORD_PROJECT_CWD ?? process.cwd(),
          baseBranch: process.env.COORD_BASE_BRANCH ?? 'main',
          worktreePath: process.env.COORD_WORKTREE || undefined,
          deliveryGraceMs: Number(process.env.COORD_GRACE_MS ?? 10_000),
        },
      ],
    });
    console.log(`Started ${handle.workflowId}`);
    console.log(await handle.result());
    return;
  }

  throw new Error(`Unknown mode: ${mode}. Use example|assignment`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
