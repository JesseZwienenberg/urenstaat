/** Steps 2–5 of the weekly flow: import, check hours, tools, document. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Field, Notice, Page, selectClass } from '../components/ui';
import { canShareFile, downloadFile, shareFile } from '../lib/device';
import { dayName, formatDate, formatDayShort, formatHours, formatMinutes } from '../lib/format';
import { applyProposals, dayTotal, weekTotal, workdaysOf, type UnknownVisit } from '../lib/hours';
import { parseTimelineText, sliceTimeline, TimelineParseError } from '../lib/timeline/parser';
import { isWeekend, timeOf } from '../lib/tz';
import { shiftWeek, weekDates, weekId, weekRangeMs } from '../lib/week';
import { useStore } from '../store';
import type { DayRecord, ToolUsage, WeekRecord, WorkLocation } from '../types';

const DAY_MS = 86_400_000;

function useWeek(id: string): WeekRecord | undefined {
  return useStore().weeks[id];
}

const weekTitle = (week: WeekRecord) => `Week ${week.isoWeek} · ${week.isoYear}`;

function locationLabel(location: WorkLocation | undefined): string {
  if (!location) return 'Onbekende locatie';
  return location.name ? `${location.werknummer} · ${location.name}` : location.werknummer;
}

export function WeekFlow({ weekId: id, step }: { weekId: string; step: 2 | 3 | 4 | 5 }) {
  const week = useWeek(id);
  if (!week) {
    return (
      <Page title="Week niet gevonden">
        <Notice kind="error">Deze week bestaat niet meer.</Notice>
      </Page>
    );
  }
  if (step === 2) return <ImportStep week={week} />;
  if (step === 3) return <HoursStep week={week} />;
  if (step === 4) return <ToolsStep week={week} />;
  return <DocumentStep week={week} />;
}

/* ---------------------------------------------------------------- Step 2 */

function ImportStep({ week }: { week: WeekRecord }) {
  const { locations, settings, saveWeek, go, sharedFile, setSharedFile } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<{ stays: number; matchedDays: number } | null>(null);

  async function importFile(file: File) {
    setBusy(true);
    setError('');
    setSummary(null);
    try {
      const timeline = parseTimelineText(await file.text());
      const { startMs, endMs } = weekRangeMs(week);
      // Keep the day before as well: Monday's first drive starts from Sunday's last stay.
      const { visits, travels } = sliceTimeline(timeline, startMs - DAY_MS, endMs);
      const inWeek = visits.filter((v) => v.endMs > startMs);
      if (inWeek.length === 0) {
        setError(
          `In dit bestand staat niets voor week ${week.isoWeek}. Maak een nieuwe export van je Tijdlijn en probeer het opnieuw.`,
        );
        return;
      }
      const result = applyProposals({ ...week, visits, travels, importedAt: Date.now() }, locations, settings);
      await saveWeek(result.week);
      const matchedDays = workdaysOf(result.week).filter((d) => (result.week.days[d]?.entries.length ?? 0) > 0);
      setSummary({ stays: inWeek.length, matchedDays: matchedDays.length });
    } catch (err) {
      setError(
        err instanceof TimelineParseError
          ? err.message
          : 'Het bestand kon niet worden gelezen. Probeer het opnieuw met een nieuwe export.',
      );
    } finally {
      setBusy(false);
    }
  }

  // A file shared into the app from Android is imported straight away.
  const consumed = useRef(false);
  useEffect(() => {
    if (sharedFile && !consumed.current) {
      consumed.current = true;
      setSharedFile(null);
      void importFile(sharedFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedFile]);

  const next = () => go({ name: 'week', weekId: week.id, step: 3 });

  return (
    <Page
      title="Importeer Tijdlijn"
      subtitle={`Stap 2 van 5 · ${weekTitle(week)}`}
      footer={
        <Button variant={summary || week.importedAt ? 'primary' : 'secondary'} onClick={next}>
          {summary || week.importedAt ? 'Verder' : 'Overslaan en zelf invullen'}
        </Button>
      }
    >
      {error && <Notice kind="error">{error}</Notice>}
      {summary && (
        <Notice kind="ok">
          Gelukt. {summary.stays} plekken gevonden in deze week; op {summary.matchedDays}{' '}
          {summary.matchedDays === 1 ? 'werkdag' : 'werkdagen'} was je op een werklocatie.
        </Notice>
      )}
      {!summary && week.importedAt && (
        <Notice kind="info">
          Voor deze week is al een bestand geïmporteerd. Je kunt verder, of een nieuwer bestand kiezen. Dagen die je
          zelf hebt aangepast blijven zoals ze zijn.
        </Notice>
      )}
      {locations.filter((l) => !l.archived).length === 0 && (
        <Notice kind="warning">
          Je hebt nog geen werklocaties. Zonder locaties kan de app geen uren voorstellen.
          <Button variant="secondary" className="mt-3" onClick={() => go({ name: 'location' })}>
            + Nieuwe locatie
          </Button>
        </Notice>
      )}

      <label
        className={`flex min-h-20 w-full cursor-pointer items-center justify-center rounded-xl px-4 text-xl font-semibold text-white ${busy ? 'bg-gray-400' : 'bg-emerald-700 active:bg-emerald-800'}`}
      >
        {busy ? 'Bezig met lezen…' : 'Kies Tijdlijn-bestand'}
        <input
          type="file"
          accept=".json,application/json"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importFile(file);
          }}
        />
      </label>
      <Button variant="secondary" onClick={() => go({ name: 'help' })}>
        Hoe kom ik aan dit bestand?
      </Button>
    </Page>
  );
}

