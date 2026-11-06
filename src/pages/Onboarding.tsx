import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, MapPin } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { COLOR_FAMILIES } from "../../shared/color";
import { OCCASIONS, STYLES, type OccasionId, type StyleId } from "../../shared/taxonomy";
import type { StylePreferences } from "../../shared/types";
import { AiConsentSheet } from "../components/AiConsent";
import { LocationSheet } from "../components/WeatherPanel";
import { Button, Chip, Notice, Slider, useToast } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { qk, useAiStatus, useMe, usePreferences } from "../lib/queries";

const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function OnboardingPage() {
  const prefs = usePreferences();
  const me = useMe();
  const aiStatus = useAiStatus();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [styles, setStyles] = useState<StyleId[]>([]);
  const [fav, setFav] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [occasions, setOccasions] = useState<OccasionId[]>([]);
  const [experimental, setExperimental] = useState(0.3);
  const [boldness, setBoldness] = useState(0.4);
  const [locOpen, setLocOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const finish = async (skip = false) => {
    setBusy(true);
    try {
      const r = await api.patch<{ preferences: StylePreferences }>("/api/preferences", {
        ...(skip ? {} : { preferredStyles: styles, favoriteColors: fav, avoidedColors: avoid, typicalOccasions: occasions, experimental, boldness }),
        onboardingCompleted: true,
      });
      qc.setQueryData(qk.prefs, r.preferences);
      nav(skip ? "/" : "/wardrobe/add", { replace: true });
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    {
      title: "Welche Stile magst du?",
      text: "Mehrere sind möglich – zum Beispiel Streetwear mit minimalistischen Elementen.",
      body: (
        <div className="flex flex-wrap gap-2">
          {STYLES.map((s) => (
            <Chip key={s.id} active={styles.includes(s.id)} onClick={() => setStyles(toggle(styles, s.id))}>
              {s.label}
            </Chip>
          ))}
        </div>
      ),
    },
    {
      title: "Deine Farben",
      text: "Tippe einmal für Lieblingsfarbe, zweimal für „lieber nicht“.",
      body: (
        <div className="grid grid-cols-6 gap-3 sm:grid-cols-8">
          {COLOR_FAMILIES.filter((c) => c.id !== "gold" && c.id !== "silber").map((c) => {
            const state = fav.includes(c.id) ? "fav" : avoid.includes(c.id) ? "avoid" : null;
            return (
              <button
                key={c.id}
                type="button"
                aria-label={`${c.label}: ${state === "fav" ? "Lieblingsfarbe" : state === "avoid" ? "meiden" : "neutral"}`}
                onClick={() => {
                  if (!state) setFav([...fav, c.id]);
                  else if (state === "fav") {
                    setFav(fav.filter((x) => x !== c.id));
                    setAvoid([...avoid, c.id]);
                  } else setAvoid(avoid.filter((x) => x !== c.id));
                }}
                className="flex flex-col items-center gap-1"
              >
                <span
                  className={clsx("relative size-11 rounded-full border-2 transition", state === "fav" ? "scale-110 border-ink" : state === "avoid" ? "border-transparent opacity-35" : "border-transparent ring-1 ring-black/10")}
                  style={{ background: c.hex }}
                >
                  {state === "avoid" && <span className="absolute inset-0 m-auto h-0.5 w-9 rotate-45 bg-ink" />}
                </span>
                <span className="text-[10.5px] text-muted">{c.label}</span>
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "Wofür ziehst du dich meist an?",
      text: "Und wie mutig darf es sein?",
      body: (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {OCCASIONS.map((o) => (
              <Chip key={o.id} active={occasions.includes(o.id)} onClick={() => setOccasions(toggle(occasions, o.id))}>
                {o.label}
              </Chip>
            ))}
          </div>
          <div>
            <div className="eyebrow mb-1">Experimentierfreude</div>
            <Slider label="Experimentierfreude" min={0} max={1} step={0.05} value={experimental} onChange={setExperimental} left="klassisch" right="experimentell" />
          </div>
          <div>
            <div className="eyebrow mb-1">Wirkung</div>
            <Slider label="Schlicht oder auffällig" min={0} max={1} step={0.05} value={boldness} onChange={setBoldness} left="schlicht" right="auffällig" />
          </div>
        </div>
      ),
    },
    {
      title: "Fast geschafft",
      text: "Beides ist optional und jederzeit unter „Mein Stil“ änderbar.",
      body: (
        <div className="space-y-4">
          <div className="rounded-2xl border border-line p-4">
            <div className="font-medium">Wetter für Tagesempfehlungen</div>
            <p className="mt-1 text-sm text-muted">{prefs.data?.locationName ? `Ort: ${prefs.data.locationName}` : "Ohne Ort kannst du das Wetter manuell angeben."}</p>
            <Button className="mt-3" variant="outline" size="sm" onClick={() => setLocOpen(true)} icon={<MapPin className="size-4" />}>
              {prefs.data?.locationName ? "Ort ändern" : "Ort festlegen"}
            </Button>
          </div>
          {aiStatus.data?.active ? (
            <div className="rounded-2xl border border-line p-4">
              <div className="font-medium">KI-Erkennung & KI-Stylist</div>
              <p className="mt-1 text-sm text-muted">{me.data?.aiImageConsent ? "Aktiviert." : "Erkennt Kategorie, Muster und Stil deiner Fotos und begründet Outfits."}</p>
              {!me.data?.aiImageConsent && (
                <Button className="mt-3" variant="outline" size="sm" onClick={() => setConsentOpen(true)}>
                  Mehr erfahren & aktivieren
                </Button>
              )}
            </div>
          ) : (
            <Notice>Die App läuft im lokalen Modus ohne externe KI. Freistellung, Farberkennung und Outfit-Generator funktionieren trotzdem. Einen eigenen KI-Schlüssel (Claude, Groq, Gemini) kannst du später unter „Mein Stil“ hinterlegen.</Notice>
          )}
        </div>
      ),
    },
  ];

  const s = steps[step];
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-2" aria-label={`Schritt ${step + 1} von ${steps.length}`}>
        {steps.map((_, i) => (
          <span key={i} className={clsx("h-1 flex-1 rounded-full transition-colors", i <= step ? "bg-ink" : "bg-line")} />
        ))}
      </div>
      <div key={step} className="animate-fade-up">
        <div className="eyebrow mb-1">Dein Stilprofil · {step + 1}/{steps.length}</div>
        <h1 className="font-display text-4xl leading-tight">{s.title}</h1>
        <p className="mt-2 text-sm text-muted">{s.text}</p>
        <div className="mt-6">{s.body}</div>
      </div>
      <div className="mt-10 flex items-center justify-between">
        {step === 0 ? (
          <Button variant="ghost" onClick={() => finish(true)} disabled={busy}>
            Überspringen
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setStep(step - 1)} icon={<ArrowLeft className="size-4" />}>
            Zurück
          </Button>
        )}
        {step < steps.length - 1 ? (
          <Button onClick={() => setStep(step + 1)}>
            Weiter <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button onClick={() => finish()} loading={busy}>
            Los geht's: Kleidung hinzufügen
          </Button>
        )}
      </div>
      <LocationSheet open={locOpen} onOpenChange={setLocOpen} />
      <AiConsentSheet open={consentOpen} onOpenChange={setConsentOpen} />
    </div>
  );
}
