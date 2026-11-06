# Architektur

## Überblick

```
Browser (React 19, Vite, Tailwind v4)
  ├─ Freistellung + Farberkennung lokal (src/lib/image.ts, shared/color.ts)
  └─ /api/*  ──►  Node-Server (Hono)                         server/
                   ├─ Auth (scrypt, Session-Cookie)            auth.ts, routes/account.ts
                   ├─ Repository (jede Abfrage mit user_id)    repo.ts  ──► SQLite (node:sqlite)
                   ├─ Bilder (sharp, privat auf Platte)        images.ts ──► DATA_DIR/uploads/<user>/
                   ├─ Outfit-Service                           outfits.ts
                   │    ├─ Engine (deterministisch)            shared/engine/*
                   │    └─ KI-Schicht (optional)               ai/service.ts → Claude | Groq/OpenAI-kompatibel | Gemini
                   ├─ Wetter-Proxy (Open-Meteo, Cache)         weather.ts
                   └─ Profi-Freistellung (optional)            bg.ts
```

`shared/` enthält alles, was Server, Browser und Tests gemeinsam nutzen: Taxonomie, Farblehre, Zod-Schemas,
Engine, Trends und den lokalen Sprachparser.

## Warum kein Supabase in Version 1

Supabase war bevorzugt. Lokal war kein Docker vorhanden (für den Supabase-Local-Stack nötig) und es gab keine
Zugangsdaten; ein Konto kann nur der Betreiber anlegen. Damit die App sofort lauffähig und vollständig testbar ist,
nutzt Version 1 einen eigenen Node-Server mit SQLite. Die Struktur ist auf eine Migration ausgelegt:

* Tabellen sind Postgres-kompatibel modelliert (Text-UUIDs, ISO-Zeitstempel, JSON-Spalten → `jsonb`).
* Sämtliche Datenzugriffe liegen in `server/repo.ts` und filtern auf `user_id` – das entspricht den RLS-Regeln
  `using (user_id = auth.uid())`, die bei Supabase zusätzlich datenbankseitig greifen würden.
* Bilder: `ImageStore` kapselt Speichern/Lesen/Löschen → austauschbar gegen Supabase Storage (privater Bucket,
  signierte URLs mit Ablaufzeit).
* Auth: `requireAuth` ist die einzige Stelle, die Sitzungen prüft → austauschbar gegen Supabase-JWT-Prüfung.

Migrationsschritte: Schema als SQL-Migration nach Postgres übertragen, RLS pro Tabelle aktivieren, `repo.ts` auf
`postgres`/`supabase-js` (Service-Role nur serverseitig) umstellen, Storage-Bucket privat anlegen, Auth-Middleware
auf Supabase-Sessions umstellen. Die Engine und das Frontend bleiben unverändert.

## Datenmodell

| Tabelle | Inhalt |
|---|---|
| `users` | id, E-Mail, Passwort-Hash (scrypt), Anzeigename, Zeitpunkt der KI-Einwilligung |
| `sessions` | SHA-256-Hash des Session-Tokens, Ablaufdatum (das Token selbst wird nie gespeichert) |
| `style_preferences` | bevorzugte Stile, eigener Stil, Lieblings-/Meidefarben, Anlässe, Experimentierfreude, Auffälligkeit, Personalisierung an/aus, Wiederholungs-Sperrfrist, Ort (gerundet), Theme |
| `categories` | pro Nutzer; Bereich, Rolle im Outfit (slot), Schicht, Standard-Wärme/-Formalität, Accessoire-Art |
| `clothing_items` | Bildpfade, Kategorie, Unterart, Farben (Familie, Hex, Anteil), Muster, Material, Passform, Stile, Saisons, Anlässe, Formalität, Wärme, Status, Favorit, Tags, Marke, Kaufdatum, Preis, KI-Konfidenz |
| `outfits` + `outfit_items` | Teile mit Rolle (top/base/mid/outer/bottom/…/acc:*), Stil, Anlass, Wetterkontext, Erklärung, Score, Aufschlüsselung, gespeichert/Favorit |
| `outfit_feedback` | like/dislike/save/wear/swap/remove_item mit beteiligten Teilen |
| `outfit_calendar` | Datum, Outfit, Status geplant/getragen, Notiz |
| `wear_log` | ein Eintrag pro getragenem Teil und Tag (aus Kalender oder „Heute getragen“) – Basis für Statistik |
| `ai_usage` | Anfragen und Tokens pro Nutzer, Tag und Art – für Tageslimits |
| `user_ai_settings` | eigener KI-Anbieter pro Nutzer: Anbieter, verschlüsselter Schlüssel, Kürzel, Basis-URL, Modelle |

