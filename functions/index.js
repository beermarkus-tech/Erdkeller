// Diktieren's backend: one Callable Function, parseDictation, called once
// per dictation turn from js/dictate.js. It reads the household's own
// taxonomy + product catalog straight from Firestore (trusted server
// context via firebase-admin — bypasses firestore.rules entirely, same as
// every other Cloud Function) and asks an LLM to turn the raw transcript
// into a structured list of stock batches, matching each against an
// existing product where possible and suggesting a subcategory for
// anything genuinely new. See /root/.claude/plans (session-local) for the
// full design writeup — the short version: one call does extraction +
// matching + subcategorization together, since an LLM handles "5x800g,
// 5x400g of the same product" far more reliably than hand-rolled regex,
// and it already needs the taxonomy/catalog context for the
// subcategory-guessing half anyway.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

// Set via: firebase functions:secrets:set ANTHROPIC_API_KEY
// Never committed, never sent to the client — only readable inside this
// function's own execution environment.
const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

const MODEL = 'claude-haiku-4-5-20251001';

// The "Erdkeller" API key is a personal, identity-linked key valid across
// all of Markus's workspaces, so every request must state which workspace
// it acts in (Anthropic rejects it otherwise with a 400). Using a
// dedicated "Erdkeller" workspace (rather than Default/Claude Code) keeps
// this feature's own AI usage/cost trackable in isolation. Not a secret —
// workspace ids aren't credentials — so it's a plain constant.
const WORKSPACE_ID = 'wrkspc_01Jo4yTb1qQ9rm7HKucFZ6ys';

function buildTaxonomyLines(taxonomy) {
  const lines = [];
  (taxonomy.types || []).forEach((type) => {
    (type.categories || []).forEach((cat) => {
      (cat.subcategories || []).forEach((sub) => {
        lines.push(`${sub.id}\t${type.name} > ${cat.name} > ${sub.name}`);
      });
    });
  });
  return lines;
}

function buildProductLines(products) {
  return products.map((p) => `${p.id}\t${p.name}\t${p.unitType}`);
}

function buildBatchLines(batches, productIndex) {
  return batches.map((b) => {
    const name = (productIndex.get(b.productId) || {}).name || '(unbekannt)';
    return `${b.id}\t${name}\t${b.quantity}\t${b.content || ''}\t${b.bestBefore || ''}\t${b.storage || ''}`;
  });
}

// Hardcoded for now — there's no app-wide language setting anywhere in this
// codebase yet (recognizer.lang, every .localeCompare(..., 'de') call, and
// all UI text are all hardcoded German the same way). If a language setting
// is ever added, this should read from it instead.
const APP_LANGUAGE = 'Deutsch';

function buildPhotoPrompt(taxonomy, products) {
  const taxonomyLines = buildTaxonomyLines(taxonomy);
  const productLines = buildProductLines(products);
  return `Du hilfst beim Einlagern von Vorräten in einer Haushalts-Vorratsverwaltung anhand eines Fotos. Das Foto zeigt ein Regal, einen Schrank oder eine Ablage mit Lebensmitteln/Vorräten.

Erkenne JEDES einzeln unterscheidbare Produkt auf dem Foto und zerlege es in eine JSON-Liste von Chargen. Mehrere gleiche Packungen desselben Produkts mit derselben Packungsgröße zählst du als EINE Zeile mit entsprechender "quantity", nicht als mehrere Zeilen. Unterschiedliche Packungsgrößen desselben Produkts ergeben getrennte Zeilen.

Bekannte Produkte (id, Name, Einheit):
${productLines.join('\n') || '(keine)'}

Bekannte Unterkategorien (subcategoryId, Pfad Typ > Kategorie > Unterkategorie):
${taxonomyLines.join('\n') || '(keine)'}

Gib für jedes erkannte Produkt GENAU eines von zwei Feldsets zurück:

1) Passt zu einem bekannten Produkt:
{"direction": "in", "matchedProductId": "<id EXAKT aus der Produktliste oben kopiert>", "productNameHeard": "<einfacher Produktname, siehe unten>", "quantity": <Zahl>, "content": "<z.B. 800g, oder null>", "bestBefore": "<MM/JJJJ oder null>", "storage": null, "confidence": "high"|"medium"|"low"}

2) Kein bekanntes Produkt passt:
{"direction": "in", "newProductName": "<einfacher Produktname, siehe unten>", "suggestedSubcategoryId": "<id aus der Liste oben, oder null>", "confidence": "high"|"medium"|"low", "quantity": <Zahl>, "content": "<... oder null>", "bestBefore": "<MM/JJJJ oder null>", "storage": null, "guessedUnitType": "kg"|"l"|"stueck"}

WICHTIG zu "matchedProductId"/"suggestedSubcategoryId": IMMER exakt aus der jeweiligen Liste oben kopieren, NIE selbst erfinden. Diese IDs sind zufällige Firestore-Strings (~20 Zeichen, KEINE Bindestriche) — niemals ein UUID-artiges Format mit Bindestrichen erzeugen. Bei Unsicherheit lieber Format 2 verwenden als eine falsche ID zu raten.

WICHTIG zu "productNameHeard"/"newProductName" — einfacher Produktname: Nenne das Produkt bei seinem einfachen, generischen Gattungsnamen auf ${APP_LANGUAGE} — NICHT die Marke, NICHT der volle Aufdruck der Verpackung. Beispiele: "Barilla Superlong Spaghetti" → "Spaghetti"; "Flocons d'Avoine" → "Haferflocken"; "Bonduelle Kidneybohnen in Dose" → "Kidneybohnen"; "San Marzano gepellte Tomaten" → "Gepellte Tomaten". Übersetze fremdsprachige Aufdrucke (Englisch, Französisch, etc.) ins ${APP_LANGUAGE}. Marke, Herkunftsangaben und Werbetext auf der Verpackung ignorierst du für den Namen komplett — nur die Sorte/Art des Produkts zählt.

Regeln:
- "storage" IMMER null setzen — der Lagerort lässt sich aus einem Foto nicht zuverlässig bestimmen.
- "quantity" ist die Anzahl sichtbarer Packungen, nie das Gewicht. Bei gestapelten/teilweise verdeckten Packungen vorsichtig schätzen, "confidence" entsprechend senken.
- "content" ist die Packungsgröße als kurzer String, falls lesbar; sonst null.
- "bestBefore" nur setzen, wenn Monat UND Jahr klar lesbar sind; nie raten.
- "confidence" spiegelt Sicherheit bei Produkt-Identität UND Menge wider.
- Ist kein Lebensmittel/Vorrat erkennbar, gib ein leeres JSON-Array zurück.
- Antworte NUR mit einem JSON-Array, keine Erklärung, kein Markdown.`;
}

