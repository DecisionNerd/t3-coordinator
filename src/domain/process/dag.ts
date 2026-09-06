import type { ProcessStep } from './types';

/** Dependent steps do not start until every listed predecessor has completed. */
export function stepDependenciesMet(step: ProcessStep, completed: Set<string>): boolean {
  return (step.dependsOn ?? []).every((id) => completed.has(id));
}

/** First incomplete step whose dependsOn are all done. File order is the ready queue. */
export function nextReadyStep(steps: ProcessStep[], completed: Set<string>): ProcessStep | undefined {
  return steps.find((step) => !completed.has(step.id) && stepDependenciesMet(step, completed));
}
