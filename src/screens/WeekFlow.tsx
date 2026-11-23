/** Steps 2–5 of the weekly flow: import, check hours, tools, document. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { TimesheetPreview } from '../components/TimesheetPreview';
import { Button, Card, ErrorNotice, Field, Notice, Page, selectClass, useError } from '../components/ui';
import { canShareFile, downloadFile, shareFile } from '../lib/device';
import { dayName, formatDate, formatDayShort, formatHours, formatMinutes } from '../lib/format';
import { applyProposals, dayTotal, HOUR_STEP, weekTotal, workdaysOf, type UnknownVisit } from '../lib/hours';
import { byWerknummer, hasWerknummer, locationLabel, placeName } from '../lib/location';
import { findByName, normalizeName, searchByName } from '../lib/search';
import { buildTimesheet, timesheetText } from '../lib/timesheet';
import { parseTimelineText, sliceTimeline, TimelineParseError } from '../lib/timeline/parser';
import { isWeekend, timeOf } from '../lib/tz';
import { shiftWeek, weekDates, weekId, weekRangeMs } from '../lib/week';
import { useStore } from '../store';
import {
  PLACE_RADIUS,
  type DayRecord,
  type HourEntry,
  type MarkedPlace,
  type ToolUsage,
  type WeekRecord,
  type WorkLocation,
} from '../types';

const DAY_MS = 86_400_000;

function useWeek(id: string): WeekRecord | undefined {
  return useStore().weeks[id];
}

const weekTitle = (week: WeekRecord) => `Week ${week.isoWeek} · ${week.isoYear}`;

/** A day with an always-regie location: its total differing from the norm is expected. */
function hasRegie(day: DayRecord, locationById: Map<string, WorkLocation>): boolean {
  return day.entries.some((e) => locationById.get(e.locationId)?.regie);
}

/** The day's hours on a small folding ruler: one mark per hour, yellow up to the total. */
function DayRuler({ hours, norm }: { hours: number; norm: number }) {
  const scale = Math.max(norm, Math.ceil(hours), 1);
  return (
    <div aria-hidden="true" className="relative h-2.5 overflow-hidden rounded-sm bg-gray-200">
      <div className="h-full bg-yellow-400" style={{ width: `${(Math.min(hours, scale) / scale) * 100}%` }} />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'linear-gradient(to right, transparent calc(100% - 1px), rgb(31 41 55 / 0.35) 0)',
          backgroundSize: `${100 / scale}% 100%`,
        }}
      />
    </div>
  );
}

/** A spirit level: the bubble sits between the marks when every day has its hours, and drifts off when not. */
function Waterpas({ tilt }: { tilt: -1 | 0 | 1 }) {
  return (
    <div
      role="img"
      aria-label={tilt === 0 ? 'Waterpas: alle dagen kloppen' : 'Waterpas: niet alle dagen kloppen'}
      className="mx-auto mt-3 flex h-7 w-40 items-center justify-center rounded-md bg-yellow-400"
    >
      <div className="relative h-4 w-20 overflow-hidden rounded-full border border-lime-800/30 bg-lime-200">
        <div className="absolute inset-y-0 left-[calc(50%-11px)] w-px bg-gray-800/50" />
        <div className="absolute inset-y-0 left-[calc(50%+10px)] w-px bg-gray-800/50" />
        <div
          className="absolute top-1/2 h-2.5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 transition-[left] duration-700"
          style={{ left: `${50 + tilt * 30}%` }}
        />
      </div>
    </div>
  );
}

/** New hours for a line; the regie part never exceeds them. */
function withHours(entry: HourEntry, hours: number): HourEntry {
  return entry.regieHours ? { ...entry, hours, regieHours: Math.min(entry.regieHours, hours) } : { ...entry, hours };
}

