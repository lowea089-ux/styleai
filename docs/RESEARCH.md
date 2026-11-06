# StyleAI – Research-Zusammenfassung

Stand der Recherche: **27.10.2026**. Quellen sind am Ende jedes Abschnitts verlinkt. Wo nur Herstellerangaben,
Vergleichsseiten von Wettbewerbern oder aggregierte Reviews vorlagen, ist das ausdrücklich vermerkt.

---

## 1. Bestehende Apps (digitaler Kleiderschrank / KI-Styling)

| App | Bestätigte Kernfunktionen | Erkennbare Schwächen (laut Reviews/Vergleichen) |
|---|---|---|
| **Whering** | Foto-Katalogisierung mit Auto-Tagging, Kalender/Outfit-Planer, Statistiken, „Dress Me“ (zufälliges Mischen), KI-Outfits (Beta) | Tagging oft falsch; Auto-Crop/Freistellung ohne manuelle Korrektur; Abstürze und Langsamkeit |
| **Acloset** | Automatische Freistellung + Basis-Tags (Kategorie, Farbe), Outfit-Empfehlungen, Community-Feed, Second-Hand-Marktplatz | Empfehlungen teils unsinnig; Gratis-Version auf 100 Teile begrenzt; Glitches beim Upload |
| **Indyx** | Kleiderschrank + **menschliche** Stylisten (ab ca. 25 $/Monat) | Personalisierung kostet, kaum automatisiert |

**Vorsicht bei den Quellen:** Die meisten Vergleiche stammen von Wettbewerbern (Indyx, GetWardrobe) oder von
KI-aggregierten Review-Reports. Die Prozentangaben aus diesen Reports sind nicht verifiziert.

**Abgeleitete Anforderungen für StyleAI**

1. Die Digitalisierung ist der größte Reibungspunkt → Stapel-Upload, automatische Freistellung **mit** manueller
   Korrektur (Toleranz, Original behalten) und eine Prüf-Ansicht pro Teil.
2. Zufälliges Mischen wirkt beliebig → nachvollziehbare Bewertung pro Outfit mit Begründung.
3. KI-Tags sind fehleranfällig → jedes Feld editierbar, „unbekannt“ ist ein gültiger Wert, keine erfundenen Marken/Materialien.
4. Stabilität: Kernfunktionen (Kleiderschrank, Generator) dürfen nicht von externen KI-Diensten abhängen.