function buildPrompt(transcript, taxonomy, products, batches, productIndex) {
  const taxonomyLines = buildTaxonomyLines(taxonomy);
  const productLines = buildProductLines(products);
  const batchLines = buildBatchLines(batches, productIndex);
  return `Du hilfst beim Einlagern UND Entnehmen von Vorräten in einer Haushalts-Vorratsverwaltung. Ein Nutzer hat eine oder mehrere Chargen diktiert; hier die Transkription (Deutsch, kann Erkennungsfehler enthalten):

"${transcript}"

Zerlege die Aussage in eine JSON-Liste von Chargen (batch lines). Eine Aussage kann mehrere Chargen enthalten — z.B. "10 Tomatensugo, 5x800g, 5x400g" ergibt ZWEI Zeilen desselben Produkts mit unterschiedlichem Inhalt. Zwei verschiedene genannte Produkte ergeben ebenfalls getrennte Zeilen. Eine Aussage kann auch Einlagern UND Entnehmen gleichzeitig enthalten.

Jede Zeile braucht zuerst ein Feld "direction": "in" (eingelagert/gekauft/neu dazu) oder "out" (entnommen/verbraucht/aufgebraucht/rausgenommen/weggenommen/weniger geworden) — aus der Wortwahl erkennbar. Das ist die wichtigste Entscheidung pro Zeile — lies sie sorgfältig aus dem jeweiligen Satzteil, nicht aus dem Rest der Aussage. Beispiel: "10 Gläser Sugo eingelagert, dafür 2 Dosen Bohnen entnommen" → ZWEI Zeilen, eine mit "direction":"in" (Sugo), eine mit "direction":"out" (Bohnen) — niemals beide als "in", nur weil ein Teil des Satzes ein Einlagern beschreibt.

Bekannte Produkte (id, Name, Einheit):
${productLines.join('\n') || '(keine)'}

Bekannte Unterkategorien (subcategoryId, Pfad Typ > Kategorie > Unterkategorie):
${taxonomyLines.join('\n') || '(keine)'}

Aktueller Lagerbestand — Chargen (batchId, Produktname, Menge, Inhalt, MHD, Lagerort) — nur relevant für "direction":"out":
${batchLines.join('\n') || '(keine)'}

Für "direction":"in" gib GENAU eines von zwei weiteren Feldsets zurück:

1) Passt zu einem bekannten Produkt (auch bei leicht abweichender Schreibweise/Aussprache/Umlauten):
{"direction": "in", "matchedProductId": "<id EXAKT aus der Produktliste oben kopiert>", "productNameHeard": "<Produktname wie gehört/gematcht>", "quantity": <Zahl>, "content": "<z.B. 800g, oder null>", "bestBefore": "<MM/JJJJ oder null>", "storage": "<Text oder null>"}

2) Kein bekanntes Produkt passt (neues Produkt):
{"direction": "in", "newProductName": "<Name>", "suggestedSubcategoryId": "<id aus der Liste oben, oder null wenn unklar>", "confidence": "high"|"medium"|"low", "quantity": <Zahl>, "content": "<... oder null>", "bestBefore": "<MM/JJJJ oder null>", "storage": "<... oder null>", "guessedUnitType": "kg"|"l"|"stueck"}

WICHTIG zu "matchedProductId"/"matchedBatchId"/"suggestedSubcategoryId": IMMER exakt (Zeichen für Zeichen) aus der jeweiligen Liste oben kopieren, NIE selbst erfinden oder aus dem Produktnamen ableiten. Diese IDs sind zufällige Firestore-Strings (z.B. "aB3xY9kLm2pQrS7tU4vW", ~20 Zeichen, KEINE Bindestriche) — niemals ein UUID-artiges Format mit Bindestrichen (z.B. "0209ef0d-ef14-...") erzeugen, das ist immer erfunden. Bei Unsicherheit, ob eine ID exakt stimmt, lieber Format 2 (neues Produkt) verwenden als eine falsche ID zu raten.

Für "direction":"out" gib zurück:
{"direction": "out", "matchedBatchId": "<batchId aus der Bestandsliste oben, oder null>", "attemptedName": "<Produktname wie gehört, NUR wenn matchedBatchId null ist, sonst null>", "quantity": <Zahl>, "confidence": "high"|"medium"|"low"}
- Suche in der Bestandsliste auch bei leicht abweichender Schreibweise/Aussprache/Umlauten oder Teilübereinstimmung (z.B. "Tomatensauce" passt zu "Tomatensugo") — genau wie beim Produktabgleich für "direction":"in". Ein Produkt gilt erst dann als nicht vorhanden, wenn wirklich nichts Ähnliches in der Bestandsliste steht.
- Wenn ein Produkt mehrere Chargen hat (z.B. verschiedene Packungsgrößen/MHDs) und die Aussage nicht eindeutig klärt welche, wähle die plausibelste (z.B. passendster Inhalt/nächstes MHD) und setze "confidence" auf "medium" oder "low" statt "matchedBatchId" leer zu lassen.
- "matchedBatchId" nur dann null setzen, wenn wirklich nichts Passendes oder Ähnliches in der Bestandsliste vorkommt — dann "attemptedName" mit dem gehörten Produktnamen füllen, damit der Nutzer sieht wonach gesucht wurde.

Regeln:
- "quantity" ist immer eine ganze Zahl (Anzahl der Chargen/Gebinde bzw. bei "out" die entnommene Anzahl), nie das Gewicht.
- "content" ist die Packungsgröße als kurzer String wie im Beispiel (z.B. "800g", "1l"), nicht die Gesamtmenge.
- "bestBefore" nur setzen, wenn ein Monat UND Jahr klar genannt wurden; sonst null.
- "storage" nur setzen, wenn ein Lagerort klar genannt wurde; sonst null.
- Antworte NUR mit einem JSON-Array, keine Erklärung, kein Markdown, kein Codeblock.`;
}

