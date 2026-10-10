// Static consistency check for the i18n dictionaries:
// - every t('key') in js/*.js and every data-i18n* key in index.html exists in de.js
// - every de.js key is used somewhere (no dead entries)
// - en.js has no keys that de.js lacks, keeps the same {placeholders}, and
//   has no markup characters outside *_html keys
//   node tools/i18n-test/check-keys.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => new Function(fs.readFileSync(path.join(root, f), 'utf8').replace('export default', 'return'))();
const de = load('js/locales/de.js');
const en = load('js/locales/en.js');

const used = new Map(); // key -> where
const jsFiles = fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js'));
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(root, 'js', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // comments may mention t('key')
  for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) used.set(m[1], `js/${f}`);
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) used.set(m[1], 'index.html');
for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
  m[1].split(';').forEach((pair) => used.set(pair.split(':')[1], 'index.html'));
}

let problems = 0;
const report = (msg) => { problems++; console.log(msg); };
for (const [k, where] of used) if (!(k in de)) report(`MISSING in de.js: ${k} (${where})`);
for (const k of Object.keys(de)) if (!used.has(k)) report(`UNUSED in de.js: ${k}`);
// Distinct placeholder names; a plural entry ({ one, other }) must use the
// same set in every form.
const phSet = (str) => JSON.stringify([...new Set(str.match(/\{\w+\}/g) || [])].sort());
const ph = (v) => (typeof v === 'string' ? phSet(v) : [...new Set(Object.values(v).map(phSet))].join(' | '));
for (const [k, v] of Object.entries(en)) {
  if (!(k in de)) report(`en.js key not in de.js: ${k}`);
  else if (ph(v) !== ph(de[k])) report(`placeholder mismatch ${k}: de ${ph(de[k])} en ${ph(v)}`);
  // Many values are interpolated into innerHTML templates; only *_html keys
  // (and data-i18n-html keys, whose German already contains markup) may
  // carry markup or entities.
  const markupOk = k.endsWith('_html') || /[<&]/.test(typeof de[k] === 'string' ? de[k] : '');
  const flat = typeof v === 'string' ? v : Object.values(v).join(' ');
  if (!markupOk && /[<>&]/.test(flat)) report(`en ${k}: contains < > or & — use plain text or an *_html key`);
}
// js/backup.js checks the typed confirmation against this key, and the hint
// above the input shows it in <strong>: both must match in every language.
for (const [name, dict] of [['de', de], ['en', en]]) {
  const phrase = dict['settings.export.alles_ersetzen'];
  const hint = dict['settings.export.zum_bestaetigen_exakt_strong_alles'];
  if (phrase && hint && !hint.includes(`<strong>${phrase}</strong>`)) report(`${name}: confirmation hint doesn't contain <strong>${phrase}</strong>`);
}
const enCount = Object.keys(en).length;
console.log(`${Object.keys(de).length} de keys, ${used.size} used, ${enCount} translated to en; ${problems} problem(s)`);
process.exitCode = problems ? 1 : 0;