Generierte, nicht gespeicherte Outfits werden nicht persistiert. Sobald ein Outfit gespeichert, eingeplant oder als
getragen markiert wird, entsteht ein Datensatz.

## Bildverarbeitung (`shared/vision`)

Reine Funktionen auf RGBA-Puffern (im Browser und in den Tests nutzbar); `src/lib/image.ts` bindet sie an Canvas.

1. **Licht** (`lighting.ts`): Helligkeits-Perzentile in L*; Aufhellung nur, wenn selbst die hellsten Bildteile
   dunkel sind (bis 2,4×, bei stark unterbelichteten Fotos bis 4×). Weißabgleich aus Shades-of-Gray (p = 6),
   hellen Pixeln und Gray-World; korrigiert wird nur entlang typischer Lichtfarben (Blau↔Gelb voll, Grün↔Magenta
   gedämpft), mit Stärke 0,85 bzw. 0,35, wenn eine einzelne kräftige Farbe das Bild dominiert. Anwendung über
   Lookup-Tabellen pro Kanal mit weicher Schulter statt hartem Clipping.
2. **Freistellung** (`segment.ts`, ≤ 480 px): Lab + 3×3-Median, Kandidaten-Hintergrundfarben per k-Means vom
   Rand (nur Farben an ≥ 2 Bildseiten). Mehrere Hypothesen, welche Kandidaten Hintergrund sind („rand“,
   „ohne-mitte“ für formatfüllende Teile, „nur-mitte“ für kleine Teile in einer Ecke); je Hypothese robuste
   quadratische Ausgleichsfläche der Randhelligkeit, Toleranz aus der Otsu-Schwelle (× Regler/20), Flood-Fill vom
   Rand mit Schattenverfolgung und Stopp an Sobel-Kanten, Öffnung + Zusammenhangskomponenten. Gewählt wird das
   plausibelste Ergebnis (Größe 2–92 %, < 80 % des Bildrands, bevorzugt Bildmitte). Eingeschlossene Flächen in
   Hintergrundfarbe werden als Lücken gemeldet (`holes`), nicht automatisch entfernt.
   Nachbessern von Hand (`edit.ts`): Zauberstab (Farbnähe zum angetippten Punkt oder sanfter Verlauf) und weicher
   Pinsel auf dem Alpha-Kanal in Fotoauflösung.
3. **Kanten** (`refine.ts`): Guided Filter (He et al.) auf der Helligkeit bis 1024 px, beschränkt auf ±2
   Arbeitspixel um die grobe Kante.
4. **Farben** (`shared/color.ts`): Licht-Perzentile (4 %/98,5 %) abschneiden, k-Means, Cluster mit kleinem
   ΔE00 bei abgeschwächter Helligkeit (kL = 2,8) zusammenlegen, Farbe aus der helleren Hälfte jeder Gruppe.

## Live-Anprobe (`shared/tryon`, `src/lib/tryon`, `src/components/TryOn.tsx`)

* **Körpererkennung:** MediaPipe Pose Landmarker (Apache-2.0, `@mediapipe/tasks-vision`), Modell
  `public/models/pose_landmarker_full.task`, WASM aus dem npm-Paket (Vite `?url`); GPU-Delegate mit CPU-Rückfall,
  Video-Modus für die Kamera, Bild-Modus für Fotos, Personenmaske für die Verdeckung. Die Ansicht wird erst beim
  Öffnen geladen (eigener Chunk).
* **Formanalyse** (`anchors.ts`): aus der Alpha-Maske des Kleidungsbilds Rumpfkanten, Schulternaht, Achsel,
  Ärmel (Achse, Länge, Breiten an Stationen; seitlich oder hängend), bei Hosen Bund, Schritt und Beine.
* **Abbildung** (`layout.ts`): Rumpf entlang Schulterlinie und Körperachse (Breite aus sichtbarer
  Schulterbreite, Länge aus der drehungsunabhängigen Rumpflänge), Ärmel entlang Schulter → Ellbogen → Handgelenk,
  Beine entlang Hüfte → Knie → Knöchel; am Gelenkansatz fließend in die Rumpf-/Bundabbildung, damit nichts
  abreißt. Beim Heben des Arms wandern Ärmelansatz und Achsel mit. Fehlende Körperpunkte werden aus
  Körperproportionen geschätzt oder als Hinweis gemeldet.
* **Zeichnen** (`render.ts`): Teile als Dreiecksnetze (Canvas-Affintransform je Dreieck, leicht überlappend),
  Ebenen nach Rolle; Helligkeit an den Raum angepasst plus weicher Schatten; Kopf (bis zum Kinn) und Hände aus
  dem Kamerabild über die Kleidung gelegt (Personenmaske ∩ Kopf-Ellipse/Hand-Kreise); Kopfbedeckung danach.
