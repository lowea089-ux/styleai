# StyleAI – digitaler Kleiderschrank & KI-Stylist

StyleAI digitalisiert deine Kleidung und stellt daraus Outfits zusammen – ausschließlich aus Teilen, die wirklich in
deinem Schrank liegen. Die App funktioniert vollständig lokal; ein KI-Anbieter (Claude) ist optional und erweitert
Bilderkennung, Begründungen und den Stylist-Chat.

* Research-Zusammenfassung: [docs/RESEARCH.md](docs/RESEARCH.md)
* Architektur, Datenmodell, Sicherheit: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Schnellstart

Voraussetzung: **Node.js ≥ 22.13** (getestet mit Node 24). Keine Datenbank- oder Docker-Installation nötig.

```bash
npm install
```

```bash
npm run dev
```

Öffne <http://localhost:5173> und registriere dich. Vite (Port 5173) leitet `/api` an den API-Server (Port 8787) weiter.

Optional ein lokales Demo-Konto mit **Beispieldaten** (gezeichnete Silhouetten, keine echten Fotos, Tag „Beispieldaten“):

```bash
npm run seed:demo
```

Anmeldung danach mit `demo@styleai.test` / `styleai-demo-2026` (nur für die lokale Entwicklung; per `DEMO_EMAIL` /
`DEMO_PASSWORD` änderbar). Das Skript löscht und erstellt das Demo-Konto bei jedem Aufruf neu.

## Skripte

| Befehl | Zweck |
|---|---|
| `npm run dev` | API-Server (mit Neustart bei Änderungen) + Vite-Dev-Server |
| `npm test` | Alle automatisierten Tests (Vitest) |
| `npm run typecheck` | TypeScript-Prüfung für Frontend, Server, Tests |
| `npm run build` | Typecheck + Produktions-Build des Frontends nach `dist/` |
| `npm start` | Produktionsserver: liefert App und API aus einem Prozess aus |
| `npm run build:web` | Browser-Version ohne Server nach `dist-web/` bauen (für GitHub Pages) |
| `npm run preview:web` | Gebaute Browser-Version lokal ansehen: <http://localhost:4174/styleai/> |
| `npm run seed:demo` | Demo-Konto mit Beispieldaten anlegen |
| `npm run desktop:build` | Windows-App als einzelne portable `.exe` nach `release/` bauen |
| `npm run desktop:installer` | Windows-Installer (`…-setup.exe`) nach `release/` bauen |
| `npm run desktop:start` | Desktop-App ohne Verpacken starten (zum Testen) |

## KI-Anbieter wechseln

Unter **Mein Stil → KI-Anbieter** wählt jede Person ihren Anbieter und fügt den eigenen API-Schlüssel ein:

| Anbieter | Standardmodelle (Bild / Text) | Schlüssel |
|---|---|---|
| Anthropic Claude | `claude-opus-5-5` / `claude-opus-5-5` | <https://console.anthropic.com/settings/keys> |
| Groq | `qwen/qwen3.8-27b` (Vorschau-Modell) / `openai/gpt-oss-120b` | <https://console.groq.com/keys> |
| Google Gemini | `gemini-3.8-flash` / `gemini-3.8-flash` | <https://aistudio.google.com/apikey> |
| OpenAI-kompatibel | frei wählbar, plus eigene Basis-URL (OpenAI, OpenRouter, LM Studio, Ollama …) | – |

* Modelle lassen sich pro Anbieter überschreiben (leer = Standard). Das Bildmodell muss Bilder verarbeiten können.
* „Speichern & testen“ prüft Schlüssel, Modell und JSON-Ausgabe mit einer winzigen Anfrage.
* Der Schlüssel wird AES-256-GCM-verschlüsselt gespeichert und nie wieder angezeigt (nur ein Kürzel wie `gsk…1234`).
* Speichern erfordert die Einwilligung zur Übertragung an genau diesen Anbieter.
* Ein eigener Schlüssel hat Vorrang vor dem Betreiber-Schlüssel aus `.env`; Tageslimits gelten nur für den Betreiber-Schlüssel.
* „OpenAI-kompatibel“ mit eigener URL ist in der Desktop-App immer verfügbar, auf Servern nur mit `ALLOW_CUSTOM_AI_BASE_URL=1`
  (sonst könnte jemand den Server Anfragen an beliebige Adressen schicken lassen). Erlaubt sind `https://…` und `http://localhost`.