function extractJsonArray(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return trimmed;
  return trimmed.slice(start, end + 1);
}

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

exports.parseDictation = onCall({ secrets: [anthropicApiKey], timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Bitte anmelden.');
  }
  const data = request.data || {};
  const transcript = typeof data.transcript === 'string' ? data.transcript.trim() : '';
  const imageBase64 = typeof data.imageBase64 === 'string' ? data.imageBase64.trim() : '';
  const hasTranscript = !!transcript;
  const hasImage = !!imageBase64;
  if (hasTranscript === hasImage) { // both or neither provided
    throw new HttpsError('invalid-argument', 'Entweder Text oder Foto übergeben, nicht beides oder keins.');
  }
  if (hasImage) {
    if (!ALLOWED_IMAGE_MIME.has(data.mimeType)) {
      throw new HttpsError('invalid-argument', 'Ungültiges Bildformat.');
    }
    // Defense in depth — base64 chars ≈ bytes * 4/3, so this is ~6MB of raw
    // image, comfortably under Anthropic's per-image cap already enforced
    // more tightly client-side; this is just a server-side backstop.
    if (imageBase64.length > 8_000_000) {
      throw new HttpsError('invalid-argument', 'Foto zu groß.');
    }
  }

  const [taxSnap, productsSnap] = await Promise.all([
    db.doc('config/taxonomy').get(),
    db.collection('products').get(),
  ]);
  const taxonomy = taxSnap.exists && Array.isArray(taxSnap.data().types) ? taxSnap.data() : { types: [] };
  const products = productsSnap.docs.map((d) => {
    const p = d.data();
    return { id: d.id, name: p.name || '', unitType: p.unitType || '' };
  });
  const productIndex = new Map(products.map((p) => [p.id, p]));

  let content;
  if (hasTranscript) {
    // Only text-dictation lines can be "out" (a photo just shows what's
    // physically present), so the current-stock batch context is only
    // ever needed here.
    const batchesSnap = await db.collection('stockItems').get();
    const batches = batchesSnap.docs.map((d) => {
      const b = d.data();
      return {
        id: d.id,
        productId: b.productId || '',
        quantity: b.quantity || 0,
        content: b.content || '',
        bestBefore: b.bestBefore || '',
        storage: b.storage || '',
      };
    });
    content = buildPrompt(transcript, taxonomy, products, batches, productIndex);
  } else {
    const prompt = buildPhotoPrompt(taxonomy, products);
    content = [
      { type: 'image', source: { type: 'base64', media_type: data.mimeType, data: imageBase64 } },
      { type: 'text', text: prompt },
    ];
  }

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicApiKey.value(),
        'anthropic-version': '2023-06-01',
        'anthropic-workspace-id': WORKSPACE_ID,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (err) {
    console.error('Anthropic request failed', err);
    throw new HttpsError('unavailable', 'KI-Anfrage fehlgeschlagen.');
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error('Anthropic API error', response.status, errText);
    throw new HttpsError('internal', 'KI-Anfrage fehlgeschlagen.');
  }

  const responseJson = await response.json();
  const textBlock = (responseJson.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw new HttpsError('internal', 'Keine Antwort erhalten.');
  }

  let items;
  try {
    items = JSON.parse(extractJsonArray(textBlock.text));
  } catch (err) {
    console.error('Failed to parse model output as JSON', err, textBlock.text);
    throw new HttpsError('internal', 'Antwort konnte nicht gelesen werden.');
  }

  // A silent "not understood" on the client (zero resolvable lines) is
  // otherwise a dead end to debug — the raw model text is the one thing
  // that actually explains it (wrong shape, unexpected wrapping object,
  // a genuinely empty array), so log it whenever the parsed result isn't
  // a non-empty array rather than only on a hard parse failure.
  if (!Array.isArray(items) || items.length === 0) {
    console.warn('parseDictation: parsed to no usable items', { transcript, raw: textBlock.text });
  }

  return { items: Array.isArray(items) ? items : [] };
});

