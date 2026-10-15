// QuestKeep's GitHub names, which the dora fixtures carry: the delivery key its manifest would hold. Until 15 October
// these were regexes baked into lib/dora.mjs; a test that reads the fixtures configures them first.
export const QK_DELIVERY = { userPaths: ['web'], tz: 'America/New_York', deployWorkflow: '.github/workflows/deploy.yml', testWorkflow: '.github/workflows/test.yml',
  gateJobs: ['test', 'test (a)', 'test (b)', 'laptop'], deployJob: 'deploy', smokeJob: 'smoke', deploySteps: ['Deploy to production', 'Run make deploy'], reuseSteps: ['Reuse a gate that passed'], testSteps: ['Run the tests'] };
