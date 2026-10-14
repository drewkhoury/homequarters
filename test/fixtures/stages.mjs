// QuestKeep's pipeline as its hq/pipeline.json names it, cut down to the stages and the steps that carry results. Tests
// that pin the problem register's rules use these stages, since the register's recorded events and QuestKeep's fix
// commits name them; the shipped default (lib/stages.mjs) is tested on its own.
import { configureStages } from '../../lib/problems.mjs';
import { stagesFrom } from '../../lib/stages.mjs';

export const QK_PIPELINE = {
  schema: 1,
  stages: [
    { id: 'test-fast', label: 'make test-fast', about: 'The fast unit tests, run by hand or by an agent.' },
    { id: 'pre-push', label: 'pre-push', about: 'The pre-push hook refused the push.' },
    { id: 'smoke', label: 'Smoke test', about: 'A browser smoke test run with make smoke or make docker-smoke.' },
    { id: 'pr-gate', label: 'PR gate', about: 'The pull request gate on the laptop runner.' },
    { id: 'merge', label: 'The merge', about: 'The merge, which is also the deploy: its deploy job.', merge: true },
    { id: 'prod-smoke', label: 'Production smoke test', about: 'The smoke test against the live site after a deploy.' },
    { id: 'nightly', label: 'Nightly long set', about: 'The long set after.yml runs each night.' },
  ],
  paths: [
    { id: 'github', title: 'Pushed to GitHub', steps: [
      { title: 'Pre-push hook', stage: 'pre-push', sets: ['unit'] },
      { title: 'CI gate', stage: 'pr-gate', sets: ['gate'], results: [{ where: 'ci', task: 'gate' }, { where: 'laptop', task: 'gate' }],
        parts: [{ title: 'Half a', sets: ['rules'], results: [{ where: 'ci', task: 'rules' }] }] },
      { title: 'Deploy', stage: 'merge' },
      { title: 'Smoke test in production', stage: 'prod-smoke' },
      { title: 'Long set', stage: 'nightly', sets: ['after'], results: [{ where: 'ci', task: 'after' }, { where: 'laptop', task: 'after' }] },
    ] },
    { id: 'laptop', title: 'Deploying from the laptop', steps: [
      { title: 'Container gate', stage: 'pr-gate', sets: ['unit', 'rules', 'gate'], results: [{ where: 'container', task: 'docker-gate' }] },
      { title: 'Deploy', stage: 'merge' },
    ] },
  ],
};

// The register configured with QuestKeep's stages, for a test file that names them.
export function useQuestKeepStages() { configureStages(stagesFrom(QK_PIPELINE)); }
