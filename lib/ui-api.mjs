// The one API HQ promises a plugin: the page frame, escaping, the info mark, tables, charts, markdown, and git and gh run
// read-only. Everything else under lib/ may change without notice. Versioned with the package: a function here is never
// removed or given a different meaning; a new one may be added.
import { layout, esc, urlPath } from './page.mjs';
import { info, dataTable } from './ui.mjs';
import { dayChart, hbars, spark, dotPlot, partsBar, stackBars, strip, duration, numbers } from './charts.mjs';
import { renderMarkdown } from './markdown.mjs';
import { runGit } from './git.mjs';
import { runGh } from './github.mjs';

export const UI_VERSION = 1;
export const ui = Object.freeze({ UI_VERSION, layout, esc, urlPath, info, dataTable, duration, numbers, dayChart, hbars, spark, dotPlot, partsBar, stackBars, strip, renderMarkdown, runGit, runGh });