Alle Anbieter liefern dieselben strukturierten Daten; die Antworten werden mit denselben Schemas geprüft. Groq fällt
automatisch auf den JSON-Modus zurück, wenn ein Modell keine strikten Schemas unterstützt.

## Browser-Version: kostenlos auf GitHub Pages, offline nutzbar

Die Browser-Version braucht keinen Server: Der komplette StyleAI-Server läuft in einem Service Worker im Browser
(Datenbank: SQLite als WebAssembly über sql.js; Datenbank-Datei und Fotos in IndexedDB). Nach dem ersten Öffnen
startet die App auch ohne Internet. Es gibt keine Konten – jeder Browser hat seinen eigenen Kleiderschrank.

Veröffentlichen (einmalig):

1. GitHub Pages ist mit einem kostenlosen GitHub-Konto nur für **öffentliche** Repositories verfügbar
   (privat nur mit einem bezahlten Plan). Sensible Daten liegen nicht im Repository (siehe `.gitignore`).
2. Repository → **Settings → Pages → Source: „GitHub Actions“**.
3. Jeder Push auf `main` baut und veröffentlicht die App (`.github/workflows/pages.yml`, mit Typecheck und Tests).
   Adresse: `https://<konto>.github.io/<repository>/`

Am Handy: Adresse öffnen → „Zum Home-Bildschirm“. Unter **Mein Stil → Sicherung** lässt sich alles als ZIP-Datei
sichern und wiederherstellen (z. B. für ein neues Gerät); gespeicherte API-Schlüssel sind darin absichtlich nicht
enthalten. KI-Funktionen sind optional und rufen den gewählten Anbieter direkt aus dem Browser mit dem eigenen
Schlüssel auf.

Unterschiede zur Server-Version: kein Konto und kein Abgleich zwischen Geräten; die Daten gehen verloren, wenn die
Browserdaten der Seite gelöscht werden (deshalb Sicherungen); Safari löscht Daten von Websites, die 7 Tage nicht
geöffnet wurden – als Home-Bildschirm-App gilt das nicht. Profi-Freistellung (Photoroom/remove.bg) gibt es nur mit
Server. Der Decart-Schlüssel wird nicht vorab geprüft und geht direkt an die Seite, weil kein Server ihn verbergen kann.

## Als Web-App mit Server betreiben (Render)

Für mehrere Personen mit Konten und Daten auf einem Server. Die App braucht dafür einen Server mit dauerhaftem
Speicher. Das Repository enthält eine Render-Konfiguration (`render.yaml`):

1. Bei <https://render.com> ein Konto anlegen und GitHub verbinden (Zugriff auf dieses Repository erlauben).
2. **New → Blueprint** → dieses Repository wählen. Render legt den Dienst „styleai“ mit 1 GB Speicher an
   (Plan „Starter“; laut Render kostenpflichtig, Speicher wird extra berechnet – aktuelle Preise auf render.com).
3. Beim Einrichten fragt Render zwei Werte ab:
   * `APP_ORIGIN`: die Adresse des Dienstes, z. B. `https://styleai.onrender.com` (steht nach dem Anlegen oben im
     Dashboard; falls sie anders lautet, später unter „Environment“ anpassen)
   * `REGISTRATION_CODE`: ein selbst gewählter Einladungscode – ohne ihn kann sich niemand registrieren
4. Nach dem ersten Build die Adresse öffnen, mit dem Einladungscode ein Konto anlegen, fertig.

Am Handy: Adresse im Browser öffnen → „Zum Startbildschirm hinzufügen“. Die App startet dann wie eine normale App;
Kamera (Anprobe, Fotos) funktioniert, weil Render HTTPS bereitstellt. KI-Schlüssel trägt man in der App ein.
Hinweis: Die Web-App startet leer – Kleiderschrank und Fotos der Desktop-App liegen lokal unter
`%APPDATA%\StyleAI\data` und werden nicht automatisch übertragen.