// ---------------------------------------------------------------------------
// Checklisten-Erinnerungen (push notifications, SPEC.md Step 17)
//
// A ported, timezone-correct copy of js/checklists.js's "done for the
// current period" boundary math (nthWeekdayOfMonth / mostRecentXOccurrence /
// isDoneThisPeriod) — same duplicate-rather-than-share convention as
// buildTaxonomyLines/buildProductLines above, forced here since the client
// has no build step to share code with a Node Cloud Function anyway. The
// client's version runs in the browser's local time (the household's
// devices are always Europe/Paris); this version runs in whatever timezone
// the Cloud Function executes in (UTC), so every "now" and every computed
// occurrence boundary is deliberately routed through Europe/Paris wall-clock
// conversion rather than using the process's own local time anywhere.
// ---------------------------------------------------------------------------

const CHECKLIST_TZ = 'Europe/Paris';
const RECIPIENT_SLUGS = ['markus', 'julia', 'sophia'];
const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'halfYearly', 'yearly'];
const FREQ_LABELS = {
  weekly: 'Wöchentlich', monthly: 'Monatlich', quarterly: 'Vierteljährlich', halfYearly: 'Halbjährlich', yearly: 'Jährlich',
};
// Adjectival form for "<X> Wartung" in the notification title — FREQ_LABELS
// above is the adverb form used everywhere else (chip labels etc.), which
// reads wrong stuck in front of a noun ("Monatlich Wartung" vs. the correct
// "Monatliche Wartung").
const FREQ_LABELS_ADJ = {
  weekly: 'Wöchentliche', monthly: 'Monatliche', quarterly: 'Vierteljährliche', halfYearly: 'Halbjährliche', yearly: 'Jährliche',
};

// Mirrors js/notifications.js's defaultChecklists()/js/checklists.js's
// defaultNotificationsChecklists() — a third copy, per this codebase's
// established (if unlovely) small-helper-duplication convention. All three
// must be kept in sync by hand if the shape ever changes.
function defaultNotificationsChecklists() {
  return {
    weekly: { weekday: 1 },
    monthly: { weekOfMonth: 1, weekday: 1 },
    quarterly: { anchorMonth: 1, weekOfMonth: 1, weekday: 1 },
    halfYearly: { anchorMonth: 1, weekOfMonth: 1, weekday: 1 },
    yearly: { month: 1, weekOfMonth: 1, weekday: 1 },
    hour: 9,
    repeatDays: 3,
  };
}

