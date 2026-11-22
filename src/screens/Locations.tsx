import { useState } from 'react';
import { Button, Card, Field, Notice, Page } from '../components/ui';
import { currentPosition, searchAddress, type AddressResult } from '../lib/device';
import { useStore } from '../store';
import { DEFAULT_RADIUS, type WorkLocation } from '../types';

export function Locations() {
  const { locations, go, saveLocation } = useStore();
  const [showArchived, setShowArchived] = useState(false);
  const byNumber = (a: WorkLocation, b: WorkLocation) =>
    a.werknummer.localeCompare(b.werknummer, 'nl', { numeric: true });
  const active = locations.filter((l) => !l.archived).sort(byNumber);
  const archived = locations.filter((l) => l.archived).sort(byNumber);

  const row = (location: WorkLocation) => (
    <Card key={location.id} className="space-y-3">
      <div>
        <p className="text-lg font-bold">
          {location.werknummer} · {location.name}
        </p>
        <p className="text-base text-gray-700">{location.address}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={() => go({ name: 'location', id: location.id })}>
          Wijzig
        </Button>
        <Button variant="secondary" onClick={() => saveLocation({ ...location, archived: !location.archived })}>
          {location.archived ? 'Terugzetten' : 'Archiveer'}
        </Button>
      </div>
    </Card>
  );

  return (
    <Page title="Werklocaties" footer={<Button onClick={() => go({ name: 'location' })}>+ Nieuwe locatie</Button>}>
      {active.length === 0 && <p className="text-gray-600">Nog geen werklocaties.</p>}
      {active.map(row)}
      {archived.length > 0 && (
        <>
          <Button variant="ghost" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Verberg' : 'Toon'} gearchiveerde locaties ({archived.length})
          </Button>
          {showArchived && archived.map(row)}
        </>
      )}
    </Page>
  );
}

