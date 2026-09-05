import { runWorker } from './runWorker';

runWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});