// The client only ever falls back at the top level (`if (!notifications.
// checklists) …`) — a doc that has `checklists` but is missing one
// frequency (e.g. an older doc saved before `repeatDays` existed) throws
// there. This deep-merges per key so a partial doc never crashes the
// scheduler, which runs unattended and can't surface an error to anyone.
function mergeNotificationsChecklists(stored) {
  const d = defaultNotificationsChecklists();
  const s = stored || {};
  return {
    weekly: { ...d.weekly, ...(s.weekly || {}) },
    monthly: { ...d.monthly, ...(s.monthly || {}) },
    quarterly: { ...d.quarterly, ...(s.quarterly || {}) },
    halfYearly: { ...d.halfYearly, ...(s.halfYearly || {}) },
    yearly: { ...d.yearly, ...(s.yearly || {}) },
    hour: Number.isFinite(s.hour) ? s.hour : d.hour,
    repeatDays: Number.isFinite(s.repeatDays) && s.repeatDays > 0 ? s.repeatDays : d.repeatDays,
  };
}

// --- Europe/Paris wall-clock conversion --------------------------------
//
// Cloud Functions run in UTC regardless of the schedule trigger's own
// timeZone option (that option only controls *when* the function fires,
// not what `new Date()` returns inside it). Every boundary computation
// below needs to reason in the household's actual local calendar, so "now"
// is first converted to Paris Y/M/D/H via Intl, and any computed occurrence
// date is converted back to a real UTC instant (Paris local midnight on
// that date) before ever being compared against a stored ISO timestamp.

function parisDateParts(utcInstant) {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: CHECKLIST_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(utcInstant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl can format midnight as "24" with hour12:false depending on ICU
    // version — normalize to 0 rather than risk an off-by-one on the hour
    // gate below.
    hour: parts.hour === '24' ? 0 : Number(parts.hour),
  };
}

// The Paris UTC offset (in minutes) at a given real instant, derived by
// diffing that instant's Paris wall-clock reading against its own UTC
// reading — rather than hardcoding +1/+2h, so CET/CEST (DST) is handled
// automatically by the ICU data Node ships with.
function parisOffsetMinutes(utcInstant) {
  const p = parisDateParts(utcInstant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, 0);
  return Math.round((asIfUtc - utcInstant.getTime()) / 60000);
}

// Converts a Paris-local calendar date (midnight) into the real UTC instant
// it represents. Single-correction-pass: guess the instant as if the wall
// clock were UTC, then shift by the Paris offset AT that guessed instant.
// This is exact except within the ~1h DST-transition window itself (2-3am
// local) — irrelevant here since every date this function ever receives is
// a checklist reset-boundary date, and the transition itself is never the
// value being converted, only ordinary calendar dates are.
function parisMidnightToUtc(year, month1based, day) {
  const guessUtcMs = Date.UTC(year, month1based - 1, day, 0, 0);
  const offsetMin = parisOffsetMinutes(new Date(guessUtcMs));
  return new Date(guessUtcMs - offsetMin * 60000);
}

// --- Ported boundary math (see js/checklists.js for the client original) --
//
// Deliberately built on Date.UTC/getUTC* throughout, NOT the process's own
// local time — every "year/month/day" here is already a Paris-local
// calendar value (from parisDateParts), so UTC methods are used purely as
// a neutral, timezone-agnostic calendar for the arithmetic, exactly
// mirroring what the client's plain `new Date(y, m, d)` local-time
// arithmetic does when the browser's own local time IS Europe/Paris.

function nthWeekdayOfMonthUTC(year, month1based, weekOfMonth, weekday1to7) {
  const first = new Date(Date.UTC(year, month1based - 1, 1));
  const firstWeekdayIso = first.getUTCDay() === 0 ? 7 : first.getUTCDay();
  let offset = weekday1to7 - firstWeekdayIso;
  if (offset < 0) offset += 7;
  const day = 1 + offset + (weekOfMonth - 1) * 7;
  return new Date(Date.UTC(year, month1based - 1, day));
}

function mostRecentWeeklyOccurrenceUTC(cfg, nowParts) {
  const todayIso = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)).getUTCDay();
  const todayIsoAdj = todayIso === 0 ? 7 : todayIso;
  let diff = todayIsoAdj - cfg.weekday;
  if (diff < 0) diff += 7;
  return new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day - diff));
}