export function LocationForm({ id, preset }: { id?: string; preset?: { lat: number; lng: number } }) {
  const { locations, saveLocation, back } = useStore();
  const existing = locations.find((l) => l.id === id);
  const [werknummer, setWerknummer] = useState(existing?.werknummer ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [radius, setRadius] = useState(existing?.radius ?? DEFAULT_RADIUS);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    existing ? { lat: existing.lat, lng: existing.lng } : (preset ?? null),
  );
  const [results, setResults] = useState<AddressResult[] | null>(null);
  const [busy, setBusy] = useState<'search' | 'gps' | null>(null);
  const [error, setError] = useState('');

  async function search() {
    if (address.trim() === '') {
      setError('Vul eerst een adres in.');
      return;
    }
    setBusy('search');
    setError('');
    setResults(null);
    try {
      const found = await searchAddress(address.trim());
      if (found.length === 0) setError('Adres niet gevonden. Probeer straat, huisnummer en plaats.');
      else if (found.length === 1) pick(found[0]);
      else setResults(found);
    } catch {
      setError('Adres zoeken lukt nu niet. Controleer je internetverbinding.');
    } finally {
      setBusy(null);
    }
  }

  function pick(result: AddressResult) {
    setCoords({ lat: result.lat, lng: result.lng });
    setResults(null);
  }

  async function useGps() {
    setBusy('gps');
    setError('');
    try {
      const position = await currentPosition();
      setCoords({ lat: position.lat, lng: position.lng });
    } catch {
      setError('Je plek kon niet worden bepaald. Zet locatie aan en geef de app toestemming.');
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const number = werknummer.trim();
    if (number === '') return setError('Vul een werknummer in.');
    const taken = locations.some(
      (l) => l.id !== existing?.id && l.werknummer.trim().toLowerCase() === number.toLowerCase(),
    );
    if (taken) return setError(`Werknummer ${number} bestaat al.`);
    if (!coords) return setError('Zoek het adres op of tik op “Ik ben hier nu”, zodat de app de plek kent.');
    await saveLocation({
      id: existing?.id ?? crypto.randomUUID(),
      werknummer: number,
      name: name.trim(),
      address: address.trim(),
      lat: coords.lat,
      lng: coords.lng,
      radius: Math.min(5000, Math.max(25, Math.round(Number(radius) || DEFAULT_RADIUS))),
      archived: existing?.archived ?? false,
    });
    back();
  }

  return (
    <Page
      title={existing ? 'Locatie wijzigen' : 'Nieuwe locatie'}
      footer={<Button onClick={save}>Opslaan</Button>}
    >
      {error && <Notice kind="error">{error}</Notice>}
      <Card className="space-y-4">
        <Field label="Werknummer" value={werknummer} onChange={(e) => setWerknummer(e.target.value)} />
        <Field label="Naam" value={name} onChange={(e) => setName(e.target.value)} hint="Bijvoorbeeld: Verbouwing fam. Jansen" />
        <Field
          label="Adres"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          hint="Dit adres komt op de urenstaat."
          autoComplete="off"
        />
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={search} disabled={busy !== null}>
            {busy === 'search' ? 'Zoeken…' : 'Zoek adres'}
          </Button>
          <Button variant="secondary" onClick={useGps} disabled={busy !== null}>
            {busy === 'gps' ? 'Bezig…' : 'Ik ben hier nu'}
          </Button>
        </div>
        {results && (
          <div className="space-y-2">
            <p className="font-semibold">Welk adres bedoel je?</p>
            {results.map((result) => (
              <button
                key={`${result.lat},${result.lng}`}
                type="button"
                onClick={() => pick(result)}
                className="min-h-14 w-full rounded-xl border-2 border-gray-300 p-3 text-left text-base active:bg-gray-100"
              >
                {result.label}
              </button>
            ))}
          </div>
        )}
        {coords ? (
          <Notice kind="ok">
            Plek ingesteld ({coords.lat.toFixed(5)}, {coords.lng.toFixed(5)})
          </Notice>
        ) : (
          <Notice kind="warning">Nog geen plek ingesteld.</Notice>
        )}
        <Field
          label="Straal (meter)"
          type="number"
          inputMode="numeric"
          min={25}
          step={25}
          value={radius}
          onChange={(e) => setRadius(e.target.valueAsNumber)}
          hint="Hoe dicht je bij het adres moet zijn om mee te tellen."
        />
      </Card>
    </Page>
  );
}

export function ToolsScreen() {
  const { tools, saveTool, deleteTool } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  function start(id: string | null) {
    const tool = tools.find((t) => t.id === id);
    setEditing(id ?? 'new');
    setName(tool?.name ?? '');
    setDescription(tool?.description ?? '');
  }

  async function save() {
    if (name.trim() === '') return;
    await saveTool({
      id: editing && editing !== 'new' ? editing : crypto.randomUUID(),
      name: name.trim(),
      description: description.trim(),
    });
    setEditing(null);
  }

  return (
    <Page title="Gereedschap" footer={editing ? undefined : <Button onClick={() => start(null)}>+ Nieuw gereedschap</Button>}>
      {editing && (
        <Card className="space-y-4">
          <Field label="Naam" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <Field label="Omschrijving (hoeft niet)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Annuleer
            </Button>
            <Button onClick={save} disabled={name.trim() === ''}>
              Opslaan
            </Button>
          </div>
        </Card>
      )}
      {sorted.length === 0 && !editing && <p className="text-gray-600">Nog geen gereedschap in je lijst.</p>}
      {sorted.map((tool) => (
        <Card key={tool.id} className="space-y-3">
          <div>
            <p className="text-lg font-bold">{tool.name}</p>
            {tool.description && <p className="text-base text-gray-700">{tool.description}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => start(tool.id)}>
              Wijzig
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(`“${tool.name}” uit je lijst halen?`)) void deleteTool(tool.id);
              }}
            >
              Verwijder
            </Button>
          </div>
        </Card>
      ))}
    </Page>
  );
}
