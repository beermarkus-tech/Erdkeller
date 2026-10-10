// i18n regression harness: renders the app (signed in, fixture data, fixed
// clock) from two directories, walks the same click tour through both, and
// compares the DOM after every step plus every confirm()/alert() text.
//
//   node tools/i18n-test/run.cjs <oldDir> <newDir> [--lang de|en] [--only name]
//   node tools/i18n-test/run.cjs --dump <dir> [--lang en]   (print visible text per step)
//   SHOTS=<outdir> before any mode also saves a screenshot per step
//   node tools/i18n-test/run.cjs --live <dir>
//       German tour; after every step where the language button is reachable,
//       switch to (fake) English in place, list text that stayed German,
//       switch back, and require the DOM to equal the pre-switch DOM.
//   node tools/i18n-test/run.cjs --leftovers <dir>
//       English with a fake en.js ("§" + German for every key): lists every
//       visible text, attribute and dialog that did NOT go through t(), i.e.
//       German UI text still hardcoded somewhere (fixture data excluded).
//
// Needs Playwright (preinstalled in the cloud container; set PW to its path
// if require('playwright') can't find it). Firebase is replaced by
// firebase-mock.js; nothing touches the network.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || 'playwright');
const FIXTURES = require('./fixtures.cjs');
const TOUR = require('./tour.cjs');

const MOCK = fs.readFileSync(path.join(__dirname, 'firebase-mock.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      fs.readFile(p, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
        res.end(buf);
      });
    }).listen(0, () => resolve(srv));
  });
}

function normalize(html) {
  return html
    .replace(/ data-i18n(-attr|-html)?="[^"]*"/g, '')
    .replace(/\?v=\d+/g, '')
    .replace(/Build \d+/g, 'Build N');
}

