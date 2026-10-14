// The Export page in the browser: as boxes are ticked, the total size and tokens change, with a warning past what a
// claude.ai conversation holds comfortably (about 150k tokens) and past the most any model takes (about 800k); the
// Download link carries the choice; Copy fetches the file and puts it on the clipboard while it is under 2 MB; and the
// preview shows the chosen file's first lines. As a zip, the same choice becomes a folder of files: nothing has to fit
// in one conversation, so the warnings step back and Copy is off.
(function () {
  const form = document.querySelector('.ex-form');
  if (!form) return;
  const data = JSON.parse(document.getElementById('ex-data').textContent);
  const total = form.querySelector('[data-total]'), warn = form.querySelector('[data-warn]'), dl = form.querySelector('[data-download]');
  const copy = form.querySelector('[data-copy]'), said = form.querySelector('[data-said]'), preview = document.querySelector('[data-preview]');
  const prompts = form.querySelector('input[name="prompts"]');
  const COMFORT = 150000, MOST = 800000, CLIP = 2 * 1048576;
  const kb = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const tok = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  let bytes = 0, format = 'md';
  const note = form.querySelector('[data-format-note]');
  const NOTES = { md: 'Everything in one file, in order. Best when it fits in a conversation.', zip: 'A folder: a README saying what is where, the summaries, and the tracked files at their paths under repo/. Claude opens only what it needs.' };
  form.querySelector('.ex-format').addEventListener('click', e => {
    const b = e.target.closest('[data-format]');
    if (!b) return;
    format = b.dataset.format;
    for (const x of form.querySelectorAll('[data-format]')) x.setAttribute('aria-pressed', String(x === b));
    note.textContent = NOTES[format];
    update();
  });

  const chosen = () => [...form.querySelectorAll('input[name="section"]:checked')].map(i => i.value);
  const query = extra => {
    const ids = chosen(), q = new URLSearchParams({ sections: ids.join(',') });
    if (prompts.checked && ids.includes('conversations')) q.set('prompts', '1');
    if (format === 'zip') q.set('format', 'zip');
    for (const [k, v] of Object.entries(extra || {})) q.set(k, v);
    return q.toString();
  };

  let previewFor = '';
  function update() {
    const ids = chosen();
    prompts.disabled = !ids.includes('conversations');
    bytes = data.header; let tokens = Math.ceil(data.header / 4);
    for (const s of data.sections) if (ids.includes(s.id)) { bytes += s.bytes; tokens += s.tokens; }
    if (!prompts.disabled && prompts.checked) { bytes += data.prompts.bytes; tokens += data.prompts.tokens; }
    total.textContent = !ids.length ? 'Nothing chosen' : format === 'zip' ? `About ${tok(tokens)} tokens in all, ${kb(bytes)} before zipping, split into files` : `About ${tok(tokens)} tokens, ${kb(bytes)}`;
    warn.hidden = format === 'zip' || tokens <= COMFORT;
    warn.textContent = tokens > MOST ? 'More than any model can read at once. Leave some sections out.' : 'More than a claude.ai conversation holds comfortably. Fine for a file, or for a model with a long context.';
    warn.dataset.level = tokens > MOST ? 'high' : 'mid';
    dl.href = `/export/download?${query()}`;
    copy.disabled = !ids.length || bytes > CLIP || format === 'zip';
    copy.title = format === 'zip' ? 'A zip cannot go on the clipboard; download it.' : bytes > CLIP ? 'Too big for the clipboard; download it instead.' : '';
    const q = query({ preview: '1' });
    if (q !== previewFor) {
      previewFor = q;
      fetch(`/export/download?${q}`).then(r => (r.ok ? r.text() : '')).then(t => { if (previewFor === q && t) preview.textContent = t; }, () => {});
    }
  }
  form.addEventListener('change', update);
  copy.addEventListener('click', async () => {
    copy.disabled = true; said.textContent = 'Building…';
    try {
      const text = await (await fetch(`/export/download?${query()}`)).text();
      await navigator.clipboard.writeText(text);
      said.textContent = `Copied, ${kb(new Blob([text]).size)}.`;
    } catch (e) { said.textContent = `Could not copy: ${e.message}. Download it instead.`; }
    copy.disabled = false;
  });
  update();
})();