function mostRecentMonthlyOccurrenceUTC(cfg, nowParts) {
  const nowUTC = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
  const thisMonth = nthWeekdayOfMonthUTC(nowParts.year, nowParts.month, cfg.weekOfMonth, cfg.weekday);
  if (thisMonth <= nowUTC) return thisMonth;
  const prev = new Date(Date.UTC(nowParts.year, nowParts.month - 2, 1));
  return nthWeekdayOfMonthUTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, cfg.weekOfMonth, cfg.weekday);
}

// Shared by quarterly (3) / halfYearly (6) — see js/checklists.js's own
// comment for why this uses a linear year*12+month index rather than a
// per-calendar-year loop (anchors whose cycle crosses a year boundary,
// e.g. anchor=November quarterly, need this to line up correctly). `best`
// can be null in principle (defended below in isItemDoneThisPeriod, unlike
// the client which lets `date >= null` silently coerce to `>= 0`).
function mostRecentCyclicOccurrenceUTC(cfg, nowParts, intervalMonths) {
  const nowUTC = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
  const nowIdx = nowParts.year * 12 + (nowParts.month - 1);
  const anchor0based = cfg.anchorMonth - 1;
  let best = null;
  for (let idx = nowIdx; idx >= nowIdx - intervalMonths * 2; idx--) {
    const month0based = ((idx % 12) + 12) % 12;
    if ((((month0based - anchor0based) % intervalMonths) + intervalMonths) % intervalMonths !== 0) continue;
    const year = Math.floor(idx / 12);
    const occ = nthWeekdayOfMonthUTC(year, month0based + 1, cfg.weekOfMonth, cfg.weekday);
    if (occ <= nowUTC && (!best || occ > best)) best = occ;
  }
  return best;
}

function mostRecentYearlyOccurrenceUTC(cfg, nowParts) {
  const nowUTC = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
  const thisYear = nthWeekdayOfMonthUTC(nowParts.year, cfg.month, cfg.weekOfMonth, cfg.weekday);
  if (thisYear <= nowUTC) return thisYear;
  return nthWeekdayOfMonthUTC(nowParts.year - 1, cfg.month, cfg.weekOfMonth, cfg.weekday);
}

function mostRecentOccurrenceUTC(frequency, cfg, nowParts) {
  if (frequency === 'weekly') return mostRecentWeeklyOccurrenceUTC(cfg.weekly, nowParts);
  if (frequency === 'monthly') return mostRecentMonthlyOccurrenceUTC(cfg.monthly, nowParts);
  if (frequency === 'quarterly') return mostRecentCyclicOccurrenceUTC(cfg.quarterly, nowParts, 3);
  if (frequency === 'halfYearly') return mostRecentCyclicOccurrenceUTC(cfg.halfYearly, nowParts, 6);
  return mostRecentYearlyOccurrenceUTC(cfg.yearly, nowParts);
}