async function runTour(dir, lang, only, fake, afterStep) {
  const srv = await serve(dir);
  const base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch();
  const out = [];
  // VIEWPORT=phone renders the phone layout (bottom nav, topbar) instead of the tablet one.
  for (const viewport of [process.env.VIEWPORT === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 900 }]) {
    const ctx = await browser.newContext({ viewport, locale: lang === 'en' ? 'en-US' : 'de-DE', serviceWorkers: 'block' });
    await ctx.route(/gstatic\.com\/firebasejs\//, (r) => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: 'text/css', body: '' }));
    await ctx.route(/cdnjs\.cloudflare\.com/, (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
    if (fake) {
      const de = new Function(fs.readFileSync(path.join(dir, 'js/locales/de.js'), 'utf8').replace('export default', 'return'))();
      const markStr = (x) => (/</.test(x) ? x.replace(/(^|>)([^<]+)/g, '$1§$2') : '§' + x); // markup values: mark every text run
      const mark = (v) => (typeof v === 'string' ? markStr(v) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, markStr(x)])));
      const fakeEn = Object.fromEntries(Object.entries(de).map(([k, v]) => [k, mark(v)]));
      await ctx.route(/locales\/en\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: 'export default ' + JSON.stringify(fakeEn) }));
    }
    await ctx.addInitScript(({ fixtures, lang }) => {
      window.__FIXTURES__ = fixtures;
      // Deterministic ids/randomness so two runs produce identical DOM.
      let n = 0;
      crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
      let seed = 42;
      Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      // Speech recognition: start() yields one final result; stop() ends the
      // session (the app then submits the transcript to parseDictation).
      class FakeRecognition {
        start() { setTimeout(() => this.onresult && this.onresult({ results: [Object.assign([{ transcript: 'zwei Dosen Thunfisch und eine Packung Bulgur, eine Tafel Schokolade raus' }], { isFinal: true })] }), 20); }
        stop() { setTimeout(() => this.onend && this.onend(), 20); }
        abort() { this.stop(); }
      }
      window.SpeechRecognition = window.webkitSpeechRecognition = FakeRecognition;
      window.__CALLABLES__ = {
        // 1st call: a proposal with gaps (missing category/storage, a line
        // not in stock) to exercise the warnings; later calls: a complete
        // one that can be registered.
        parseDictation: () => ((window.__dictations = (window.__dictations || 0) + 1) === 1 ? { items: [
          { direction: 'in', matchedProductId: 'p-tuna', quantity: 2, content: '185g', bestBefore: '12/2028', storage: 'Keller Regal 2', confidence: 'high' },
          { direction: 'in', newProductName: 'Bulgur', guessedUnitType: 'kg', quantity: 1, content: '500g', bestBefore: '', storage: '', confidence: 'medium' },
          { direction: 'out', matchedBatchId: 'b7', quantity: 1, confidence: 'low' },
          { direction: 'out', matchedBatchId: 'nope', attemptedName: 'Kaviar', quantity: 1 },
        ] } : { items: [
          { direction: 'in', matchedProductId: 'p-tuna', quantity: 2, content: '185g', bestBefore: '12/2028', storage: 'Keller Regal 2', confidence: 'high' },
          { direction: 'in', newProductName: 'Bulgur', suggestedSubcategoryId: 's-pasta', guessedUnitType: 'kg', quantity: 1, content: '500g', bestBefore: '06/2027', storage: 'Küche', confidence: 'high' },
          { direction: 'out', matchedBatchId: 'b7', quantity: 1, confidence: 'high' },
        ] }),
        previewReminders: () => ({ enabled: true, currentParisHour: 12, configuredHour: 9, frequencies: {} }),
        sendTestNotification: () => ({ total: 1, succeeded: 1, failures: [] }),
      };
      localStorage.setItem('erdkeller-last-user', JSON.stringify({ uid: 'u-admin', name: 'Test Admin', photoURL: '', role: 'admin' }));
      localStorage.setItem('erdkeller-lang', lang);
    }, { fixtures: FIXTURES, lang });
    const page = await ctx.newPage();
    await page.clock.install({ time: new Date('2026-10-10T12:00:00') });
    const dialogs = [];
    const errors = [];
    page.on('dialog', async (d) => { dialogs.push(`${d.type()}: ${d.message()}`); await d.dismiss(); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' || /i18n/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.goto(base + '/index.html');
    await page.clock.runFor(3000);
    await page.waitForTimeout(300);
    for (const step of TOUR) {
      if (only && step.name !== only) continue;
      dialogs.length = 0;
      let note = '';
      try {
        await step.run(page);
      } catch (err) {
        note = 'STEP FAILED: ' + err.message.split('\n')[0];
      }
      await page.clock.runFor(1500);
      await page.waitForTimeout(150);
      if (process.env.SHOTS) {
        fs.mkdirSync(process.env.SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SHOTS, `${String(TOUR.indexOf(step)).padStart(2, '0')}-${step.name.replace(/[^a-z0-9]+/gi, '_')}.png`) });
      }
      const html = normalize(await page.evaluate(() => document.body.innerHTML));
      const text = await page.evaluate(() => document.body.innerText);
      const strings = fake ? await visibleStrings(page) : [];
      const extra = afterStep ? await afterStep(page, step, html) : null;
      out.push({ name: step.name, html, text, strings, dialogs: [...dialogs], note, errors: errors.splice(0), extra });
    }
    await ctx.close();
  }
  await browser.close();
  srv.close();
  return out;
}

// A string is a leftover if it contains a word that is neither fixture data
// (product/category names etc. — user content, never translated) nor a unit.
// Plus the default names of items the tour itself creates (they become data).
const dataWords = new Set(['kg', 'kcal', 'L', 'l', 'g', 'ml', 'EN', 'DE', 'Build', 'Erdkeller', 'Test', 'Admin', 'Bulgur', 'Kaviar', 'Neue', 'Checkliste', 'Neuer', 'Eintrag', 'Krisentyp']);
const words = (v) => v.match(/[A-Za-zÄÖÜäöüß]{2,}/g) || [];
(function collect(v) { if (typeof v === 'string') [v, v.replace(/<[^>]+>/g, '')].forEach((x) => words(x).forEach((w) => dataWords.add(w))); else if (v && typeof v === 'object') Object.values(v).forEach(collect); })(FIXTURES);
'zwei Dosen Thunfisch und eine Packung Bulgur, eine Tafel Schokolade raus'.split(' ').forEach((w) => dataWords.add(w.replace(/,/, '')));
// German unit abbreviations with single letters (g/P/T = per person per day) count too.
const isLeft = (s) => !s.includes('§') && (words(s.replace(/^\[[a-z-]+\] /, '')).some((w) => !dataWords.has(w)) || /\bP\/T\b/.test(s));