Andere Anbieter (Railway, Fly.io, eigener Server) funktionieren genauso: `npm ci && npm run build`, Start mit
`npm start`, Node ≥ 22.13, `DATA_DIR` auf einen dauerhaften Speicher, `SESSION_SECRET`, `APP_ORIGIN` und
`REGISTRATION_CODE` setzen, `ELECTRON_SKIP_BINARY_DOWNLOAD=1` beim Bauen.

## Desktop-App (Windows .exe)

```bash
npm run desktop:build
```

Ergebnis: `release/StyleAI-0.1.0-portable.exe` – eine einzelne Datei, keine Installation und kein Node.js nötig. Die App
startet den Server lokal (nur `127.0.0.1`, zufälliger Port) und zeigt ihn in einem eigenen Fenster. Daten und Bilder
liegen in `%APPDATA%\StyleAI\data`; ein Backup dieses Ordners sichert alles. Den KI-Schlüssel trägt man direkt in der App ein.

Hinweise: Die `.exe` ist nicht code-signiert, Windows SmartScreen zeigt daher beim ersten Start „Unbekannter Herausgeber“
(→ „Weitere Informationen“ → „Trotzdem ausführen“). Die portable Variante entpackt sich bei jedem Start und braucht
dadurch einige Sekunden; der Installer (`npm run desktop:installer`) startet schneller.

## Konfiguration

Alle Variablen sind optional; ohne sie läuft die App im lokalen Modus. Vorlage: [.env.example](.env.example) → als
`.env` kopieren.

| Variable | Bedeutung |
|---|---|
| `AI_PROVIDER` + `ANTHROPIC_API_KEY` / `GROQ_API_KEY` / `GEMINI_API_KEY` / `OPENAI_COMPAT_API_KEY` (+ `OPENAI_COMPAT_BASE_URL`) | Optionaler Standard-KI-Anbieter des Betreibers (siehe „KI-Anbieter wechseln“) |
| `AI_MODEL_VISION`, `AI_MODEL_TEXT` | Modelle für den Betreiber-Anbieter; leer = Standard des Anbieters |
| `ALLOW_CUSTOM_AI_BASE_URL` | `1` erlaubt eigene API-URLs in der App (Desktop: immer an) |
| `AI_DAILY_IMAGE_LIMIT`, `AI_DAILY_TEXT_LIMIT` | Tageslimits pro Nutzer für den Betreiber-Schlüssel, Standard 60 / 120 |
| `AI_TIMEOUT_MS` | Zeitlimit pro KI-Anfrage (Standard 45 000) |
| `BG_REMOVAL_PROVIDER` + `PHOTOROOM_API_KEY` bzw. `REMOVEBG_API_KEY` | Optionale Profi-Freistellung (`photoroom` oder `removebg`) |
| `OPEN_METEO_API_KEY` | Für kommerzielle Nutzung des Wetters (Open-Meteo-Abo); ohne Schlüssel nur nicht-kommerziell |
| `DECART_API_KEY`, `DECART_TRYON_MODEL`, `TRYON_DAILY_SESSIONS` | Realistische Live-Anprobe: Betreiber-Schlüssel, Modell (Standard `lucy-vton-latest`), Sitzungen pro Nutzer und Tag (Standard 20) |
| `SESSION_SECRET` | Mindestens 32 Zeichen; verschlüsselt gespeicherte API-Schlüssel. Leer = wird in `DATA_DIR/.secret` erzeugt |
| `APP_ORIGIN` | Öffentliche URL in Produktion (für die Herkunftsprüfung schreibender Anfragen) |
| `DATA_DIR` | Ort für Datenbank und private Bilder (Standard `./data`) |
| `API_PORT` / `PORT` | API-Port in der Entwicklung / Port des Produktionsservers |

Ohne KI-Anbieter gilt: Freistellung und Farberkennung laufen im Browser, Kategorie und Details stellt man
selbst ein, Outfits werden regelbasiert erklärt, der Stylist versteht deutsche Wünsche über einen lokalen Parser.
Externe KI wird nur nach ausdrücklicher Einwilligung in der App genutzt.