* **Glättung:** One-Euro-Filter je Körperpunkt (`filter.ts`).
* **Rechte:** Die Desktop-App erlaubt Kamera ohne Mikrofon; die CSP erlaubt `'wasm-unsafe-eval'` für das
  WebAssembly (kein JS-`eval`). Kamerabilder verlassen das Gerät nicht.

## Realistische Live-Anprobe (Decart Lucy VTON)

* **Ablauf** (`src/components/TryOnLive.tsx`): Einwilligung → Kamera (1280×720, Frontkamera) → Körper-Umriss mit
  lokaler Pose-Erkennung („Tritt einen Schritt zurück“) → automatischer Start nach ~1 s im Umriss → Live-Video
  mit Countdown → Wechsel der Teile per `setImage` ohne neue Verbindung. Keine Person für 6 s → Sitzung endet.
* **Verbindung** (`src/lib/tryon/decart.ts`): `@decartai/sdk` (MIT, lädt LiveKit) wird erst beim Start geladen.
  `createDecartClient({ apiKeyProvider, telemetry: false })` holt vor jedem Verbindungsaufbau ein frisches Token
  von `POST /api/tryon/token`; `realtime.connect(kamera, { model, initialState: { prompt, image } })`.
* **Vorlage & Anweisung** (`shared/tryon/vton.ts`): oberste sichtbare Oberteil-Schicht über der Hose (512 px breit,
  weißer Hintergrund) bzw. ein einzelnes Teil; englische Anweisung im Stil der Decart-Beispiele
  („Substitute the current outfit with … on top and … on the bottom“), nur aus gespeicherten Merkmalen.
* **Server** (`server/tryon.ts`, `server/routes/tryon.ts`): Schlüssel pro Nutzer AES-256-GCM-verschlüsselt
  (`user_tryon_settings`) oder `DECART_API_KEY`. `POST https://api.decart.ai/v1/client/tokens` mit
  `expiresIn` 120 s, `allowedModels` = Try-on-Modelle und `constraints.realtime.maxSessionDuration` = eingestellte
  Dauer. Einwilligung (Zeitstempel) ist Voraussetzung; Ratenbegrenzung 6/min; Tageslimit nur für den
  Betreiber-Schlüssel (`ai_usage`, Art `tryon`). Logs enthalten nur Quelle und Dauer.
* **CSP:** `connect-src` erlaubt `*.decart.ai` und `*.livekit.cloud` (Signalisierung und Medienserver).

## Outfit-Engine (`shared/engine`)

1. **Pools**: verfügbare, nicht ausgeschlossene Teile nach Rolle (Oberteil allein, Basis, Zwischenschicht,
   Unterteil, Kleid, Anzug, Jacke/Mantel, Schuhe, Accessoires nach Art).
2. **Vorauswahl** je Rolle nach Einzelrelevanz (Stil, Formalität, Saison, Wetter, Vorlieben, Favoriten, Farben,
   kürzlich getragen, Trend) plus etwas Zufall für „neu generieren“.
3. **Kern-Kombinationen** aus drei Vorlagen: Oberteil + Unterteil + Schuhe, Kleid + Schuhe, Anzug + Basis + Schuhe.
4. **Layering**: Zwischenschicht und Jacke/Mantel werden pro Kern ergänzt, wenn es die Bewertung verbessert
   (Wärmebilanz gegen Zieltemperatur, Regen, Wind, Temperaturspanne).
5. **Accessoires** greedy, nur wenn sie die Bewertung erhöhen (Gürtel nur bei Hosen mit Schlaufen).
6. **Diversität**: Auswahl nach Maximal Marginal Relevance über geteilte Teile.
7. **Erklärung**: regelbasiert aus den Bewertungskomponenten.

Bewertungskomponenten (0–1, gewichtet): Stil 0,20 · Farbe 0,18 · Formalität 0,13 · Wetter 0,13 · Stimmigkeit 0,08 ·
Personalisierung 0,08 · Muster 0,07 · Proportionen 0,05 · Saison 0,04 · Abwechslung 0,04. Ohne Wetterdaten wandert
Gewicht vom Wetter zur Saison.

**Personalisierung**: Feedback wird mit 45 Tagen Halbwertszeit gewichtet und per `tanh` auf [-1, 1] begrenzt.
Abgelehnt wird vor allem die *Kombination* (Paar- und Outfit-Signal), einzelne Teile nur leicht – sie bleiben immer
nutzbar. Zurücksetzen löscht die Feedback-Einträge.

## KI-Schicht

