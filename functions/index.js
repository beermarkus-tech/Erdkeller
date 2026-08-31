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
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

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
{"direction": "in", "matchedProductId": "<id aus der Produktliste oben>", "quantity": <Zahl>, "content": "<z.B. 800g, oder null>", "bestBefore": "<MM/JJJJ oder null>", "storage": "<Text oder null>"}

2) Kein bekanntes Produkt passt (neues Produkt):
{"direction": "in", "newProductName": "<Name>", "suggestedSubcategoryId": "<id aus der Liste oben, oder null wenn unklar>", "confidence": "high"|"medium"|"low", "quantity": <Zahl>, "content": "<... oder null>", "bestBefore": "<MM/JJJJ oder null>", "storage": "<... oder null>", "guessedUnitType": "kg"|"l"|"stueck"}

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

exports.parseDictation = onCall({ secrets: [anthropicApiKey] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Bitte anmelden.');
  }
  const transcript = (request.data && typeof request.data.transcript === 'string' ? request.data.transcript : '').trim();
  if (!transcript) {
    throw new HttpsError('invalid-argument', 'Kein Text übergeben.');
  }

  const [taxSnap, productsSnap, batchesSnap] = await Promise.all([
    db.doc('config/taxonomy').get(),
    db.collection('products').get(),
    db.collection('stockItems').get(),
  ]);
  const taxonomy = taxSnap.exists && Array.isArray(taxSnap.data().types) ? taxSnap.data() : { types: [] };
  const products = productsSnap.docs.map((d) => {
    const p = d.data();
    return { id: d.id, name: p.name || '', unitType: p.unitType || '' };
  });
  const productIndex = new Map(products.map((p) => [p.id, p]));
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

  const prompt = buildPrompt(transcript, taxonomy, products, batches, productIndex);

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
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
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

  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
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
