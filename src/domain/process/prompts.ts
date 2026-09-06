import type { ProcessDefinition, ProcessStep } from './types';

export function renderGoalTemplate(template: string, vars: { goal: string; artifactDir: string }): string {
  return template.replaceAll('{{goal}}', vars.goal).replaceAll('{{artifactDir}}', vars.artifactDir);
}

export function stepGoal(input: {
  catalog: ProcessDefinition[];
  step: ProcessStep;
  goal: string;
  artifactDir: string;
}): string {
  const primitive = input.catalog.find((p) => p.id === input.step.process);
  const template =
    input.step.goalTemplate ??
    primitive?.steps[0]?.goalTemplate ??
    `Execute process ${input.step.process} for: {{goal}}`;
  return renderGoalTemplate(template, { goal: input.goal, artifactDir: input.artifactDir });
}
