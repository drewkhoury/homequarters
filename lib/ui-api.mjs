// The one API HQ promises a plugin: the page frame, escaping, the info mark, tables, charts, markdown, git and gh run
// read-only, and (from UI_VERSION 2) a few pure helpers grouped by what they read: files, gh, git, claude, days and
// backlog. Everything else under lib/ may change without notice; homequarters/unstable names the parts a plugin may use
// that make no such promise. Versioned with the package: a function here is never removed or given a different
// meaning; a new one may be added.
import { layout, esc, urlPath } from './page.mjs';
import { info, dataTable } from './ui.mjs';
import { dayChart, hbars, spark, dotPlot, partsBar, stackBars, strip, duration, numbers } from './charts.mjs';
import { renderMarkdown } from './markdown.mjs';
import { runGit } from './git.mjs';
import { runGh, checksOf } from './github.mjs';
import { kindIn } from './files.mjs';
import { belongs, escapePath } from './conversations.mjs';
import { dayKey, dayStart } from './dora.mjs';
import { parseItem, check, openBlockers, DIR, STAGES } from './backlog.mjs';

export const UI_VERSION = 2;
export const ui = Object.freeze({
  UI_VERSION, layout, esc, urlPath, info, dataTable, duration, numbers, dayChart, hbars, spark, dotPlot, partsBar, stackBars, strip, renderMarkdown, runGit, runGh,
  kindIn,
  gh: Object.freeze({ checksOf }),
  git: Object.freeze({ belongs }),
  // the name Claude Code gives a checkout's folder under ~/.claude/projects
  claude: Object.freeze({ folderName: escapePath }),
  days: Object.freeze({ key: dayKey, start: dayStart }),
  // dir and stages are read when called: the manifest's backlog key sets them after this module loads
  backlog: Object.freeze({ parseItem, check, openBlockers, dir: () => DIR, stages: () => STAGES }),
});
