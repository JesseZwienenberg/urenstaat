/** IndexedDB storage. Everything stays on the phone. */
import { openDB, type IDBPDatabase } from 'idb';
import {
  DEFAULT_SETTINGS,
  type BackupFile,
  type Settings,
  type Tool,
  type WeekRecord,
  type WorkLocation,
} from '../types';

const DB_NAME = 'urenstaat';
const STORES = ['settings', 'locations', 'tools', 'weeks'] as const;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore('settings');
      database.createObjectStore('locations', { keyPath: 'id' });
      database.createObjectStore('tools', { keyPath: 'id' });
      database.createObjectStore('weeks', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

export interface AllData {
  settings: Settings;
  locations: WorkLocation[];
  tools: Tool[];
  weeks: WeekRecord[];
}

export async function loadAll(): Promise<AllData> {
  const database = await db();
  const [settings, locations, tools, weeks] = await Promise.all([
    database.get('settings', 'main'),
    database.getAll('locations'),
    database.getAll('tools'),
    database.getAll('weeks'),
  ]);
  return { settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) }, locations, tools, weeks };
}

export async function putSettings(settings: Settings) {
  await (await db()).put('settings', settings, 'main');
}
export async function putLocation(location: WorkLocation) {
  await (await db()).put('locations', location);
}
export async function putTool(tool: Tool) {
  await (await db()).put('tools', tool);
}
export async function removeTool(id: string) {
  await (await db()).delete('tools', id);
}
export async function putWeek(week: WeekRecord) {
  await (await db()).put('weeks', week);
}
export async function removeWeek(id: string) {
  await (await db()).delete('weeks', id);
}

/** Replaces everything in the database with the contents of a backup. */
export async function restoreAll(data: AllData) {
  const database = await db();
  const tx = database.transaction([...STORES], 'readwrite');
  await Promise.all(STORES.map((name) => tx.objectStore(name).clear()));
  await tx.objectStore('settings').put(data.settings, 'main');
  for (const item of data.locations) await tx.objectStore('locations').put(item);
  for (const item of data.tools) await tx.objectStore('tools').put(item);
  for (const item of data.weeks) await tx.objectStore('weeks').put(item);
  await tx.done;
}

export function makeBackup(data: AllData): BackupFile {
  return { app: 'urenstaat', version: 1, exportedAt: new Date().toISOString(), ...data };
}

/** Reads a backup file. Throws an Error with a Dutch message if it is not one. */
export function parseBackup(text: string): AllData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Dit bestand kan niet worden gelezen. Kies een back-up van deze app.');
  }
  const backup = parsed as Partial<BackupFile> | null;
  if (
    !backup ||
    backup.app !== 'urenstaat' ||
    !Array.isArray(backup.locations) ||
    !Array.isArray(backup.tools) ||
    !Array.isArray(backup.weeks)
  ) {
    throw new Error('Dit is geen back-up van deze app.');
  }
  return {
    settings: { ...DEFAULT_SETTINGS, ...(backup.settings ?? {}) },
    locations: backup.locations,
    tools: backup.tools,
    weeks: backup.weeks,
  };
}
