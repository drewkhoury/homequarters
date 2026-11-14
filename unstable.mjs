// homequarters/unstable: the parts of HQ a plugin or a project's own scripts may use that HQ does not promise to keep.
// Any of these may change or go in any minor release, so a project that imports one pins homequarters exactly and takes
// each release in a pull request of its own. They run programs, open terminals, call GitHub through HQ's cache or write
// HQ's stash, which is why they are not in the ui object. Each is HQ's own function, the one its pages use.
export { ghPart, branchPr } from './lib/github.mjs';
export { mainCheckout, readTurns } from './lib/conversations.mjs';
export { itemsHtml } from './pages/conversations.mjs';
export { gitInfo } from './lib/outside.mjs';
export { openInClaude, findClaude, pickTerminal, focusTabCommand } from './lib/claude.mjs';
export { projectId } from './lib/firebase.mjs';
export { makeStash, readEntry, fileFor } from './lib/stash.mjs';
export { branchWork } from './lib/backlog.mjs';