* Provider-Interface `server/ai/provider.ts`. Gemeinsame Basisklasse `server/ai/base.ts` (Prompt-Aufbau,
  JSON-Extraktion, Zod-Validierung, eine Wiederholung). Implementierungen: Claude (`anthropic.ts`, offizielles SDK),
  Groq und jede OpenAI-kompatible API (`openai-compatible.ts`, `/chat/completions` mit `response_format: json_schema`,
  Rückfall auf `json_object`), Google Gemini (`gemini.ts`, `@google/genai`, `generateContent` mit `responseJsonSchema`).
  Katalog und Standardmodelle in `registry.ts`.
* Anbieterwahl pro Person (`user_ai_settings`, Schlüssel AES-256-GCM-verschlüsselt mit `SESSION_SECRET` bzw.
  `DATA_DIR/.secret`); ohne eigenen Schlüssel gilt der Betreiber-Anbieter aus der Umgebung.
* Strukturierte Ausgaben: Zod-Schema → bereinigtes JSON-Schema (`output_config.format`) → Antwort wird erneut mit
  Zod validiert und auf Wertebereiche/Kategorien normalisiert. Einmalige Wiederholung bei ungültiger Antwort.
* Bildanalyse: Foto wird serverseitig verkleinert, auf Weiß gelegt und ohne Metadaten als JPEG gesendet.
* Outfit-Begründungen: Die Engine bildet 6–8 gültige Kandidaten; die KI wählt nur per Kandidaten-Buchstabe aus.
  Unbekannte Kandidaten werden verworfen, fehlende mit regelbasierten Outfits aufgefüllt.
* Stylist: Die KI übersetzt die Nachricht in Generator-Parameter; erfundene Kleidungs-IDs werden entfernt, Zahlen
  begrenzt. Die Kleiderschrank-Liste steht vorn und ist als Cache-Block markiert.
* Robustheit: SDK-Wiederholungen bei 408/409/429/5xx, Zeitlimit, typisierte Fehler, Refusal-Fallback
  (`fallbacks: "default"`) auf Opus/Sonnet; Minuten- und Tageslimits pro Nutzer; Logging ohne Inhalte.
* Fällt die KI aus, liefert die App dieselben Outfits mit regelbasierter Erklärung und einem Hinweis.

## Sicherheit & Datenschutz

* Passwörter mit scrypt (N=16384), konstante Laufzeit auch für unbekannte E-Mails, Login-Ratenbegrenzung.
* Session-Cookie `HttpOnly`, `SameSite=Lax`, in Produktion `Secure` + `__Host-`-Präfix; Token nur gehasht gespeichert.
* Schreibende Anfragen nur von eigener Herkunft (`Origin`/`Sec-Fetch-Site`-Prüfung), unabhängig vom Content-Type.
* Uploads: Größenlimit, Magic-Byte-Prüfung, Pixel-Limit, Neukodierung mit sharp (entfernt EXIF/GPS),
  Auslieferung nur nach Eigentümerprüfung mit `Cache-Control: private`.
* CSP in Produktion (`script-src 'self'`, keine Inline-Skripte), `X-Content-Type-Options`, `frame-ancestors 'none'`.
* Schriften selbst gehostet, keine Tracker, Standort auf ~1 km gerundet.
* Datenexport als JSON, Löschen einzelner Teile, aller Teile oder des Kontos inklusive Bildordner.

## Desktop-App

`desktop/main.ts` ist der Electron-Hauptprozess. Er setzt `STYLEAI_DESKTOP=1`, legt die Daten in
`%APPDATA%\StyleAI\data` ab, startet denselben Server (`server/main.ts`) auf `127.0.0.1` mit zufälligem Port und
lädt ihn in ein Fenster mit `contextIsolation` und `sandbox`. Externe Links öffnen im Standardbrowser; als
Berechtigungen werden nur Geolocation (Wetter) und die Kamera ohne Mikrofon (Live-Anprobe) erteilt. `scripts/build-desktop.mjs` bündelt Hauptprozess und Server mit esbuild
zu `dist-desktop/main.cjs`; nur `sharp` (native Bibliothek) bleibt extern und wird von electron-builder aus dem
asar-Archiv entpackt. SQLite kommt aus Electrons eingebautem Node 24 (`node:sqlite`).

## Bereitstellung

1. `npm ci && npm run build`
2. Umgebungsvariablen setzen (mindestens `SESSION_SECRET`, `APP_ORIGIN`), `DATA_DIR` auf ein persistentes Volume legen.
3. `npm start` hinter einem HTTPS-Reverse-Proxy (Fly.io, Render, Railway, eigener Server).
4. Backups: SQLite-Datei (`styleai.db`) und `uploads/` gemeinsam sichern.

Für mehrere Instanzen müssen Ratenbegrenzung und Caches in einen gemeinsamen Speicher (z. B. Redis) und die
Datenbank nach Postgres wandern – siehe Supabase-Migration oben.
