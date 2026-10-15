// The problem register's stages: where a problem was found, and where it should have been caught. Earliest first, so
// "found later than it should have been" compares two positions. They come from two places:
//   - the project's pipeline file (hq.json tests.pipeline), whose `stages` list names its steps' stages in order, one of
//     them marked `merge: true` as the point after which a problem has reached users; each step names its `stage`
//   - the five HQ ships for the people and agents that find most problems: self, reviewer and you before the merge,
//     you-after and users after it
// A project with no pipeline file, or one that names no stages, gets DEFAULT_STAGES. A stage id is never renamed, only
// retired: a stage may list the ids it `was` so recorded lines still read, and the fixed five carry QuestKeep's old names.
export const FIXED = [
  ['self', 'The agent itself', 'The agent doing the work noticed before anything ran.'],
  ['reviewer', 'Reviewer agent', 'A reviewer agent read the change.'],
  ['you', 'You, in review', 'The person you work with noticed before the merge.'],
  ['you-after', 'You, after the merge', 'The person you work with noticed it live.'],
  ['users', 'Users', 'It reached users and showed in what the app records.'],
];
const BEFORE = ['self', 'reviewer', 'you'], AFTER = ['you-after', 'users'];
export const FIXED_WAS = { you: ['person'], 'you-after': ['person-after'], users: ['players'] };

export const DEFAULT_STAGES = [
  { id: 'checks', label: 'Checks before the merge', about: 'The tests and gates that run before a change merges.' },
  { id: 'merge', label: 'The merge', about: 'The change merged, and went live.', merge: true },
  { id: 'after', label: 'Checks after the merge', about: 'The tests that run once the change is live.' },
];

const ID = /^[a-z][a-z0-9-]{0,30}$/;
const FIXED_IDS = new Set(FIXED.map(([k]) => k));
const OLD_NAME = Object.fromEntries(Object.entries(FIXED_WAS).flatMap(([k, was]) => was.map(w => [w, k])));

// The stage list a pipeline file gives, with HQ's fixed five placed around it:
// { stages: [[id, label, about]], merge: id, aliases: { old: id }, resultStages: { 'where/task': id }, warnings }.
// merge is the first stage after the merge, which is you-after when the file marks none.
export function stagesFrom(pipeline) {
  const warnings = [], aliases = { ...OLD_NAME }, resultStages = {};
  const given = pipeline && Array.isArray(pipeline.stages) && pipeline.stages.length ? pipeline.stages : DEFAULT_STAGES;
  const own = [], seen = new Set();
  let mergeAt = -1;
  given.forEach((raw, i) => {
    const s = typeof raw === 'string' ? { id: raw } : raw && typeof raw === 'object' ? raw : null;
    const id = s && typeof s.id === 'string' ? s.id : '';
    if (!ID.test(id)) { warnings.push(`pipeline stage ${i + 1} ${JSON.stringify(s ? s.id : raw)} should be a short lower-case id`); return; }
    if (FIXED_IDS.has(id)) { warnings.push(`pipeline stage "${id}" is one of HQ's own and is left out`); return; }
    if (OLD_NAME[id]) { warnings.push(`pipeline stage "${id}" is an old name of "${OLD_NAME[id]}" and is left out`); return; }
    if (seen.has(id)) { warnings.push(`pipeline names stage "${id}" twice`); return; }
    seen.add(id);
    if (s.merge === true && mergeAt < 0) mergeAt = own.length;
    for (const w of Array.isArray(s.was) ? s.was : []) {
      if (typeof w !== 'string' || seen.has(w)) continue;
      if (FIXED_IDS.has(w)) warnings.push(`pipeline stage "${id}" says it was "${w}", which is HQ's own stage; left out`);
      else if (OLD_NAME[w]) warnings.push(`pipeline stage "${id}" says it was "${w}", an old name of HQ's "${OLD_NAME[w]}"; left out`);
      else aliases[w] = id;
    }
    own.push([id, typeof s.label === 'string' && s.label.trim() ? s.label : id, typeof s.about === 'string' ? s.about : '']);
  });
  if (mergeAt < 0) { warnings.push('pipeline: no stage is marked merge, so every stage is read as before the merge'); mergeAt = own.length; }
  const fixed = id => FIXED.find(([k]) => k === id);
  const stages = [fixed('self'), ...own.slice(0, mergeAt), ...BEFORE.slice(1).map(fixed), ...own.slice(mergeAt), ...AFTER.map(fixed)];
  const merge = own[mergeAt] ? own[mergeAt][0] : 'you-after';
  // which stage a recorded result stands for: the step (or part, which takes its step's stage) whose results name it
  for (const path of (pipeline && Array.isArray(pipeline.paths) ? pipeline.paths : [])) {
    for (const step of Array.isArray(path.steps) ? path.steps : []) {
      if (step.stage !== undefined && !seen.has(step.stage)) warnings.push(`pipeline step "${step.title}" names stage ${JSON.stringify(step.stage)}, which its stages list does not have`);
      for (const s of [step, ...(Array.isArray(step.parts) ? step.parts : [])]) {
        const stage = s.stage !== undefined ? s.stage : step.stage;
        if (!seen.has(stage)) continue;
        for (const r of Array.isArray(s.results) ? s.results : []) if (r && r.where && r.task) resultStages[`${r.where}/${r.task}`] ||= stage;
      }
    }
  }
  return { stages, merge, aliases, resultStages, warnings };
}