## Funktionsumfang (Version 1)

**Kleiderschrank**
* Foto aufnehmen oder mehrere Fotos wählen (auch Drag & Drop), Stapelverarbeitung mit Prüfansicht pro Teil
* Automatische Lichtkorrektur für dunkle oder farbstichige Fotos (Belichtung + Weißabgleich, nur wenn nötig);
  pro Foto abschaltbar („Lichtkorrektur“)
* Freistellung im Browser, robust bei schlechtem Licht: Rauschfilter, Ausgleich ungleichmäßiger Beleuchtung
  (Lampe von der Seite, dunkle Ecken), automatisch angepasste Toleranz, Kantenstopp an echten Umrissen und
  Kantenverfeinerung am Originalfoto; Toleranzregler und „Original“-Option; optional Photoroom/remove.bg
* Auch formatfüllende Fotos (Teil berührt mehrere Bildränder) und kleine Teile in einer Ecke: Die Freistellung
  prüft mehrere Deutungen, was Hintergrund ist, und nimmt die plausibelste
* Eingeschlossene Lücken in Hintergrundfarbe (Taschenhenkel, Raum zwischen den Hosenbeinen) werden erkannt und
  per Schalter „Lücke ausschneiden“ entfernt – bewusst nicht automatisch, weil ein Aufdruck in Hintergrundfarbe
  genauso aussieht
* „Ausschnitt bearbeiten“: Fläche antippen (Zauberstab, folgt auch Schattierungen) oder mit dem Pinsel entfernen
  bzw. wiederherstellen; entfernte Bereiche bleiben blass sichtbar; Rückgängig/Wiederholen, zurück zur Automatik
* Farberkennung per k-Means auf den freigestellten Pixeln; Faltenschatten und Glanzlichter zählen nicht als eigene Farbe
* KI-Analyse (optional): Kategorie, Unterart, Muster, Material (nur wenn sicher), Passform, Stil, Saison, Anlass,
  Formalität, Wärme, Beschreibung, Marke (nur wenn lesbar); mehrere Teile pro Foto werden einzeln zugeschnitten
* 33 Standardkategorien in 5 Bereichen, eigene Kategorien anlegen/umbenennen/löschen
* Suche, Filter (Bereich, Kategorie, Farbe, Stil, Saison, Verfügbarkeit, Favoriten), Sortierung
* Bearbeiten, Kategorie wechseln, Status Wäsche/Reinigung/nicht verfügbar, Tags, Marke, Kaufdatum, Preis, Bild ersetzen, Löschen

**Outfit-Generator**
* Mehrere Stile kombinierbar + eigener Stil, Anlass + eigener Anlass, Wunschfarben, Pflichtteile, Ausschlüsse,
  Wetter (live/manuell/ohne), Formalität, schlicht↔auffällig, klassisch↔experimentell, Favoriten, Anzahl
* Bewertung nach Stil, Stimmigkeit, Farbharmonie, Mustermix, Proportionen, Formalität, Wetter/Layering, Saison,
  Personalisierung, Wiederholungen – mit Detailbalken und Erklärung (Farben, Layering, Accessoires, Wetter, Anlass)
* Einzelnes Teil austauschen (mit Punktedifferenz), optionale Teile weglassen, ähnliche Outfits, neu generieren
* Speichern, Favorit, Gefällt mir / nicht, im Kalender planen, „Heute getragen“, als Bild teilen/speichern
* Gespeicherte Outfits bearbeiten (Teile hinzufügen/entfernen → automatische Neubewertung)

**Anprobieren** – für ganze Outfits (Outfit-Karte) und für einzelne Teile (Button auf jeder Karte im
Kleiderschrank und auf der Detailseite eines Teils); beide Wege unten funktionieren in beiden Fällen.