async function visibleStrings(page) {
  return page.evaluate(() => {
    const out = [];
    const visible = (el) => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const v = w.currentNode.nodeValue.trim();
      const el = w.currentNode.parentElement;
      if (v && visible(el)) out.push(v);
    }
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach((el) => {
      if (!visible(el)) return;
      ['placeholder', 'title', 'aria-label'].forEach((a) => el.getAttribute(a) && out.push(`[${a}] ${el.getAttribute(a)}`));
    });
    document.querySelectorAll('select option').forEach((o) => visible(o.parentElement) && out.push(o.textContent.trim()));
    return out;
  });
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `\n    old: ${JSON.stringify(a.slice(Math.max(0, i - 100), i + 150))}\n    new: ${JSON.stringify(b.slice(Math.max(0, i - 100), i + 150))}`;
}

(async () => {
  const args = process.argv.slice(2);
  const lang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'de';
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  if (args[0] === '--leftovers') {
    const r = await runTour(path.resolve(args[1]), 'en', only, true);
    const seen = new Map();
    r.forEach((s) => {
      [...s.strings, ...s.dialogs.map((d) => '[dialog] ' + d)].filter(isLeft).forEach((v) => { if (!seen.has(v)) seen.set(v, s.name); });
      if (s.errors.length) console.log(`ERRORS in ${s.name}: ${s.errors.join(' | ')}`);
    });
    for (const [v, step] of seen) console.log(`${step.padEnd(40)} ${JSON.stringify(v)}`);
    console.log(`\n${seen.size} untranslated string(s)`);
    return;
  }
  if (args[0] === '--live') {
    const switchLang = async (page) => {
      const btn = page.locator('.sidebar .lang-btn');
      try { await btn.click({ timeout: 500, trial: true }); } catch { return false; }
      await btn.click();
      await page.clock.runFor(2000);
      await page.waitForTimeout(150);
      return true;
    };
    const r = await runTour(path.resolve(args[1]), 'de', only, true, async (page, step, htmlBefore) => {
      if (!(await switchLang(page))) return { skipped: true };
      const left = (await visibleStrings(page)).filter(isLeft);
      await switchLang(page);
      const htmlAfter = normalize(await page.evaluate(() => document.body.innerHTML));
      return { left, same: htmlAfter === htmlBefore, diff: htmlAfter === htmlBefore ? '' : firstDiff(htmlBefore, htmlAfter) };
    });
    let bad = 0;
    r.forEach((s) => {
      const x = s.extra || {};
      if (x.skipped) return console.log(`skip ${s.name} (language button covered)`);
      const problems = [];
      if (x.left.length) problems.push('stayed German: ' + JSON.stringify([...new Set(x.left)]));
      if (!x.same) problems.push('DE→EN→DE changed the DOM:' + x.diff);
      if (s.errors.length) problems.push('errors: ' + s.errors.join(' | '));
      if (problems.length) bad++;
      console.log(`${problems.length ? 'FAIL' : ' ok '} ${s.name}${problems.length ? '\n  ' + problems.join('\n  ') : ''}`);
    });
    console.log(`\n${r.length - bad}/${r.length} steps pass`);
    process.exitCode = bad ? 1 : 0;
    return;
  }
  if (args[0] === '--dump') {
    const r = await runTour(path.resolve(args[1]), lang, only);
    r.forEach((s) => console.log(`\n===== ${s.name} ${s.note}\n${s.text}\n${s.dialogs.join('\n')}\n${s.errors.join('\n')}`));
    return;
  }
  const [oldR, newR] = await Promise.all([runTour(path.resolve(args[0]), lang, only), runTour(path.resolve(args[1]), lang, only)]);
  let bad = 0;
  oldR.forEach((o, i) => {
    const n = newR[i];
    const problems = [];
    if (o.note !== n.note) problems.push(`step outcome: old "${o.note}" new "${n.note}"`);
    if (o.html !== n.html) problems.push('DOM differs:' + firstDiff(o.html, n.html));
    if (JSON.stringify(o.dialogs) !== JSON.stringify(n.dialogs)) problems.push(`dialogs: old ${JSON.stringify(o.dialogs)} new ${JSON.stringify(n.dialogs)}`);
    if (n.errors.length) problems.push('new errors: ' + n.errors.join(' | '));
    if (problems.length) bad++;
    console.log(`${problems.length ? 'DIFF' : ' ok '} ${o.name}${o.note ? '  (' + o.note + ')' : ''}${problems.length ? '\n  ' + problems.join('\n  ') : ''}`);
  });
  console.log(`\n${oldR.length - bad}/${oldR.length} steps identical`);
  process.exitCode = bad ? 1 : 0;
})();