/** Sets the regie part of a line; 0 removes it. */
function withRegie(entry: HourEntry, regieHours: number): HourEntry {
  const { regieHours: _old, ...rest } = entry;
  return regieHours > 0 ? { ...rest, regieHours: Math.min(regieHours, entry.hours) } : rest;
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
  const { locations, places, settings, saveWeek, go, back, previous, sharedFile, setSharedFile } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useError();
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
      const result = applyProposals(
        { ...week, visits, travels, importedAt: Date.now() },
        locations,
        settings,
        places,
      );
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

  // Opened from "Controleer uren": return there instead of stacking a second hours screen.
  const fromHours = previous?.name === 'week' && previous.weekId === week.id && previous.step === 3;
  const next = () => (fromHours ? back() : go({ name: 'week', weekId: week.id, step: 3 }));
  const hasOwnDays = Object.values(week.days).some((d) => d.manual);

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
      <ErrorNotice error={error} />
      {summary && (
        <Notice kind="ok">
          Gelukt. {summary.stays} plekken gevonden in deze week; op {summary.matchedDays}{' '}
          {summary.matchedDays === 1 ? 'werkdag' : 'werkdagen'} was je op een werklocatie.
        </Notice>
      )}
      {!summary && (week.importedAt || hasOwnDays) && (
        <Notice kind="info">
          {week.importedAt && 'Voor deze week is al een bestand geïmporteerd. Je kunt verder, of een nieuwer bestand kiezen. '}
          Dagen die je zelf hebt ingevuld of aangepast blijven zoals ze zijn.
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
  const { locations, places, settings, saveWeek, savePlace, go } = useStore();
  const [unknown, setUnknown] = useState<UnknownVisit[]>([]);
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const active = useMemo(
    () => locations.filter((l) => !l.archived).sort(byWerknummer),
    [locations],
  );

  // Refresh the proposals whenever locations or settings changed (e.g. a new location was just added).
  useEffect(() => {
    const result = applyProposals(week, locations, settings, places);
    setUnknown(result.unknown);
    if (JSON.stringify(result.week.days) !== JSON.stringify(week.days)) void saveWeek(result.week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, places, settings, week.importedAt]);

  const dates = weekDates(week);
  const shown = dates.filter((d) => !isWeekend(d) || (week.days[d]?.entries.length ?? 0) > 0 || week.days[d]?.manual);
  const hiddenWeekend = dates.filter((d) => !shown.includes(d));

  const setDay = (day: DayRecord) => saveWeek({ ...week, days: { ...week.days, [day.date]: day } });

  function resetDay(date: string) {
    const { [date]: _old, ...rest } = week.days;
    void saveWeek(applyProposals({ ...week, days: rest }, locations, settings, places).week);
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
      {week.importedAt === null && (
        <Notice kind="info">
          Nog geen Tijdlijn geïmporteerd voor deze week. Dat kan altijd nog, ook als je al materialen of uren hebt
          ingevuld.
          <Button variant="secondary" className="mt-3" onClick={() => go({ name: 'week', weekId: week.id, step: 2 })}>
            Tijdlijn importeren
          </Button>
        </Notice>
      )}
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

      <Button variant="secondary" onClick={() => go({ name: 'location' })}>
        + Nieuwe werklocatie
      </Button>
      <p className="-mt-2 text-sm text-gray-600">
        Klopt de Tijdlijn niet? Voeg de locatie hier toe en kies hem daarna bij de dag met “+ Uren toevoegen”.
      </p>
      {week.importedAt !== null && (
        <Button
          variant="ghost"
          className="min-h-11 text-base"
          onClick={() => go({ name: 'week', weekId: week.id, step: 2 })}
        >
          Nieuwere Tijdlijn importeren
        </Button>
      )}

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
            Hier was je tijdens werktijd, maar het is geen werklocatie. Deze tijd telt niet mee. Kom je er vaker?
            Geef dan aan wat voor plek het is, dan vraagt de app er niet meer naar.
          </p>
          <ul className="mt-3 space-y-3">
            {unknown.map((visit) => (
              <UnknownItem
                key={`${visit.startMs}-${visit.lat}`}
                visit={visit}
                onLocation={() =>
                  go({
                    name: 'location',
                    preset: { lat: visit.lat, lng: visit.lng, name: visit.name, address: visit.address },
                  })
                }
                onMark={(place) => void savePlace(place)}
              />
            ))}
          </ul>
        </details>
      )}
    </Page>
  );
}

function UnknownItem({
  visit,
  onLocation,
  onMark,
}: {
  visit: UnknownVisit;
  onLocation(): void;
  onMark(place: MarkedPlace): void;
}) {
  const [open, setOpen] = useState(false);
  // What the export says about this place, if anything, is offered as a suggestion.
  const [name, setName] = useState(visit.name ?? '');
  const mark = (kind: MarkedPlace['kind']) =>
    onMark({
      id: crypto.randomUUID(),
      name: name.trim() || (kind === 'work' ? 'Werkplek zonder werknummer' : 'Privéplek'),
      lat: visit.lat,
      lng: visit.lng,
      radius: PLACE_RADIUS,
      kind,
    });

  return (
    <li className="space-y-2 rounded-xl border-2 border-gray-200 p-3">
      <p className="text-base font-semibold">
        {formatDayShort(visit.date)} · {timeOf(visit.startMs)}–{timeOf(visit.endMs)} (
        {formatMinutes((visit.endMs - visit.startMs) / 60_000)})
      </p>
      {(visit.name || visit.address) && (
        <p className="text-base text-gray-700">
          Volgens je Tijdlijn: {[visit.name, visit.address].filter(Boolean).join(', ')}
        </p>
      )}
      {!open ? (
        <Button variant="secondary" className="text-base" onClick={() => setOpen(true)}>
          Wat is dit voor plek?
        </Button>
      ) : (
        <>
          <Button variant="secondary" className="text-base" onClick={onLocation}>
            Een klus: maak werklocatie
          </Button>
          <Field
            label="Naam van de plek (hoeft niet)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint="Bijvoorbeeld: Thuis, Bouwmarkt, Werkplaats"
          />
          <Button variant="secondary" className="text-base" onClick={() => mark('work')}>
            Werk, geen klus: telt mee bij de volgende klus
          </Button>
          <Button variant="secondary" className="text-base" onClick={() => mark('private')}>
            Privé: telt nooit mee
          </Button>
        </>
      )}
    </li>
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
  const change = (index: number, update: (entry: HourEntry) => HourEntry) =>
    edit(day.entries.map((e, i) => (i === index ? update(e) : e)));
  const available = active.filter((l) => !day.entries.some((e) => e.locationId === l.id));
  // "+ Uren toevoegen" opens a list of existing work locations to choose from.
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState('');
  const words = normalizeName(filter).split(' ').filter(Boolean);
  const matching = available.filter((l) => {
    const text = normalizeName(`${l.werknummer} ${l.name} ${l.address}`);
    return words.every((w) => text.includes(w));
  });

  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-bold capitalize">
          {dayName(date)} <span className="text-base font-normal text-gray-600">{formatDate(date)}</span>
        </h2>
        <span className="text-xl font-bold">{formatHours(total)} uur</span>
      </div>
      <DayRuler hours={total} norm={norm} />

      {day.entries.length === 0 && <p className="text-base text-gray-600">Geen uren.</p>}

      {day.entries.map((entry, index) => {
        const location = locationById.get(entry.locationId);
        return (
          <div key={entry.locationId} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-lg font-semibold">{locationLabel(location)}</p>
                <p className="text-sm text-gray-600">
                  {location?.regie && <b className="text-emerald-800">Regie · </b>}
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
                aria-label="Half uur minder"
                disabled={entry.hours <= HOUR_STEP}
                onClick={() => change(index, (e) => withHours(e, e.hours - HOUR_STEP))}
              >
                −
              </Button>
              <span className="text-2xl font-bold">{formatHours(entry.hours)} uur</span>
              <Button
                variant="secondary"
                className="w-16! text-2xl"
                aria-label="Half uur meer"
                disabled={entry.hours >= 24}
                onClick={() => change(index, (e) => withHours(e, e.hours + HOUR_STEP))}
              >
                +
              </Button>
            </div>
            {!location?.regie &&
              (entry.regieHours ? (
                <div className="mt-3 flex items-end gap-2">
                  <label className="block flex-1">
                    <span className="mb-1 block text-base font-semibold text-gray-800">Waarvan regie</span>
                    <select
                      className={selectClass}
                      value={entry.regieHours}
                      onChange={(e) => change(index, (x) => withRegie(x, Number(e.target.value)))}
                    >
                      {Array.from({ length: Math.round(entry.hours / HOUR_STEP) }, (_, i) => (i + 1) * HOUR_STEP).map(
                        (value) => (
                          <option key={value} value={value}>
                            {formatHours(value)} uur
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label="Geen regie"
                    className="min-h-14 min-w-11 text-2xl text-gray-500"
                    onClick={() => change(index, (x) => withRegie(x, 0))}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  className="mt-1 min-h-11 text-base"
                  onClick={() => change(index, (x) => withRegie(x, Math.min(1, x.hours)))}
                >
                  Gedeeltelijk regie
                </Button>
              ))}
          </div>
        );
      })}

      {day.entries.length > 0 && total !== norm && !hasRegie(day, locationById) && (
        <Notice kind="warning">
          Let op: {formatHours(total)} uur in plaats van {formatHours(norm)}.
        </Notice>
      )}

      {available.length > 0 &&
        (picking ? (
          <div className="space-y-2">
            <p className="text-base font-semibold">Waar heb je gewerkt?</p>
            {available.length > 8 && (
              <input
                type="search"
                aria-label="Zoek werklocatie"
                placeholder="Zoek op werknummer, naam of adres…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoComplete="off"
                className="min-h-12 w-full rounded-xl border-2 border-gray-300 bg-white px-3 text-base focus:border-emerald-700 focus:outline-none"
              />
            )}
            <ul
              className="divide-y divide-emerald-200 overflow-hidden rounded-xl border-2 border-emerald-300 bg-emerald-50"
              aria-label="Werklocaties"
            >
              {matching.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    className="min-h-14 w-full px-3 py-2 text-left active:bg-emerald-100"
                    onClick={() => {
                      const hours = day.entries.length === 0 ? norm : 1;
                      edit([...day.entries, { locationId: l.id, hours, measuredMinutes: 0 }]);
                      setPicking(false);
                      setFilter('');
                    }}
                  >
                    <span className="block text-lg font-semibold">{locationLabel(l)}</span>
                    {l.name.trim() !== '' && l.address.trim() !== '' && (
                      <span className="block text-sm text-gray-600">{l.address}</span>
                    )}
                  </button>
                </li>
              ))}
              {matching.length === 0 && <li className="p-3 text-base text-gray-600">Geen werklocatie gevonden.</li>}
            </ul>
            <Button
              variant="ghost"
              className="min-h-11 text-base"
              onClick={() => {
                setPicking(false);
                setFilter('');
              }}
            >
              Annuleer
            </Button>
          </div>
        ) : (
          <Button variant="secondary" className="text-base" onClick={() => setPicking(true)}>
            + Uren toevoegen
          </Button>
        ))}

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
  const [text, setText] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [amount, setAmount] = useState('');
  const [locationId, setLocationId] = useState('');
  const [message, setMessage] = useState('');

  const toolById = new Map(tools.map((t) => [t.id, t]));
  const locationById = new Map(locations.map((l) => [l.id, l]));

  // Free text with suggestions from the list. A name that is not in the list yet is added on "Toevoegen".
  const typed = text.trim();
  const known = findByName(tools, typed);
  const suggestions = useMemo(
    () => (suggesting && typed !== '' ? searchByName(tools, typed).filter((t) => t !== known).slice(0, 6) : []),
    [tools, typed, known, suggesting],
  );

  // Locations worked on this week come first; they are the likely choice.
  const usedIds = new Set(Object.values(week.days).flatMap((d) => d.entries.map((e) => e.locationId)));
  const options = locations
    .filter((l) => !l.archived || usedIds.has(l.id))
    .sort((a, b) => Number(usedIds.has(b.id)) - Number(usedIds.has(a.id)) || byWerknummer(a, b));
  const chosenLocation = locationId || (options.length > 0 && usedIds.size === 1 ? options[0].id : '');

  const previous = weeks[weekId(shiftWeek(week, -1))];
  const usages = week.tools.filter((u) => toolById.has(u.toolId));
  const save = (list: ToolUsage[]) => saveWeek({ ...week, tools: list });
  const has = (list: ToolUsage[], tool: string, location: string) =>
    list.some((u) => u.toolId === tool && u.locationId === location);

  async function add() {
    if (typed === '' || !chosenLocation) return;
    if (known && has(week.tools, known.id, chosenLocation)) {
      setMessage('Dit materiaal staat al bij dit werknummer.');
      return;
    }
    let id = known?.id;
    if (!id) {
      id = crypto.randomUUID();
      await saveTool({ id, name: typed, description: '' });
    }
    setMessage('');
    await save([
      ...week.tools,
      { id: crypto.randomUUID(), toolId: id, locationId: chosenLocation, amount: amount.trim(), dates: [] },
    ]);
    setText('');
    setAmount('');
    setSuggesting(false);
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

  return (
    <Page
      title="Vul materialen in"
      subtitle={`Stap 4 van 5 · ${weekTitle(week)}`}
      footer={<Button onClick={() => go({ name: 'week', weekId: week.id, step: 5 })}>Verder</Button>}
    >
      {/* The form is always on top and framed in green; what was added is a plain list below it. */}
      <Card className="space-y-3 border-2 border-emerald-700">
        <h2 className="text-xl font-bold text-emerald-900">Materiaal toevoegen</h2>
        {options.length === 0 ? (
          <p className="text-base text-gray-700">Voeg eerst een werklocatie toe.</p>
        ) : (
          <>
            <Field
              label="Materiaal"
              placeholder="Typ om te zoeken…"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSuggesting(true);
              }}
              autoComplete="off"
            />
            {suggestions.length > 0 && (
              <ul
                className="divide-y divide-emerald-200 overflow-hidden rounded-xl border-2 border-emerald-300 bg-emerald-50"
                aria-label="Suggesties"
              >
                {suggestions.map((tool) => (
                  <li key={tool.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setText(tool.name);
                        setSuggesting(false);
                      }}
                      className="min-h-14 w-full px-3 py-2 text-left text-lg active:bg-emerald-100"
                    >
                      {tool.name}
                      {tool.description && <span className="block text-sm text-gray-600">{tool.description}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {typed !== '' && !known && (
              <p className="text-base text-gray-700">
                <b>Nieuw:</b> “{typed}” staat nog niet in je lijst. Bij Toevoegen komt het erin.
              </p>
            )}
            <Field
              label="Hoeveelheid (hoeft niet)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Bijvoorbeeld 3 of 12 m"
              autoComplete="off"
            />
            <label className="block">
              <span className="mb-1 block text-base font-semibold text-gray-800">Werknummer</span>
              <select className={selectClass} value={chosenLocation} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Kies werknummer…</option>
                {options.map((l) => (
                  <option key={l.id} value={l.id}>
                    {locationLabel(l)}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={add} disabled={typed === '' || !chosenLocation}>
              Toevoegen
            </Button>
          </>
        )}
      </Card>

      <Button variant="secondary" onClick={copyPrevious} disabled={!previous || previous.tools.length === 0}>
        Kopieer van vorige week
      </Button>
      {message && <Notice kind="info">{message}</Notice>}

      {usages.length > 0 && (
        <>
          <h2 className="pt-2 text-xl font-bold">Toegevoegd deze week ({usages.length})</h2>
          <ul className="divide-y divide-gray-200 rounded-xl bg-white shadow-sm">
            {usages.map((usage) => (
              <li key={usage.id} className="flex items-start gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold">{toolById.get(usage.toolId)?.name}</p>
                  <p className="text-sm text-gray-600">{locationLabel(locationById.get(usage.locationId))}</p>
                  <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
                    Hoeveelheid
                    <input
                      value={usage.amount ?? ''}
                      onChange={(e) =>
                        save(week.tools.map((u) => (u.id === usage.id ? { ...u, amount: e.target.value } : u)))
                      }
                      placeholder="bijv. 12 m"
                      autoComplete="off"
                      className="min-h-11 w-36 rounded-lg border border-gray-300 bg-gray-50 px-2 text-base focus:border-emerald-700 focus:outline-none"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  aria-label="Verwijder regel"
                  className="-mt-1 -mr-1 min-h-11 min-w-11 text-2xl text-gray-500"
                  onClick={() => save(week.tools.filter((u) => u.id !== usage.id))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}

/* ---------------------------------------------------------------- Step 5 */

function DocumentStep({ week }: { week: WeekRecord }) {
  const { settings, locations, tools, go, home } = useStore();
  const [error, setError] = useError();
  const [done, setDone] = useState('');
  const [manualCopy, setManualCopy] = useState(false);
  const sheet = useMemo(() => buildTimesheet({ week, settings, locations, tools }), [week, settings, locations, tools]);

  const locationById = new Map(locations.map((l) => [l.id, l]));
  const wrongDays = weekDates(week).filter((d) => {
    const day = week.days[d];
    return day && day.entries.length > 0 && dayTotal(day) !== settings.normHours && !hasRegie(day, locationById);
  });
  const total = weekTotal(week);
  // Too few hours tilts the level one way, too many the other.
  const surplus = wrongDays.reduce((sum, d) => sum + dayTotal(week.days[d]) - settings.normHours, 0);
  const tilt = total === 0 ? -1 : wrongDays.length === 0 ? 0 : surplus > 0 ? 1 : -1;

  // Locations on this week's timesheet whose werknummer is not known yet: that cell stays empty.
  const toolIds = new Set(tools.map((t) => t.id));
  const onSheet = new Set([
    ...Object.values(week.days).flatMap((d) => d.entries.map((e) => e.locationId)),
    ...week.tools.filter((u) => toolIds.has(u.toolId)).map((u) => u.locationId),
  ]);
  const withoutNumber = locations.filter((l) => onSheet.has(l.id) && !hasWerknummer(l)).sort(byWerknummer);

  // The PDF is built as soon as this screen opens. Android only opens the share
  // sheet if navigator.share is called directly from the tap, with no waiting in between.
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFile(null);
    // Loaded on demand: the PDF library is the largest part of the app.
    import('../lib/pdf')
      .then(({ buildPdf, pdfFileName }) => {
        const doc = buildPdf({ week, settings, locations, tools });
        const built = new File([doc.output('blob')], pdfFileName(week), { type: 'application/pdf' });
        if (!cancelled) setFile(built);
      })
      .catch(() => {
        if (!cancelled) setError('Het document maken is mislukt. Probeer het opnieuw.');
      });
    return () => {
      cancelled = true;
    };
  }, [week, settings, locations, tools]);

  function save() {
    if (!file) return;
    downloadFile(file);
    setDone(`Opgeslagen als “${file.name}” in Downloads.`);
  }

  async function share() {
    if (!file) return;
    setError('');
    setDone('');
    if (!canShareFile(file)) return save();
    try {
      if (await shareFile(file)) setDone('Gedeeld. Klaar is Kees.');
    } catch {
      // Sharing refused by the phone: save the file instead, so he still has it.
      downloadFile(file);
      setDone(`Delen lukte niet. De urenstaat is opgeslagen als “${file.name}” in Downloads; deel hem vanuit daar.`);
    }
  }

  /** For changes the app cannot make: the same content as plain text, to paste and edit elsewhere. */
  async function copyText() {
    setError('');
    setDone('');
    setManualCopy(false);
    try {
      await navigator.clipboard.writeText(timesheetText(sheet));
      setDone('Tekst gekopieerd. Plak hem waar je wilt, bijvoorbeeld in Word, Excel of een notitie.');
    } catch {
      setManualCopy(true);
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
          {week.tools.length} {week.tools.length === 1 ? 'materiaal' : 'materialen'}
        </p>
        <Waterpas tilt={tilt} />
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
      {withoutNumber.length > 0 && (
        <Notice kind="warning">
          Nog geen werknummer bij {withoutNumber.map(placeName).join(', ')}. Op de urenstaat blijft dat vak leeg.
          {withoutNumber.map((l) => (
            <Button
              key={l.id}
              variant="secondary"
              className="mt-3"
              onClick={() => go({ name: 'location', id: l.id })}
            >
              {withoutNumber.length === 1 ? 'Werknummer invullen' : `Werknummer invullen: ${placeName(l)}`}
            </Button>
          ))}
        </Notice>
      )}

      <h2 className="pt-2 text-xl font-bold">Voorbeeld</h2>
      <TimesheetPreview sheet={sheet} />

      <ErrorNotice error={error} />
      {done && <Notice kind="ok">{done}</Notice>}
      <Button className="min-h-20 text-xl" onClick={share} disabled={!file}>
        {file ? 'Deel urenstaat (PDF)' : 'Bezig…'}
      </Button>
      <Button variant="secondary" onClick={save} disabled={!file}>
        Opslaan op telefoon
      </Button>
      <Button variant="secondary" onClick={copyText}>
        Kopieer als tekst
      </Button>
      {manualCopy && (
        <Card className="space-y-2">
          <p className="text-base">
            Kopiëren lukte niet vanzelf. Houd je vinger op de tekst hieronder, kies Alles selecteren en dan Kopiëren.
          </p>
          <textarea
            readOnly
            rows={10}
            value={timesheetText(sheet)}
            onFocus={(e) => e.target.select()}
            className="w-full rounded-xl border-2 border-gray-300 p-2 font-mono text-sm"
          />
        </Card>
      )}
    </Page>
  );
}