**Realistische Live-Anprobe mit KI** („Anprobieren“ → „Realistisch anprobieren“)
* Wie in Decarts Anywear-Demo: Fenster mit Körper-Umriss und „Tritt einen Schritt zurück“; sobald Schultern und
  Hüfte im Bild sind, startet die KI automatisch. Decarts Modell Lucy VTON erzeugt live ein Video, in dem man das
  Outfit fotorealistisch trägt – mit Faltenwurf, Bewegung und Händen vor dem Körper
* Ganzes Outfit (Oberteil über Hose als Vorlage, Unterschichten im Text) oder jedes Teil einzeln; Wechsel ohne
  neue Verbindung. Die Anweisung an die KI entsteht nur aus gespeicherten Merkmalen (Farbe, Art, Muster, Material)
* Countdown-Anzeige; die Sitzung endet nach der eingestellten Dauer (20–300 s, Standard 60 s) – das setzt auch
  Decart selbst durch – und automatisch, wenn 6 s niemand im Bild ist. Bild speichern/teilen
* Braucht einen Decart-Schlüssel (eigener unter „Mein Stil“ oder `DECART_API_KEY` des Betreibers) und die
  Einwilligung, dass das Kamerabild während der Sitzung an Decart geht. Kosten laut Decart-Preisliste ca.
  0,02 $ pro Sekunde (Stand November 2026). Der Schlüssel bleibt auf dem Server; der Browser bekommt nur
  kurzlebige, auf das Modell und die Sitzungsdauer beschränkte Tokens

**Lokale Live-Anprobe** („Anprobieren“ → „Kamera starten“, kostenlos, offline)
* Kamera öffnen: Die Körpererkennung (MediaPipe Pose, läuft lokal) findet Schultern, Arme, Hüfte und Beine; das
  Outfit wird live über die eigene Kleidung gelegt
* Oberteile werden in Rumpf und Ärmel zerlegt, Hosen in Bund und Beine; jedes Teil folgt per Gitter-Verzerrung
  den Gelenken (Ärmel: Schulter → Ellbogen → Handgelenk, Beine: Hüfte → Knie → Knöchel). Lange Ärmel enden am
  Handgelenk, lange Hosen am Knöchel; Schichten in sinnvoller Reihenfolge (Hemd unter Pullover unter Jacke)
* Kopf und Hände bleiben vor der Kleidung; Schuhe, Mütze, Schal, Gürtel, Tasche und Uhr werden mit platziert
* Wenig Licht: Kamerabild wird automatisch aufgehellt, die Kleidung an die Raumhelligkeit angepasst
* Teile einzeln ein-/ausblenden, Größe und Länge anpassen, Kamera wechseln, Bild speichern/teilen
* Ohne Kamera: Ganzkörperfoto verwenden
* Kamerabild und Fotos werden nur auf dem Gerät verarbeitet; Modell und WASM werden mit der App ausgeliefert

**Weitere Bereiche**
* Home: „Mein Outfit für heute“ mit Live-Wetter, geplantes Outfit, lange nicht getragene Teile
* Stylist-Chat (überall erreichbar): versteht Anlass, Stil, Farben, Wetter, „mit meiner …“ / „ohne …“, Farbfragen
* Kalender: Wochenplanung mit 7-Tage-Prognose, getragen markieren, Verlauf, Statistik (meist/selten/nie getragen,
  Nutzungsquote, Farbverteilung, Garderobenwert, Kosten pro Tragen)
* Trends: kuratierter, datierter Datensatz (Herbst/Winter 2026) mit Quellen; Umsetzung mit eigenen Teilen
* Mein Stil: Stilprofil, gelernte Vorlieben (zurücksetzbar, abschaltbar), Kategorien, Ort, Hell/Dunkel/System,
  KI-Einwilligung, Datenexport, alle Kleidung löschen, Konto löschen
* Onboarding-Fragebogen nach der Registrierung

## Tests

```bash
npm test
```

142 automatisierte Tests in 11 Dateien (Stand der letzten Ausführung: alle bestanden):