Quellen: [Indyx – Acloset vs. Whering](https://www.myindyx.com/versus/acloset-vs-whering) ·
[Indyx – Whering vs. Indyx](https://myindyx.com/versus/whering-vs-indyx) ·
[GetWardrobe – Vergleich 2026 (Anbieter-Seite)](https://getwardrobe.com/compare/) ·
[Kimola – Whering Review-Report](https://kimola.com/reports/whering-digital-closet-stylist-user-feedback-report-google-play-en-144486) ·
[Kimola – Acloset Review-Report](https://kimola.com/reports/acloset-app-feedback-analysis-insights-for-growth-google-play-en-141015) ·
[fits-app – Top 8 Closet Apps](https://www.fits-app.com/posts/top-8-closet-outfit-planning-apps-reviewed)

---

## 2. Bildverarbeitung: Freistellung

| Option | Qualität | Kosten | Integration | Lizenz / Bedingungen |
|---|---|---|---|---|
| **Photoroom API** (`POST https://sdk.photoroom.com/v1/segment`, Header `x-api-key`, Feld `image_file`) | sehr gut | ca. 0,02 $/Bild (Basic) laut mehreren Quellen | einfach (serverseitig) | kommerziell, Bild geht an Photoroom |
| **remove.bg API** (`POST https://api.remove.bg/v1.0/removebg`, Header `X-Api-Key`, Felder `image_file`, `size`) | sehr gut | 50 Aufrufe/Monat gratis, danach Credits; Preisangaben widersprüchlich | einfach | **Umzug zu Leonardo.Ai ab 01.12.2026** angekündigt → Risiko |
| `@imgly/background-removal` (Browser, ONNX) | gut | gratis | mittel (großes Modell im Browser) | **AGPL** – für Closed-Source-Produkte kommerzielle Lizenz nötig |
| RMBG-2.0 (BRIA, BiRefNet-basiert) | sehr gut | Hosting nötig | hoch | **CC BY-NC 4.0** – nicht kommerziell |
| Eigene Heuristik (Rand-Farbschätzung + Flood-Fill im Lab-Farbraum) | gut bei ruhigem Hintergrund, schwach bei unruhigem | gratis, offline | gering | eigene Implementierung |

**Entscheidung:** Standard ist die lokale Heuristik im Browser (kein Upload des Originals, keine Kosten), mit
Live-Vorschau und Toleranz-Regler. Optional serverseitig Photoroom oder remove.bg, sobald ein API-Schlüssel gesetzt ist.

Quellen: [Photoroom Quickstart](https://docs.photoroom.com/remove-background-api-basic-plan/quickstart-guide.md) ·
[Photoroom vs. remove.bg Kosten (Photoroom-Blog, Eigenwerbung)](https://www.photoroom.com/blog/remove-bg-api-cost-leonardo-ai-vs-photoroom) ·
[remove.bg API](https://www.remove.bg/api) ·
[CostBench remove.bg](https://costbench.com/software/ai-media-apis/remove-bg-api/) ·
[imgly README (AGPL-Hinweis)](https://unpkg.com/@imgly/background-removal@1.5.8/README.md) ·
[BRIA RMBG-2.0](https://github.com/Bria-AI/RMBG-2.0)

---

## 3. Bilderkennung von Kleidung

* **Multimodale LLMs** (z. B. Claude) erkennen Kategorie, Muster, Stil, Formalität und erzeugen Beschreibungen. Mit
  *Structured Outputs* (JSON-Schema via `output_config.format`) ist das Ausgabeformat garantiert; die **Werte** müssen
  trotzdem validiert werden (Kategorie-Liste, Wertebereiche). Bounding-Boxen für mehrere Teile pro Foto sind nur
  näherungsweise → Nutzer bestätigt jeden erkannten Ausschnitt.
* **Spezialisierte Embedding-Modelle** wie Marqo-FashionSigLIP (ca. 150 M Parameter, trainiert u. a. auf Farben,
  Materialien, Kategorien) sind stark in Retrieval-Benchmarks (Category-to-Product MRR 0,812). Sie brauchen eigenes
  Hosting und liefern Vektoren statt Beschreibungen → sinnvoll für eine spätere Ausbaustufe („ähnliche Teile“,
  gelernte Kompatibilität), nicht für die erste Version.
* **Farben** werden nicht dem LLM überlassen, sondern deterministisch aus den freigestellten Pixeln berechnet
  (k-Means im Lab-Farbraum → benannte Farbfamilien). Das ist reproduzierbar, kostenlos und funktioniert ohne KI.

Quellen: [Marqo FashionCLIP/FashionSigLIP (GitHub)](https://github.com/marqo-ai/marqo-FashionCLIP) ·
[Marqo-Blog](https://marqo.ai/blog/search-model-for-fashion)

---

## 4. Outfit-Bewertung (Farbharmonie, Stil, Kombination)

* Forschung: *Type-aware Embeddings* (Vasileva et al., ECCV 2018) lernen Kompatibilität pro Teile-Paar aus 68.306
  Polyvore-Outfits. Solche Modelle brauchen viele Trainingsdaten und lösen das Kaltstartproblem eines einzelnen Nutzers nicht.
* LLMs formulieren gute Begründungen, können aber Kleidungsstücke „erfinden“, wenn man sie frei kombinieren lässt.

**Entscheidung – hybrider Ansatz:**

1. Eine **deterministische Engine** bildet Kandidaten ausschließlich aus vorhandenen, verfügbaren Teilen und bewertet
   sie nach Stilkompatibilität, Farbharmonie (Farbton-Abstände, Neutrale, Ton-in-Ton, Akzentanzahl), Mustermix,
   Proportionen, Formalität, Anlass, Wetter-Wärmebilanz/Layering, Saison, Personalisierung und Wiederholungen.
2. Optional wählt ein LLM aus den **bereits gültigen** Top-Kandidaten aus und formuliert die Erklärung.
   IDs außerhalb der Kandidatenliste werden verworfen.
3. Ohne KI liefert die Engine regelbasierte Begründungen – die App bleibt voll nutzbar.

Quellen: [Vasileva et al. 2018 (arXiv)](https://arxiv.org/abs/1803.09196) ·
[CS231n-Projekt zu OutfitTransformer](https://cs231n.stanford.edu/papers/text_file_840593249-CS231n_Final%20(3).pdf)

---

## 5. Aktuelle Modetrends – Datenquellen

* **Es gibt keine freie, verlässliche Trend-API.** Die offizielle Google-Trends-API ist seit Juli 2025 eine
  Alpha nur auf Einladung (Stand Ende 2026 weiterhin Alpha, keine Preise); `pytrends` wurde im April 2025 archiviert.
  WGSN, Trendalytics, Stylus sind kostenpflichtig. Magazin-Scraping ist urheber- und AGB-rechtlich problematisch.
* **Entscheidung:** Kuratierter Trend-Datensatz mit Recherchedatum, Quellen-Links und Gültigkeitszeitraum
  (`shared/trends.ts`). Die App zeigt den Stand an und warnt, wenn der Datensatz älter als 120 Tage ist. Trends
  sind als Merkmalsregeln (Farben, Kategorien, Stile, Muster) hinterlegt, damit die Engine sie mit der eigenen
  Garderobe umsetzen kann.

Recherchierte Trends (Herbst/Winter 2026) und Quellen:

* Pantone Color of the Year 2026: **Cloud Dancer** (PANTONE 11-4201), bekannt gegeben am 04.12.2025 – [NBC News](https://www.nbcnews.com/pop-culture/pop-culture-news/pantone-names-2026-color-year-rcna247366)
* JOOR, Women's Fall 2026 Trend Report (17.03.2026): Moody Maroon, Nouveau Tuxedo, Cocooned Confidence, Intarsia Knits, Lean Tailoring, Leather Bombers – [JOOR](https://www.joor.com/insights/womens-fall-fashion-trend-report)
* Style Arcade, Paris Fashion Week FW26 (12.03.2026): At attention (Military), Super base layer, Bomber nostalgia, All wrapped up, Animal Prints; Farbpalette Navy/Camel/Lila/Burgunder – [Style Arcade](https://www.stylearcade.com/blog/top-trends-from-paris-fashion-week-fall-winter-2026)
* Trendalytics, Menswear Runway FW26 (2026): Sports Prep, Jacket Updates (Leder-Bomber, Utility-Trench, Puffer), Timeless Knitwear, Classic Suiting – [Trendalytics](https://trendalytics.co/insights/the-top-10-menswear-runway-trends-fall-winter-2026)
* Google Trends API Alpha – [Search Engine Journal](https://www.searchenginejournal.com/google-trends-api-alpha-launching-breaking-news/551935/) · [konabayev.com – Landscape 2026](https://konabayev.com/blog/google-trends-api-landscape-2026/)

---

## 6. Wetter

**Open-Meteo**: kein API-Schlüssel nötig, Forecast + Geocoding, < 10.000 Aufrufe/Tag, 5.000/Stunde, 600/Minute.
**Kostenlos nur für nicht-kommerzielle Nutzung**, Daten unter CC BY 4.0 (Attribution wird in der App angezeigt).
Für einen kommerziellen Betrieb ist ein Abo nötig (dann `OPEN_METEO_API_KEY` + Kunden-Host). Die Wetterabfrage
läuft über einen Server-Proxy mit Cache (10 Minuten) und ist austauschbar.

Quelle: [Open-Meteo Terms](https://open-meteo.com/en/terms)

---

## 7. KI-Anbieter, Kosten, Latenz

Preise laut Anthropic-Dokumentation (Stand 06.10.2026, pro 1 Mio. Tokens Input/Output):

| Modell | Input | Output | Einsatz |
|---|---|---|---|
| Claude Opus 5.5 (`claude-opus-5-5`) | 4 $ | 20 $ | Standard in StyleAI (beste Qualität) |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | 2 $ | 10 $ | Alternative |
| Claude Haiku 5.5 (`claude-haiku-5-5`) | 0,10 $ | 0,50 $ | günstigste Option für Massen-Tagging |

* Ein auf 1024 px verkleinertes Foto entspricht grob 1.400 Input-Tokens. Grobe Schätzung pro Bildanalyse inklusive
  Ausgabe: **2–4 Cent mit Opus 5.5, unter 0,2 Cent mit Haiku 5.5**. Das Modell ist per Umgebungsvariable wählbar,
  über die Qualität/Kosten-Abwägung entscheidet der Betreiber.
* Kostenkontrolle in der App: Tageslimits pro Nutzer, Minuten-Ratelimit, Verkleinerung vor dem Upload, KI nur bei
  Einwilligung, die Outfit-Engine selbst kostet nichts.
* Latenz: Bildanalyse typischerweise einige Sekunden → asynchrone Warteschlange mit Fortschrittsanzeige.
* Datennutzung: API-Daten werden laut Anthropic-Commercial-Terms standardmäßig nicht zum Training verwendet;
  zur Aufbewahrungsdauer widersprechen sich Sekundärquellen (7 bzw. 30 Tage) → vor dem Livegang das aktuelle DPA prüfen.

Quellen: Anthropic-Modell- und Preistabelle (Claude-API-Dokumentation) ·
[Übersicht Retention (Sekundärquelle)](https://anarlog.so/blog/anthropic-data-retention-policy) ·
[meetily.ai – Anthropic Privacy (Sekundärquelle)](https://meetily.ai/llm-privacy/anthropic)

---

## 8. Datenschutz (DSGVO-orientiert)

* Kleidungsfotos können Personen, Wohnräume und **GPS-Metadaten** enthalten → Bilder werden serverseitig neu
  kodiert (EXIF wird entfernt), privat gespeichert und nur nach Eigentümerprüfung ausgeliefert.
* Übertragung an externe KI-Anbieter nur nach ausdrücklicher Einwilligung, die jederzeit widerrufbar ist; die App
  nennt Anbieter und Zweck vor dem ersten Upload.
* Einzelne Bilder, alle Bilder oder das komplette Konto lassen sich löschen; Datenexport als JSON.
* Schriften werden selbst gehostet (keine Google-Fonts-Abrufe; vgl. LG München I, Urteil vom 20.01.2022, Az. 3 O 17493/20).
* Standort wird nur auf Stadt-Ebene bzw. auf 2 Nachkommastellen gerundet gespeichert. Kein Tracking, keine Analytics.
* Logs enthalten keine Bilder, keine Prompts und keine E-Mail-Adressen.

---

## 9. Architekturentscheidung (Kurzfassung)

Gewünscht war Supabase (Auth, Postgres, Storage, RLS). Lokal ist **kein Docker** vorhanden (nötig für den
Supabase-Local-Stack), und ein Supabase-Konto kann ich nicht für dich anlegen. Damit die App **sofort lauffähig und
testbar** ist, nutzt Version 1:

* **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4 + Radix-Primitives (zugängliche Dialoge), TanStack Query
* **Backend:** Hono auf Node 24, TypeScript
* **Datenbank:** SQLite über das in Node eingebaute `node:sqlite` (keine nativen Abhängigkeiten); das Schema ist
  Postgres-kompatibel aufgebaut, alle Abfragen sind serverseitig auf die `user_id` beschränkt (entspricht RLS)
* **Bilder:** privates Dateisystem-Verzeichnis, Neukodierung mit `sharp`, Auslieferung nur an den Eigentümer
* **KI:** austauschbares Provider-Interface, Implementierung für Claude; ohne Schlüssel greift der lokale Modus

Der Migrationspfad zu Supabase/Postgres ist in `docs/ARCHITECTURE.md` beschrieben (die Datenzugriffe liegen gebündelt im Repository-Modul).

---

## 10. Erwartbare technische Schwierigkeiten

* Freistellung bei unruhigem Hintergrund (Bett, Muster) → Heuristik scheitert; Lösung: Toleranzregler, Original behalten, optional Photoroom.
* Mehrere Teile pro Foto: Bounding-Boxen des LLM sind ungenau → Nutzer bestätigt/verwirft jeden Ausschnitt.
* Farbstiche durch Kunstlicht verfälschen Farben → Farben sind editierbar.
* Material/Marke sind visuell oft nicht sicher → bleiben „unbekannt“.
* HEIC-Fotos vom iPhone: nicht jeder Browser kann sie dekodieren → verständliche Fehlermeldung.
* Kaltstart der Personalisierung → Fragebogen + gewichtete, zeitlich abklingende Signale.
* Trend-Daten veralten → Datum sichtbar, Warnhinweis, Engine funktioniert auch ohne Trends.

---

## 11. Priorisierter Entwicklungsplan

1. **Kern (v1):** Konten, Kleiderschrank mit Upload/Freistellung/Farberkennung, Kategorien, Filter, Bearbeiten.
2. **KI (v1):** Bildanalyse (optional), Outfit-Engine, Austausch einzelner Teile, Feedback-Lernen, Stylist-Chat.
3. **Erweiterungen (v1):** Wetter, Trends (kuratiert), Kalender, Statistiken, Kosten pro Tragen.
4. **Später:** Supabase-Deployment, Embedding-basierte Ähnlichkeit (FashionSigLIP), virtuelle Anprobe,
   Push-Erinnerungen, native App-Hülle (Capacitor), Google-Trends-Anbindung nach GA.
