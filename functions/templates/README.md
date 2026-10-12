# Starter templates for new households

Categories (types → categories → subcategories) a household starts with, picked by its data language when it is created (`createHousehold`, functions/index.js). Copied from Markus's household on 2026-10-12 (Build 209), with two family-specific medicine subcategories replaced by "Allergien"; the English one is a translation with the same ids, icons and planning settings — only the names differ (`tools/rules-test/invites.test.cjs` checks that).

To change a template, edit `taxonomy-de.json` / `taxonomy-en.json` and deploy the functions. Existing households are never touched.

| | Icon | Deutsch | English (US) |
|---|---|---|---|
| **Type** | 🧭 | **Ausrüstung** | **Equipment** |
| Category | 💡 | Licht & Feuer | Light & Fire |
| ↳ | 🕯️ | Kerzen / Feuerzeug / Streichhölzer | Candles / Lighters / Matches |
| ↳ | 🔦 | Taschenlampen / Leuchten | Flashlights / Lamps |
| ↳ | 🔋 | Batterien | Batteries |
| **Type** | 🥫 | **Lebensmittel** | **Food** |
| Category | 🥩 | Fisch, Fleisch, Eier | Fish, Meat, Eggs |
| ↳ | 🐟 | Dosenfisch | Canned fish |
| ↳ | 🥩 | Dosenfleisch / Wurst / Schinken | Canned meat / Sausage / Ham |
| ↳ | 🍲 | Eintopf (Fleisch) | Stew (meat) |
| ↳ | 🥚 | Eier / Volleipulver | Eggs / Powdered eggs |
| Category | 🍆 | Gemüse | Vegetables |
| ↳ | 🍅 | Tomaten / Sugo | Tomatoes / Pasta sauce |
| ↳ | 🍛 | Eintopf (Gemüse) | Stew (vegetable) |
| ↳ | 🥒 | Eingelegtes Gemüse | Pickled vegetables |
| ↳ | 🥕 | Frisches Gemüse / Kartoffeln | Fresh vegetables / Potatoes |
| Category | 🛢️ | Fette, Öle, Nüsse | Fats, Oils, Nuts |
| ↳ | 🛢️ | Fette & Öle | Fats & Oils |
| ↳ | 🌰 | Nüsse, Kerne, Samen | Nuts & Seeds |
| Category | 🌾 | Getreide & Hülsenfrüchte | Grains & Legumes |
| ↳ | 🌾 | Mehl / Brotbackmischung | Flour / Bread mix |
| ↳ | 🥣 | Haferflocken / Müsli / Porridge | Oats / Muesli / Oatmeal |
| ↳ | 🍚 | Reis / Milchreis | Rice / Rice pudding |
| ↳ | 🍝 | Nudeln / Couscous / Grieß | Pasta / Couscous / Semolina |
| ↳ | 🍞 | Brot / Knäckebrot / Zwieback | Bread / Crispbread / Rusks |
| ↳ | 🫛 | Hülsenfrüchte | Beans & Lentils |
| Category | 🐮 | Milch & Milchprodukte | Milk & Dairy |
| ↳ | 🥛 | Milch / Milchpulver | Milk / Powdered milk |
| ↳ | 🧀 | Milchprodukte | Dairy products |
| Category | 🍎 | Obst | Fruit |
| ↳ | 🍑 | Eingelegtes Obst / Kompott / Mus | Canned fruit / Compote / Applesauce |
| ↳ | 🍒 | Trockenfrüchte | Dried fruit |
| ↳ | 🍌 | Frisches Obst | Fresh fruit |
| Category | 🍵 | Zucker, Gewürze, Kaffee | Sugar, Spices, Coffee |
| ↳ | 🍯 | Marmelade / Honig / Zucker | Jam / Honey / Sugar |
| ↳ | 🍬 | Süßigkeiten / Knabberzeug | Sweets / Snacks |
| ↳ | ☕ | Kaffee / Tee | Coffee / Tea |
| ↳ | 🍜 | Tütensuppen / Trockengerichte | Instant soups / Dried meals |
| ↳ | 🧂 | Salz / Gewürze / Soßen | Salt / Spices / Sauces |
| Category | 🍾 | Getränke | Beverages |
| ↳ | 🍷 | Alkohol | Alcohol |
| ↳ | 🍹 | Säfte | Juices |
| **Type** | 🐈 | **Tiere** | **Animals** |
| Category | 🌾 | Futter | Feed |
| ↳ | 🐶 | Hund | Dog |
| ↳ | 🐱 | Katze | Cat |
| ↳ | 🐔 | Hühner | Chickens |
| ↳ | 🐐 | Ziegen | Goats |
| Category | 🪏 | Zubehör | Supplies |
| ↳ | 🐱 | Katze | Cat |
| **Type** | 💊 | **Medikamente** | **Medicine** |
| Category | ⚕️ | Hausapotheke | Medicine cabinet |
| ↳ | 🌼 | Allergien | Allergies |
| ↳ | 🦟 | Insektenstiche | Insect bites |
| ↳ | 🤢 | Magen | Stomach |
| ↳ | 🤧 | Erkältung | Colds |
| ↳ | 🤕 | Schmerzen | Pain |
| ↳ | 💊 | Nahrungsergänzung | Supplements |
| Category | 🚨 | Notfall | Emergency |
| ↳ | 🤮 | Magen/Darm | Stomach & Bowel |
| ↳ | 🤒 | Infektion | Infection |
| ↳ | 🚑 | Verletzung | Injury |
| ↳ | 💧 | Wasserreinigung | Water purification |
| **Type** | 💧 | **Wasser** | **Water** |
| Category | 💧 | Trinkwasser | Drinking water |
| ↳ | 💧 | Trinkwasser | Drinking water |
| Category | 💦 | Gebrauchswasser | Non-drinking water |
| ↳ | 💦 | Gebrauchswasser | Non-drinking water |