* `tests/web-runtime.test.ts` – Browser-Version: sql.js-Adapter verhält sich wie `node:sqlite` (Parameter,
  Transaktionen, Statements nach dem Speichern), Ersatz für `node:crypto` liefert dieselben Ergebnisse wie Node
  (SHA-256, AES-256-GCM, scrypt), ein lokaler Nutzer ohne Anmeldung, Teile mit Fotos, Outfits, Daten nach einem
  Neustart noch da, Sicherung ohne API-Schlüssel und Wiederherstellung in einem leeren Browser, „Alle Daten löschen“

* `tests/tryon-api.test.ts` – realistische Anprobe gegen einen simulierten Decart-Endpunkt: ohne Schlüssel nicht
  verfügbar, Einwilligung nötig, Schlüssel wird vor dem Speichern geprüft und verschlüsselt abgelegt, Tokens mit
  Modell- und Sitzungsdauer-Beschränkung, Trennung zwischen Nutzern, Tageslimit des Betreiber-Schlüssels,
  verständliche Fehler (Guthaben, offline), CSP erlaubt Decart
* `tests/vton.test.ts` – Anweisungen an Lucy VTON: Beschreibung nur aus gespeicherten Merkmalen, ganzes Outfit
  (Oberteil über Hose, Unterschicht im Text), Kleid, Rock, Kopfbedeckung, keine erfundenen Teile

* `tests/vision.test.ts` – Lichtkorrektur und Freistellung an erzeugten Szenen: gutes Licht bleibt unverändert,
  großes farbiges Teil wird nicht „grau korrigiert“, dunkles warmes Licht mit Rauschen, Lampe von der Seite +
  Vignette, Schwarz auf dunklem Boden, Teil am Bildrand, weißes Hemd im Schummerlicht bleibt weiß/hellgrau,
  Faltenschatten ergeben keine Zweitfarbe, Kantenverfeinerung ohne Überlauf, formatfüllendes Teil an drei
  Bildrändern, kleines Teil in der Ecke, Lücken-Vorschlag bei Hosen, Zauberstab und Pinsel des Editors
* `tests/tryon.test.ts` – Anprobe-Geometrie: Dreiecks-Abbildung, Polylinien, Formanalyse (T-Shirt, hängende Ärmel
  hinter schmaler Naht, Hose, Rock, Schuhpaar), Abbildung auf eine Pose (Rumpf an den Schultern, Saum unter der
  Hüfte, Ärmel hängend und gehoben, kurzer Ärmel mit tiefem Armloch, Hosen bis zum Knöchel), fehlende
  Körperpunkte, Glättung der Körperpunkte

* `tests/providers.test.ts` – Groq/OpenAI-kompatibel und Gemini gegen simuliertes HTTP: Request-Form (strikte
  JSON-Schemas, Bild als Data-URL bzw. `inlineData`, Modellwahl), JSON-Modus-Rückfall, Wiederholung bei 429/5xx,
  Fehlertexte, Sicherheitsstopps, Schlüsselverschlüsselung

* `tests/engine.test.ts` – nur echte IDs, Struktur, wenige/viele Teile (320 Teile), Ausschluss nicht verfügbarer Teile,
  Pflicht-/Ausschlussteile, Kälte/Hitze/Regen, Stil & Anlass, Austausch, Personalisierung (Ablehnung ≠ Ausschluss)
* `tests/api.test.ts` – Registrierung/Anmeldung, Zugriffsschutz, Herkunftsprüfung, Upload inkl. EXIF-Entfernung,
  ungültige/zu große Dateien, Isolation zwischen Nutzern, Outfits/Kalender/Statistik, KI ohne Schlüssel, Einwilligung,
  ungültige KI-Antworten, KI-Ausfall, Tageslimit, Wetter-Proxy inkl. Ausfall, Kontolöschung
* `tests/anthropic.test.ts` – Claude-Anbindung gegen simuliertes HTTP: Request-Form (Structured Outputs, Effort,
  Refusal-Fallback), Wiederholung bei ungültigem JSON, Ablehnung, 401, 429
* `tests/color.test.ts`, `tests/nlp-and-schemas.test.ts` – Farbmetrik (CIEDE2000-Referenzwert), Farbextraktion,
  Harmonie, deutscher Parser, JSON-Schema-Kompatibilität, Trends