/* ---------------------------------------------------------------- Step 3 */

function HoursStep({ week }: { week: WeekRecord }) {
  const { locations, settings, saveWeek, go } = useStore();
  const [unknown, setUnknown] = useState<UnknownVisit[]>([]);
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const active = useMemo(
    () =>
      locations
        .filter((l) => !l.archived)
        .sort((a, b) => a.werknummer.localeCompare(b.werknummer, 'nl', { numeric: true })),
    [locations],
  );

  // Refresh the proposals whenever locations or settings changed (e.g. a new location was just added).
  useEffect(() => {
    const result = applyProposals(week, locations, settings);
    setUnknown(result.unknown);
    if (JSON.stringify(result.week.days) !== JSON.stringify(week.days)) void saveWeek(result.week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, settings, week.importedAt]);

  const dates = weekDates(week);
  const shown = dates.filter((d) => !isWeekend(d) || (week.days[d]?.entries.length ?? 0) > 0 || week.days[d]?.manual);
  const hiddenWeekend = dates.filter((d) => !shown.includes(d));

  const setDay = (day: DayRecord) => saveWeek({ ...week, days: { ...week.days, [day.date]: day } });

  function resetDay(date: string) {
    const { [date]: _old, ...rest } = week.days;
    void saveWeek(applyProposals({ ...week, days: rest }, locations, settings).week);
  }

  return (
    <Page
      title="Controleer uren"
      subtitle={`Stap 3 van 5 · ${weekTitle(week)}`}
      footer={
        <>
          <p className="text-center text-lg font-semibold">Totaal week: {formatHours(weekTotal(week))} uur</p>
          <Button onClick={() => go({ name: 'week', weekId: week.id, step: 4 })}>Verder</Button>
        </>
      }
    >
      {shown.map((date) => (
        <DayCard
          key={date}
          date={date}
          day={week.days[date] ?? { date, entries: [], manual: false }}
          norm={settings.normHours}
          active={active}
          locationById={locationById}
          canReset={week.importedAt !== null && !isWeekend(date)}
          onChange={setDay}
          onReset={() => resetDay(date)}
        />
      ))}

      {hiddenWeekend.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {hiddenWeekend.map((date) => (
            <Button
              key={date}
              variant="secondary"
              className="text-base"
              onClick={() => setDay({ date, entries: [], manual: true })}
            >
              + {dayName(date)}
            </Button>
          ))}
        </div>
      )}

      {unknown.length > 0 && (
        <details className="rounded-xl bg-white p-4 shadow-sm">
          <summary className="min-h-11 cursor-pointer text-lg font-semibold">
            Onbekende plekken ({unknown.length})
          </summary>
          <p className="mt-2 text-base text-gray-700">
            Hier was je wel, maar het is geen werklocatie. Deze tijd telt niet mee. Was het toch werk? Maak er dan
            een werklocatie van.
          </p>
          <ul className="mt-3 space-y-3">
            {unknown.map((visit) => (
              <li key={`${visit.startMs}-${visit.lat}`} className="rounded-xl border-2 border-gray-200 p-3">
                <p className="text-base font-semibold">
                  {formatDayShort(visit.date)} · {timeOf(visit.startMs)}–{timeOf(visit.endMs)} (
                  {formatMinutes((visit.endMs - visit.startMs) / 60_000)})
                </p>
                <Button
                  variant="secondary"
                  className="mt-2 text-base"
                  onClick={() => go({ name: 'location', preset: { lat: visit.lat, lng: visit.lng } })}
                >
                  Maak werklocatie
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Page>
  );
}

function DayCard({
  date,
  day,
  norm,
  active,
  locationById,
  canReset,
  onChange,
  onReset,
}: {
  date: string;
  day: DayRecord;
  norm: number;
  active: WorkLocation[];
  locationById: Map<string, WorkLocation>;
  canReset: boolean;
  onChange(day: DayRecord): void;
  onReset(): void;
}) {
  const total = dayTotal(day);
  const edit = (entries: DayRecord['entries']) => onChange({ ...day, entries, manual: true });
  const available = active.filter((l) => !day.entries.some((e) => e.locationId === l.id));

  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-bold capitalize">
          {dayName(date)} <span className="text-base font-normal text-gray-600">{formatDate(date)}</span>
        </h2>
        <span className="text-xl font-bold">{formatHours(total)} uur</span>
      </div>

      {day.entries.length === 0 && <p className="text-base text-gray-600">Geen uren.</p>}

      {day.entries.map((entry, index) => (
        <div key={entry.locationId} className="rounded-xl border-2 border-gray-200 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-lg font-semibold">{locationLabel(locationById.get(entry.locationId))}</p>
              <p className="text-sm text-gray-600">
                {entry.measuredMinutes > 0 ? `Gemeten: ${formatMinutes(entry.measuredMinutes)}` : 'Zelf ingevuld'}
              </p>
            </div>
            <button
              type="button"
              aria-label="Verwijder regel"
              className="-mt-1 -mr-1 min-h-11 min-w-11 text-2xl text-gray-500"
              onClick={() => edit(day.entries.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <Button
              variant="secondary"
              className="w-16! text-2xl"
              aria-label="Uur minder"
              disabled={entry.hours <= 1}
              onClick={() => edit(day.entries.map((e, i) => (i === index ? { ...e, hours: e.hours - 1 } : e)))}
            >
              −
            </Button>
            <span className="text-2xl font-bold">{formatHours(entry.hours)} uur</span>
            <Button
              variant="secondary"
              className="w-16! text-2xl"
              aria-label="Uur meer"
              disabled={entry.hours >= 24}
              onClick={() => edit(day.entries.map((e, i) => (i === index ? { ...e, hours: e.hours + 1 } : e)))}
            >
              +
            </Button>
          </div>
        </div>
      ))}

      {day.entries.length > 0 && total !== norm && (
        <Notice kind="warning">
          Let op: {formatHours(total)} uur in plaats van {formatHours(norm)}.
        </Notice>
      )}

      {available.length > 0 && (
        <select
          className={selectClass}
          value=""
          aria-label="Locatie toevoegen"
          onChange={(e) => {
            if (!e.target.value) return;
            const hours = day.entries.length === 0 ? norm : 1;
            edit([...day.entries, { locationId: e.target.value, hours, measuredMinutes: 0 }]);
          }}
        >
          <option value="">+ Locatie toevoegen…</option>
          {available.map((l) => (
            <option key={l.id} value={l.id}>
              {locationLabel(l)}
            </option>
          ))}
        </select>
      )}

      {day.manual && canReset && (
        <Button variant="ghost" className="min-h-11 text-base" onClick={onReset}>
          Terug naar voorstel uit Tijdlijn
        </Button>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- Step 4 */

function ToolsStep({ week }: { week: WeekRecord }) {
  const { tools, locations, weeks, saveWeek, saveTool, go } = useStore();
  const [toolId, setToolId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState('');

  const toolById = new Map(tools.map((t) => [t.id, t]));
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  // Locations worked on this week come first; they are the likely choice.
  const usedIds = new Set(Object.values(week.days).flatMap((d) => d.entries.map((e) => e.locationId)));
  const options = locations
    .filter((l) => !l.archived || usedIds.has(l.id))
    .sort(
      (a, b) =>
        Number(usedIds.has(b.id)) - Number(usedIds.has(a.id)) ||
        a.werknummer.localeCompare(b.werknummer, 'nl', { numeric: true }),
    );
  const chosenLocation = locationId || (options.length > 0 && usedIds.size === 1 ? options[0].id : '');

  const previous = weeks[weekId(shiftWeek(week, -1))];
  const usages = week.tools.filter((u) => toolById.has(u.toolId));
  const save = (list: ToolUsage[]) => saveWeek({ ...week, tools: list });
  const has = (list: ToolUsage[], tool: string, location: string) =>
    list.some((u) => u.toolId === tool && u.locationId === location);

  async function add() {
    let id = toolId;
    if (toolId === 'new') {
      if (newName.trim() === '') return;
      id = crypto.randomUUID();
      await saveTool({ id, name: newName.trim(), description: '' });
    }
    if (!id || !chosenLocation) return;
    if (has(week.tools, id, chosenLocation)) {
      setMessage('Dit gereedschap staat al bij dit werknummer.');
      return;
    }
    setMessage('');
    await save([...week.tools, { id: crypto.randomUUID(), toolId: id, locationId: chosenLocation, dates: [] }]);
    setToolId('');
    setNewName('');
  }

  async function copyPrevious() {
    if (!previous) return;
    const copies = previous.tools
      .filter((u) => toolById.has(u.toolId) && !has(week.tools, u.toolId, u.locationId))
      .map((u) => ({ id: crypto.randomUUID(), toolId: u.toolId, locationId: u.locationId, dates: [] }));
    setMessage(
      copies.length === 0 ? 'Niets nieuws om te kopiëren.' : `${copies.length} regel(s) gekopieerd van vorige week.`,
    );
    if (copies.length > 0) await save([...week.tools, ...copies]);
  }

  const toggleDate = (usage: ToolUsage, date: string) =>
    save(
      week.tools.map((u) =>
        u.id === usage.id
          ? { ...u, dates: u.dates.includes(date) ? u.dates.filter((d) => d !== date) : [...u.dates, date].sort() }
          : u,
      ),
    );

  const weekdays = weekDates(week).filter((d) => !isWeekend(d) || (week.days[d]?.entries.length ?? 0) > 0);

  return (
    <Page
      title="Vul gereedschap in"
      subtitle={`Stap 4 van 5 · ${weekTitle(week)}`}
      footer={<Button onClick={() => go({ name: 'week', weekId: week.id, step: 5 })}>Verder</Button>}
    >
      <Button variant="secondary" onClick={copyPrevious} disabled={!previous || previous.tools.length === 0}>
        Kopieer van vorige week
      </Button>
      {message && <Notice kind="info">{message}</Notice>}

      {usages.map((usage) => (
        <Card key={usage.id} className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-lg font-bold">{toolById.get(usage.toolId)?.name}</p>
              <p className="text-base text-gray-700">{locationLabel(locationById.get(usage.locationId))}</p>
            </div>
            <button
              type="button"
              aria-label="Verwijder regel"
              className="-mt-1 -mr-1 min-h-11 min-w-11 text-2xl text-gray-500"
              onClick={() => save(week.tools.filter((u) => u.id !== usage.id))}
            >
              ✕
            </button>
          </div>
          <div>
            <p className="mb-2 text-sm text-gray-600">Gebruikt op (hoeft niet):</p>
            <div className="flex flex-wrap gap-2">
              {weekdays.map((date) => {
                const on = usage.dates.includes(date);
                return (
                  <button
                    key={date}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDate(usage, date)}
                    className={`min-h-11 rounded-lg border-2 px-3 text-base font-semibold ${on ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-300 bg-white text-gray-800'}`}
                  >
                    {formatDayShort(date)}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      ))}

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Gereedschap toevoegen</h2>
        {options.length === 0 ? (
          <p className="text-base text-gray-700">Voeg eerst een werklocatie toe.</p>
        ) : (
          <>
            <select className={selectClass} value={toolId} onChange={(e) => setToolId(e.target.value)} aria-label="Gereedschap">
              <option value="">Kies gereedschap…</option>
              {sortedTools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              <option value="new">+ Nieuw gereedschap…</option>
            </select>
            {toolId === 'new' && (
              <Field label="Naam nieuw gereedschap" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            )}
            <select
              className={selectClass}
              value={chosenLocation}
              onChange={(e) => setLocationId(e.target.value)}
              aria-label="Werknummer"
            >
              <option value="">Kies werknummer…</option>
              {options.map((l) => (
                <option key={l.id} value={l.id}>
                  {locationLabel(l)}
                </option>
              ))}
            </select>
            <Button
              onClick={add}
              disabled={!toolId || !chosenLocation || (toolId === 'new' && newName.trim() === '')}
            >
              Toevoegen
            </Button>
          </>
        )}
      </Card>
    </Page>
  );
}

/* ---------------------------------------------------------------- Step 5 */

function DocumentStep({ week }: { week: WeekRecord }) {
  const { settings, locations, tools, go, home } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const wrongDays = weekDates(week).filter((d) => {
    const day = week.days[d];
    return day && day.entries.length > 0 && dayTotal(day) !== settings.normHours;
  });
  const total = weekTotal(week);

  async function makeFile(): Promise<File> {
    // Loaded on demand: the PDF library is the largest part of the app.
    const { buildPdf, pdfFileName } = await import('../lib/pdf');
    const doc = buildPdf({ week, settings, locations, tools });
    return new File([doc.output('blob')], pdfFileName(week), { type: 'application/pdf' });
  }

  async function run(action: 'share' | 'save') {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const file = await makeFile();
      if (action === 'share' && canShareFile(file)) {
        if (await shareFile(file, file.name.replace('.pdf', ''))) setDone('Gedeeld.');
      } else {
        downloadFile(file);
        setDone(`Opgeslagen als “${file.name}” in Downloads.`);
      }
    } catch {
      setError('Het document maken is mislukt. Probeer het opnieuw.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Maak document"
      subtitle={`Stap 5 van 5 · ${weekTitle(week)}`}
      footer={
        <Button variant="secondary" onClick={home}>
          Klaar
        </Button>
      }
    >
      <Card className="space-y-1 text-center">
        <p className="text-base text-gray-600">Totaal deze week</p>
        <p className="text-4xl font-bold">{formatHours(total)} uur</p>
        <p className="text-base text-gray-600">
          {week.tools.length} {week.tools.length === 1 ? 'regel' : 'regels'} gereedschap
        </p>
      </Card>

      {total === 0 && <Notice kind="warning">Er zijn nog geen uren ingevuld voor deze week.</Notice>}
      {wrongDays.length > 0 && (
        <Notice kind="warning">
          Let op: {wrongDays.map(formatDayShort).join(', ')} {wrongDays.length === 1 ? 'heeft' : 'hebben'} geen{' '}
          {formatHours(settings.normHours)} uur. Klopt dat? Dan kun je gewoon doorgaan.
        </Notice>
      )}
      {settings.name.trim() === '' && settings.company.trim() === '' && (
        <Notice kind="info">
          Je naam staat nog niet op de urenstaat.
          <Button variant="secondary" className="mt-3" onClick={() => go({ name: 'settings' })}>
            Naam invullen
          </Button>
        </Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {done && <Notice kind="ok">{done}</Notice>}

      <Button className="min-h-20 text-xl" onClick={() => run('share')} disabled={busy}>
        {busy ? 'Bezig…' : 'Deel urenstaat (PDF)'}
      </Button>
      <Button variant="secondary" onClick={() => run('save')} disabled={busy}>
        Opslaan op telefoon
      </Button>
    </Page>
  );
}
