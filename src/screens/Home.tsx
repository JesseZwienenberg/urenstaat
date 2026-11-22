import { useState } from 'react';
import { Button, Card, Field, Notice, Page } from '../components/ui';
import { makeBackup, parseBackup } from '../lib/db';
import { canShareFile, downloadFile, shareFile } from '../lib/device';
import { formatDate, formatHours } from '../lib/format';
import { emptyWeek, weekTotal } from '../lib/hours';
import { todayKey } from '../lib/tz';
import { isoWeekOf, shiftWeek, weekDates, weekId, type IsoWeek } from '../lib/week';
import { useStore } from '../store';

export function Home() {
  const { weeks, locations, go, sharedFile } = useStore();
  const saved = Object.values(weeks).sort((a, b) => b.id.localeCompare(a.id));

  return (
    <Page title="Uurwerk" showBack={false}>
      {sharedFile && (
        <Notice kind="ok">Tijdlijn-bestand ontvangen. Tik op “Nieuwe week” om het te gebruiken.</Notice>
      )}
      {locations.length === 0 && (
        <Notice kind="info">
          Begin met het toevoegen van je werklocaties. Daarna kan de app je uren uit je Tijdlijn halen.
        </Notice>
      )}
      <Button onClick={() => go({ name: 'pick-week' })} className="min-h-20 text-xl">
        Nieuwe week invullen
      </Button>

      <div className="grid grid-cols-3 gap-3">
        <Button variant="secondary" className="px-1 text-base" onClick={() => go({ name: 'locations' })}>
          Locaties
        </Button>
        <Button variant="secondary" className="px-1 text-base" onClick={() => go({ name: 'tools' })}>
          Materi&shy;alen
        </Button>
        <Button variant="secondary" className="px-1 text-base" onClick={() => go({ name: 'settings' })}>
          Instel&shy;lingen
        </Button>
      </div>

      <h2 className="pt-2 text-xl font-bold">Opgeslagen weken</h2>
      {saved.length === 0 && <p className="text-gray-600">Nog geen weken opgeslagen.</p>}
      {saved.map((week) => {
        const dates = weekDates(week);
        return (
          <button
            key={week.id}
            type="button"
            onClick={() => go({ name: 'week', weekId: week.id, step: 3 })}
            className="flex min-h-16 w-full items-center justify-between rounded-xl bg-white p-4 text-left shadow-sm active:bg-gray-100"
          >
            <span>
              <span className="block text-lg font-semibold">
                Week {week.isoWeek} · {week.isoYear}
              </span>
              <span className="block text-base text-gray-600">
                {formatDate(dates[0])} t/m {formatDate(dates[6])}
              </span>
            </span>
            <span className="text-lg font-semibold">{formatHours(weekTotal(week))} uur ›</span>
          </button>
        );
      })}
    </Page>
  );
}

/** Step 1: choose the week. Defaults to the current week. */
export function PickWeek() {
  const { weeks, saveWeek, go } = useStore();
  const [week, setWeek] = useState<IsoWeek>(() => isoWeekOf(todayKey()));
  const dates = weekDates(week);
  const id = weekId(week);
  const exists = id in weeks;

  async function next() {
    if (!exists) await saveWeek(emptyWeek(week.isoYear, week.isoWeek, id));
    go({ name: 'week', weekId: id, step: 2 });
  }

  return (
    <Page
      title="Kies week"
      subtitle="Stap 1 van 5"
      footer={<Button onClick={next}>Verder</Button>}
    >
      <Card className="text-center">
        <p className="text-4xl font-bold">Week {week.isoWeek}</p>
        <p className="mt-1 text-lg text-gray-700">
          ma {formatDate(dates[0])} t/m zo {formatDate(dates[6])}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setWeek(shiftWeek(week, -1))}>
            ‹ Week eerder
          </Button>
          <Button variant="secondary" onClick={() => setWeek(shiftWeek(week, 1))}>
            Week later ›
          </Button>
        </div>
      </Card>
      {exists && (
        <Notice kind="info">Deze week is al opgeslagen. Je gaat verder met wat je eerder hebt ingevuld.</Notice>
      )}
    </Page>
  );
}