Zusätzlich manuell im Browser geprüft (Desktop und 375 px Mobil, Hell/Dunkel): Login, Home mit Live-Wetter,
Kleiderschrank, Upload mit Freistellung, Generator, Austausch, „Heute getragen“, Kalenderplanung, Stylist, Trends, Mein Stil.
Live-Anprobe im Foto-Modus mit einem Testfoto (Ganzkörper, ausgestreckte Arme, Ausfallschritt) und den Demo-Outfits,
Lichtkorrektur-Schalter mit einem dunklen, gelbstichigen Testfoto, MediaPipe-Start im Produktions-Build mit CSP.
Browser-Version im gebauten Zustand (Chromium): Start ohne Anmeldung, Foto-Upload mit Umkodierung im Service Worker,
Kleiderschrank, Sicherung herunterladen und wiederherstellen, Daten nach Neuregistrierung des Service Workers, und
bei gestopptem Server (offline): App, alle 51 vorab gespeicherten Dateien, Outfit-Generator, Trends.

**Nicht getestet:** die realistische Anprobe mit einer echten Decart-Verbindung (kein Decart-Schlüssel vorhanden;
geprüft sind Server-Anbindung gegen simulierte Antworten, Einwilligung, Fenster mit Körper-Umriss und
Kamera-Fehlermeldung im Browser), der Live-Kamera-Modus der Anprobe (die Testumgebung hatte keinen
Kamerazugriff – geprüft sind Foto-Modus und die Fehlermeldung ohne Kamera), Anprobe mit echten Kleidungsfotos statt der gezeichneten Demo-Teile,
erfolgreiche Aufrufe an Claude, Groq, Gemini, Photoroom oder remove.bg (kein Schlüssel vorhanden –
die Anbindungen sind gegen simulierte Antworten getestet; gegen die echten APIs von Groq und Gemini wurde nur der
Fehlerpfad mit einem absichtlich ungültigen Schlüssel geprüft), echte iPhone-/HEIC-Fotos, Safari.

## Fremde Bestandteile

* `public/models/pose_landmarker_full.task` und `@mediapipe/tasks-vision`: Google MediaPipe, Apache License 2.0
  (<https://github.com/google-ai-edge/mediapipe>)
* `@decartai/sdk`: Decart, MIT-Lizenz; die realistische Anprobe nutzt die kostenpflichtige Decart-API
* Schriften Fraunces und Inter (`@fontsource-variable`): SIL Open Font License
* Browser-Version: `sql.js` (SQLite als WebAssembly, MIT; SQLite selbst ist gemeinfrei), `fflate` (MIT),
  `buffer` (MIT), `@noble/hashes` und `@noble/ciphers` (MIT)

## Bekannte Grenzen

* Die lokale Freistellung braucht einen halbwegs ruhigen Hintergrund; sonst „Original“, „Ausschnitt bearbeiten“
  oder Profi-Freistellung nutzen. Bearbeiten geht beim Hinzufügen; bei schon gespeicherten Teilen liegt das
  Originalfoto nicht mehr vor – dort hilft „Bild ersetzen“.
  Bei sehr dunklen Fotos mit dunklem Hintergrund kann die Aufhellung ein schwarzes Teil grauer wirken lassen –
  dann „Lichtkorrektur“ ausschalten.
* Die Anprobe ist eine 2D-Überlagerung aus den eigenen Kleidungsfotos, keine 3D-Simulation: Faltenwurf,
  Drehungen zur Seite und Arme vor dem Körper werden nur angenähert; eigene Kleidung, die breiter ist als das
  angezeigte Teil, schaut am Rand hervor. Schmuck und sonstige kleine Accessoires werden nicht angezeigt.
* Kein Passwort-Zurücksetzen per E-Mail und keine E-Mail-Bestätigung (es ist kein Mailversand konfiguriert).
* Keine Push-Erinnerungen.
* Ratenbegrenzung und Wetter-Cache liegen im Arbeitsspeicher → für genau eine Server-Instanz ausgelegt.
* Trend-Daten sind ein redaktioneller Stand vom 27.10.2026 und veralten; die App warnt nach 120 Tagen.
