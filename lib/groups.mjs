// The groups the Code page's file tree can be narrowed to, from hq/groups.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The groups file the manifest names (docs.groups), or with none no groups: the Code page then offers All alone.
export const DEFAULT_GROUPS = [];
export function loadGroups(file) {
  if (!file) return DEFAULT_GROUPS;
  try { return JSON.parse(readFileSync(file, 'utf8')).groups; } catch { return DEFAULT_GROUPS; }
}

// Whether a repo path matches one of a group's patterns: 'dir/' for a folder, '*.ext' for a kind of file, else a file.
export const matches = (path, pattern) =>
  pattern.endsWith('/') ? path.startsWith(pattern) : pattern.startsWith('*.') ? path.toLowerCase().endsWith(pattern.slice(1).toLowerCase()) : path === pattern;

// Every group a path matches, in order. A pattern starting with ! takes paths out of the group again, so a folder can
// have a group of its own inside a wider one. More than one is a mistake in groups.json, which the unit test catches.
const inGroup = (path, g) => g.paths.some(p => !p.startsWith('!') && matches(path, p)) && !g.paths.some(p => p.startsWith('!') && matches(path, p.slice(1)));
export const groupsOf = (path, groups) => groups.filter(g => inGroup(path, g)).map(g => g.id);

// The one group a path belongs to: the first it matches, or the group with no patterns (Other).
export const groupOf = (path, groups) => groupsOf(path, groups)[0] || (groups.find(g => !g.paths.length) || {}).id || 'other';