// 'YYYY-MM-DD', used both as the notificationState key and as a stable
// per-period identity — the moment the boundary rolls to a new occurrence,
// this key changes, which is what makes a dismissal self-expire with no
// cleanup action needed.
function occurrenceKey(occDateUTC) {
  if (!occDateUTC) return null;
  const y = occDateUTC.getUTCFullYear();
  const m = String(occDateUTC.getUTCMonth() + 1).padStart(2, '0');
  const d = String(occDateUTC.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function occurrenceInstant(occDateUTC) {
  if (!occDateUTC) return null;
  return parisMidnightToUtc(occDateUTC.getUTCFullYear(), occDateUTC.getUTCMonth() + 1, occDateUTC.getUTCDate());
}

function isItemDoneThisPeriod(item, frequency, cfg, nowParts) {
  if (!item.lastCompletedAt) return false;
  const occInstant = occurrenceInstant(mostRecentOccurrenceUTC(frequency, cfg, nowParts));
  // Client-side, `date >= null` coerces to `date >= 0` (i.e. always true) —
  // an unreachable case today given the UI's weekOfMonth 1-4 range, but
  // guarded explicitly here rather than relying on the same coercion,
  // since a scheduler silently treating "can't determine the boundary" as
  // "nothing is due" is a much safer failure mode than the reverse.
  if (!occInstant) return true;
  return new Date(item.lastCompletedAt) >= occInstant;
}

// --- Due computation, grouped per checklist then per recipient ------------

function computeFrequencyDue(maintenance, frequency, cfg, nowParts) {
  const perList = [];
  (maintenance.lists || []).forEach((list) => {
    const items = (list.items || []).filter((it) => it.frequency === frequency);
    const dueCount = items.filter((it) => !isItemDoneThisPeriod(it, frequency, cfg, nowParts)).length;
    if (dueCount > 0) perList.push({ list, dueCount });
  });
  return perList;
}

function recipientBreakdown(perList, slug) {
  const relevant = perList.filter(({ list }) => (list.recipients || []).includes(slug));
  const total = relevant.reduce((sum, r) => sum + r.dueCount, 0);
  return { total, checklists: relevant.map(({ list, dueCount }) => ({ name: list.name, count: dueCount })) };
}

function buildNotificationText(frequency, breakdown) {
  const title = `Erdkeller — ${FREQ_LABELS_ADJ[frequency] || FREQ_LABELS[frequency] || frequency} Wartung`;
  const parts = breakdown.checklists.map((c) => `${c.name} (${c.count})`);
  const body = `${breakdown.total} Aufgabe${breakdown.total === 1 ? '' : 'n'} fällig: ${parts.join(', ')}`;
  return { title, body };
}

// --- Recipients: slug -> /users -> device tokens ---------------------------
//
// list.recipients holds hardcoded slugs ('markus'|'julia'|'sophia'), with
// no link to /users anywhere else in the app — an admin maps each real
// account to a slug once via `recipientSlug` on /users/{uid} (Settings ->
// Personen). A slug nobody has claimed yet simply resolves to zero tokens
// and is silently skipped, same as a recipient with no due items.

async function resolveRecipientTokens(slug) {
  const usersSnap = await db.collection('users').where('recipientSlug', '==', slug).get();
  const entries = [];
  for (const userDoc of usersSnap.docs) {
    const devicesSnap = await db.collection('users').doc(userDoc.id).collection('devices').get();
    devicesSnap.docs.forEach((deviceDoc) => {
      const token = deviceDoc.data().token;
      if (token) entries.push({ token, ref: deviceDoc.ref });
    });
  }
  return entries;
}

// Deletes device docs FCM reports as dead, so a phone that was reset or had
// the PWA uninstalled doesn't accumulate a permanently-failing token that
// silently eats into every future send. Returns FCM's actual per-token
// success/error rather than swallowing it — sendReminders/previewReminders
// don't need that detail and ignore the return value, but sendTestNotification
// does, since "sent to FCM" and "arrived on the device" are two different
// things and the gap between them is exactly what's hard to debug otherwise.
async function sendToTokens(tokenEntries, title, body, data) {
  if (!tokenEntries.length) return [];
  const resp = await messaging.sendEachForMulticast({
    tokens: tokenEntries.map((t) => t.token),
    // Data-only (no top-level `notification` key) — displayed by our own
    // `push` handler in service-worker.js via showNotification(), not by
    // the browser's own FCM auto-display, which would double up with it.
    data: { title, body, ...data },
  });
  await Promise.all(resp.responses.map((r, i) => {
    if (r.success) return null;
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      return tokenEntries[i].ref.delete().catch(() => {});
    }
    return null;
  }));
  return resp.responses.map((r, i) => ({
    label: tokenEntries[i].label || null,
    success: r.success,
    errorCode: r.success ? null : ((r.error && r.error.code) || 'unknown'),
  }));
}

// --- The scheduled send, and the two admin/self-service test paths --------

// Hourly rather than a cron pinned to 09:00, so the configured send hour
// (Settings -> Erinnerungen) stays editable in-app without redeploying this
// function — each tick is a near-free early exit unless it's actually the
// right Paris-local hour.
exports.sendReminders = onSchedule({ schedule: 'every 1 hours', timeZone: CHECKLIST_TZ }, async () => {
  const [notifSnap, stateSnap, maintSnap] = await Promise.all([
    db.doc('config/notifications').get(),
    db.doc('config/notificationState').get(),
    db.doc('config/checklists').get(),
  ]);

  const notifications = notifSnap.exists ? notifSnap.data() : {};
  if (notifications.enabled === false) return; // master toggle — default on if unset (matches "no doc yet" == "not configured, not disabled")
  const cfg = mergeNotificationsChecklists(notifications.checklists);

  const nowInstant = new Date();
  const nowParts = parisDateParts(nowInstant);
  if (nowParts.hour !== cfg.hour) return;

  const maintenance = maintSnap.exists && Array.isArray(maintSnap.data().lists) ? maintSnap.data() : { lists: [] };
  const stateChecklists = (stateSnap.exists && stateSnap.data().checklists) || {};

  // Both this write and the client's dismiss-action write use targeted
  // dot-path field updates (never a whole-document write) into the SAME
  // doc — /config/notificationState is written by two independent parties,
  // and a whole-object write from either side would clobber whatever the
  // other just wrote to a different frequency's fields.
  const stateUpdates = {};

  for (const frequency of FREQUENCIES) {
    const perList = computeFrequencyDue(maintenance, frequency, cfg, nowParts);
    if (!perList.length) continue;

    const occDate = mostRecentOccurrenceUTC(frequency, cfg, nowParts);
    const occKey = occurrenceKey(occDate);
    if (!occKey) continue; // unreachable today, see isItemDoneThisPeriod's own guard

    const freqState = stateChecklists[frequency] || {};
    if (freqState.dismissedOccurrence === occKey) continue; // "Für diesen Zeitraum erledigt"

    const occurrenceChanged = freqState.occurrence !== occKey;
    const daysSinceLastSent = freqState.lastSentAt
      ? (nowInstant.getTime() - new Date(freqState.lastSentAt).getTime()) / 86400000
      : Infinity;
    if (!occurrenceChanged && daysSinceLastSent < cfg.repeatDays) continue;

    let sentAny = false;
    for (const slug of RECIPIENT_SLUGS) {
      const breakdown = recipientBreakdown(perList, slug);
      if (!breakdown.total) continue;
      const tokens = await resolveRecipientTokens(slug);
      if (!tokens.length) continue;
      const { title, body } = buildNotificationText(frequency, breakdown);
      await sendToTokens(tokens, title, body, { freq: frequency });
      sentAny = true;
    }
    if (sentAny) {
      stateUpdates[`checklists.${frequency}.occurrence`] = occKey;
      stateUpdates[`checklists.${frequency}.lastSentAt`] = nowInstant.toISOString();
    }
  }

  if (Object.keys(stateUpdates).length) {
    await db.doc('config/notificationState').set(stateUpdates, { merge: true });
  }
});

// Admin-only dry run: computes exactly what sendReminders would compute,
// per frequency per recipient, WITHOUT sending anything or writing state —
// the standing way to confirm the ported due-math still agrees with the
// live Fällig view, and the only practical way to test something that
// otherwise fires once a week/month at a fixed hour.
exports.previewReminders = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Bitte anmelden.');
  const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
  if (!callerSnap.exists || callerSnap.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Nur für Admins.');
  }

  const [notifSnap, stateSnap, maintSnap] = await Promise.all([
    db.doc('config/notifications').get(),
    db.doc('config/notificationState').get(),
    db.doc('config/checklists').get(),
  ]);
  const notifications = notifSnap.exists ? notifSnap.data() : {};
  const cfg = mergeNotificationsChecklists(notifications.checklists);
  const nowInstant = new Date();
  const nowParts = parisDateParts(nowInstant);
  const maintenance = maintSnap.exists && Array.isArray(maintSnap.data().lists) ? maintSnap.data() : { lists: [] };
  const stateChecklists = (stateSnap.exists && stateSnap.data().checklists) || {};

  const result = { enabled: notifications.enabled !== false, currentParisHour: nowParts.hour, configuredHour: cfg.hour, frequencies: {} };
  for (const frequency of FREQUENCIES) {
    const perList = computeFrequencyDue(maintenance, frequency, cfg, nowParts);
    const occDate = mostRecentOccurrenceUTC(frequency, cfg, nowParts);
    const occKey = occurrenceKey(occDate);
    const freqState = stateChecklists[frequency] || {};
    const dismissed = !!occKey && freqState.dismissedOccurrence === occKey;
    const occurrenceChanged = freqState.occurrence !== occKey;
    const daysSinceLastSent = freqState.lastSentAt
      ? (nowInstant.getTime() - new Date(freqState.lastSentAt).getTime()) / 86400000
      : null;
    const wouldSendNow = perList.length > 0 && !dismissed
      && (occurrenceChanged || daysSinceLastSent === null || daysSinceLastSent >= cfg.repeatDays);

    result.frequencies[frequency] = {
      occurrenceKey: occKey,
      dismissed,
      lastSentAt: freqState.lastSentAt || null,
      wouldSendNow,
      recipients: RECIPIENT_SLUGS.map((slug) => {
        const breakdown = recipientBreakdown(perList, slug);
        return { slug, ...breakdown, ...(breakdown.total ? buildNotificationText(frequency, breakdown) : {}) };
      }),
    };
  }
  return result;
});

// Self-service: sends one fixed test push to every device the CALLER
// themselves has registered (never another user's) — the fast end-to-end
// check for "does token -> FCM -> service worker -> on-screen notification
// actually work on this device", independent of whether anything is
// actually due right now.
exports.sendTestNotification = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Bitte anmelden.');
  const devicesSnap = await db.collection(`users/${request.auth.uid}/devices`).get();
  const tokens = devicesSnap.docs
    .map((d) => ({ token: d.data().token, label: d.data().label || null, ref: d.ref }))
    .filter((t) => t.token);
  if (!tokens.length) {
    throw new HttpsError('failed-precondition', 'Kein Gerät für diesen Account registriert.');
  }
  const results = await sendToTokens(tokens, 'Erdkeller', 'Testbenachrichtigung — wenn du das siehst, funktioniert es.', { freq: 'test' });
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).map((r) => ({ label: r.label, error: r.errorCode }));
  return { total: results.length, succeeded, failed };
});