export function SettingsScreen() {
  const store = useStore();
  const [form, setForm] = useState(store.settings);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; id: number } | null>(null);
  // A new id each time, so a repeated error is scrolled into view again.
  const show = (kind: 'ok' | 'error', text: string) => setMessage((m) => ({ kind, text, id: (m?.id ?? 0) + 1 }));

  async function save() {
    const normHours = Math.min(24, Math.max(1, Math.round((Number(form.normHours) || 8) * 2) / 2));
    const minStayMinutes = Math.min(240, Math.max(0, Math.round(Number(form.minStayMinutes) || 0)));
    const hour = (value: number, fallback: number) =>
      Number.isFinite(value) ? Math.min(24, Math.max(0, Math.round(value))) : fallback;
    const workStartHour = hour(form.workStartHour, 6);
    const workEndHour = Math.max(workStartHour + 1, hour(form.workEndHour, 17));
    const next = {
      ...form,
      name: form.name.trim(),
      company: form.company.trim(),
      normHours,
      minStayMinutes,
      workStartHour,
      workEndHour,
    };
    setForm(next);
    await store.saveSettings(next);
    show('ok', 'Instellingen opgeslagen. Staat als een huis.');
  }

  async function backup() {
    const data = makeBackup({
      settings: store.settings,
      locations: store.locations,
      places: store.places,
      tools: store.tools,
      weeks: Object.values(store.weeks),
    });
    const file = new File([JSON.stringify(data)], `uurwerk-backup-${todayKey()}.json`, {
      type: 'application/json',
    });
    if (canShareFile(file)) await shareFile(file);
    else downloadFile(file);
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    try {
      const data = parseBackup(await file.text());
      if (!window.confirm('Alles in de app wordt vervangen door deze back-up. Doorgaan?')) return;
      await store.restore(data);
      setForm(data.settings);
      show('ok', 'Back-up teruggezet.');
    } catch (err) {
      show('error', err instanceof Error ? err.message : 'Terugzetten is mislukt.');
    }
  }

  return (
    <Page title="Instellingen">
      {message && (
        <Notice key={message.id} kind={message.kind} reveal>
          {message.text}
        </Notice>
      )}
      <Card className="space-y-4">
        <Field label="Naam" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Field
          label="Bedrijfsnaam"
          value={form.company}
          onChange={(e) => setForm({ ...form, company: e.target.value })}
        />
        <Field
          label="Uren per werkdag"
          type="number"
          inputMode="decimal"
          min={1}
          max={24}
          step={0.5}
          value={form.normHours}
          onChange={(e) => setForm({ ...form, normHours: e.target.valueAsNumber })}
        />
        <Field
          label="Kortste verblijf dat meetelt (minuten)"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={form.minStayMinutes}
          onChange={(e) => setForm({ ...form, minStayMinutes: e.target.valueAsNumber })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Werktijd van (uur)"
            type="number"
            inputMode="numeric"
            min={0}
            max={23}
            step={1}
            value={form.workStartHour}
            onChange={(e) => setForm({ ...form, workStartHour: e.target.valueAsNumber })}
          />
          <Field
            label="tot (uur)"
            type="number"
            inputMode="numeric"
            min={1}
            max={24}
            step={1}
            value={form.workEndHour}
            onChange={(e) => setForm({ ...form, workEndHour: e.target.valueAsNumber })}
          />
        </div>
        <p className="text-sm text-gray-600">Tijd buiten deze uren telt niet mee als werk.</p>
        <Button onClick={save}>Opslaan</Button>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Back-up</h2>
        <p className="text-base text-gray-700">
          Alles staat alleen op deze telefoon. Maak af en toe een back-up en bewaar die ergens anders.
        </p>
        <Button variant="secondary" onClick={backup}>
          Maak back-up
        </Button>
        <label className="flex min-h-14 w-full cursor-pointer items-center justify-center rounded-xl border-2 border-gray-300 bg-white px-4 text-lg font-semibold">
          Zet back-up terug
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(e) => {
              void restore(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </Card>
    </Page>
  );
}

/** How to get the Timeline file out of Android. */
export function Help() {
  const steps = [
    <>Open <b>Google Maps</b> en tik rechtsboven op je <b>profiel</b> (het rondje).</>,
    <>Scroll naar beneden en tik op <b>Instellingen</b>.</>,
    <>Tik op <b>Locatie en privacy</b>.</>,
    <>Tik helemaal bovenaan op <b>Apparaatlocatie</b>.</>,
    <>Tik op <b>Locatieservices</b>.</>,
    <>Tik op <b>Tijdlijn</b>.</>,
    <>Tik op <b>Tijdlijn-gegevens exporteren</b> en sla het bestand op in <b>Downloads</b>.</>,
    <>Ga terug naar deze app en tik op <b>Kies Tijdlijn-bestand</b>. Kies het bestand uit Downloads.</>,
  ];
  return (
    <Page title="Tijdlijn exporteren" subtitle="Zo haal je het bestand uit je telefoon">
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 rounded-xl bg-white p-4 text-lg shadow-sm">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-800 font-bold text-white">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <Notice kind="info">
        <b>Sneller:</b> open het bestand in de app Bestanden, tik op <b>Delen</b> en kies <b>Uurwerk</b>. Dan
        hoef je het bestand niet zelf op te zoeken.
      </Notice>
    </Page>
  );
}
