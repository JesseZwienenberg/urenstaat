/** App state: an in-memory copy of the database, plus simple screen navigation. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as database from './lib/db';
import {
  DEFAULT_SETTINGS,
  type MarkedPlace,
  type Settings,
  type Tool,
  type WeekRecord,
  type WorkLocation,
} from './types';

export type Screen =
  | { name: 'home' }
  | { name: 'pick-week' }
  | { name: 'week'; weekId: string; step: 2 | 3 | 4 | 5 }
  | { name: 'locations' }
  | { name: 'location'; id?: string; preset?: { lat: number; lng: number } }
  | { name: 'tools' }
  | { name: 'settings' }
  | { name: 'help' };

interface Store {
  ready: boolean;
  settings: Settings;
  locations: WorkLocation[];
  places: MarkedPlace[];
  tools: Tool[];
  weeks: Record<string, WeekRecord>;
  saveSettings(settings: Settings): Promise<void>;
  saveLocation(location: WorkLocation): Promise<void>;
  savePlace(place: MarkedPlace): Promise<void>;
  deletePlace(id: string): Promise<void>;
  saveTool(tool: Tool): Promise<void>;
  deleteTool(id: string): Promise<void>;
  saveWeek(week: WeekRecord): Promise<void>;
  deleteWeek(id: string): Promise<void>;
  restore(data: database.AllData): Promise<void>;
  /** A Timeline file shared into the app, waiting to be imported. */
  sharedFile: File | null;
  setSharedFile(file: File | null): void;
  screen: Screen;
  go(screen: Screen): void;
  back(): void;
  home(): void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreProvider missing');
  return store;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [locations, setLocations] = useState<WorkLocation[]>([]);
  const [places, setPlaces] = useState<MarkedPlace[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [weeks, setWeeks] = useState<Record<string, WeekRecord>>({});
  const [sharedFile, setSharedFile] = useState<File | null>(null);
  const [stack, setStack] = useState<Screen[]>([{ name: 'home' }]);
  const depth = useRef(0);

  const apply = useCallback((data: database.AllData) => {
    setSettings(data.settings);
    setLocations(data.locations);
    setPlaces(data.places);
    setTools(data.tools);
    setWeeks(Object.fromEntries(data.weeks.map((w) => [w.id, w])));
  }, []);

  useEffect(() => {
    database
      .loadAll()
      .then(apply)
      .finally(() => setReady(true));
    // Ask the browser not to evict the data when the phone runs low on space.
    navigator.storage?.persist?.().catch(() => undefined);
  }, [apply]);

  // Screens are browser history entries, so the Android back button works.
  useEffect(() => {
    const onPop = () => {
      depth.current = Math.max(0, depth.current - 1);
      setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const store = useMemo<Store>(() => {
    const upsert = <T extends { id: string }>(list: T[], item: T) =>
      list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
    return {
      ready,
      settings,
      locations,
      places,
      tools,
      weeks,
      async saveSettings(next) {
        setSettings(next);
        await database.putSettings(next);
      },
      async saveLocation(location) {
        setLocations((list) => upsert(list, location));
        await database.putLocation(location);
      },
      async savePlace(place) {
        setPlaces((list) => upsert(list, place));
        await database.putPlace(place);
      },
      async deletePlace(id) {
        setPlaces((list) => list.filter((p) => p.id !== id));
        await database.removePlace(id);
      },
      async saveTool(tool) {
        setTools((list) => upsert(list, tool));
        await database.putTool(tool);
      },
      async deleteTool(id) {
        setTools((list) => list.filter((t) => t.id !== id));
        await database.removeTool(id);
      },
      async saveWeek(week) {
        const stamped = { ...week, updatedAt: Date.now() };
        setWeeks((all) => ({ ...all, [stamped.id]: stamped }));
        await database.putWeek(stamped);
      },
      async deleteWeek(id) {
        setWeeks((all) => {
          const { [id]: _removed, ...rest } = all;
          return rest;
        });
        await database.removeWeek(id);
      },
      async restore(data) {
        await database.restoreAll(data);
        apply(data);
      },
      sharedFile,
      setSharedFile,
      screen: stack[stack.length - 1],
      go(screen) {
        depth.current += 1;
        window.history.pushState({ depth: depth.current }, '');
        setStack((s) => [...s, screen]);
        window.scrollTo(0, 0);
      },
      back() {
        if (depth.current > 0) window.history.back();
      },
      home() {
        if (depth.current > 0) {
          const steps = depth.current;
          depth.current = 0;
          setStack([{ name: 'home' }]);
          // Unwind quietly; the popstate handler finds nothing left to pop.
          window.history.go(-steps);
        }
      },
    };
  }, [ready, settings, locations, places, tools, weeks, sharedFile, stack, apply]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
