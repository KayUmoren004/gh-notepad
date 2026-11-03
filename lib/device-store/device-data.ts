import { deleteDatabase, type DatabaseOptions } from "./database";
import { openDeviceStore as openStoreOnDevice, type Account, type DeviceStore, type DeviceStoreOptions } from "./store";

/**
 * What an account leaves on a device besides its database: localStorage keys
 * under `notepad:<login>:`, so they can be removed together and never collide
 * with another account's. `login` is matched case-insensitively, as GitHub does.
 */
export function deviceKeyPrefix(login: string): string {
  return `notepad:${login.toLowerCase()}:`;
}

/** A localStorage key scoped to the account: `deviceKey("octo-alice", "sidebar")` is `notepad:octo-alice:sidebar`. */
export function deviceKey(login: string, name: string): string {
  return deviceKeyPrefix(login) + name;
}

/** Removes every key under the account's prefix. Other accounts' keys, and keys outside any prefix, stay. */
export function clearDeviceKeys(login: string, storage: Storage | undefined = defaultStorage()): void {
  if (!storage) return;
  const prefix = deviceKeyPrefix(login);
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // Blocked by the browser's privacy settings.
  }
}

export interface DeviceDataOptions extends DatabaseOptions {
  /** Where the account's device keys live. Default: the browser's localStorage. */
  storage?: Storage;
}

/** The stores this process has open, so removing an account's device data can close them first. */
interface OpenStore {
  store: DeviceStore;
  indexedDB: IDBFactory | undefined;
}
const openStores = new Set<OpenStore>();

const onDevice = (entry: OpenStore, account: Account, options: DatabaseOptions) =>
  entry.store.account.id === account.id && entry.indexedDB === options.indexedDB;

/**
 * Opens the account's device store (see `./store`), keeping track of it so
 * `deleteDeviceData` and `unsyncedNotes` can find the store the app is using.
 */
export async function openDeviceStore(options: DeviceStoreOptions): Promise<DeviceStore> {
  const inner = await openStoreOnDevice(options);
  const entry: OpenStore = { store: inner, indexedDB: options.indexedDB };
  openStores.add(entry);
  const store: DeviceStore = {
    ...inner,
    close: async () => {
      openStores.delete(entry);
      await inner.close();
    },
  };
  entry.store = store;
  return store;
}

/** A note with edits this device hasn't synced to its notebook yet. */
export interface UnsyncedNote {
  id: string;
  title: string;
}

/**
 * The notes on this device whose latest edits haven't reached GitHub, by
 * title: what removing the account's device data would lose. Read from the
 * store the app has open, so an edit made a moment ago counts, or from the
 * device when none is open.
 */
export async function unsyncedNotes(account: Account, options: DatabaseOptions = {}): Promise<UnsyncedNote[]> {
  let store = [...openStores].find((entry) => onDevice(entry, account, options))?.store;
  const opened = !store;
  store ??= await openStoreOnDevice({ account, ...options });
  try {
    return [...store.getState().notes.values()]
      .filter((note) => !note.synced)
      .map(({ id, title }) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }));
  } finally {
    if (opened) await store.close();
  }
}

/**
 * Removes everything the account keeps on this device: its stores are closed,
 * its database deleted and its device keys cleared. Unsynced edits are lost
 * with it; ask `unsyncedNotes` first. Other accounts' data is untouched.
 */
export async function deleteDeviceData(account: Account, options: DeviceDataOptions = {}): Promise<void> {
  for (const entry of [...openStores]) {
    if (onDevice(entry, account, options)) await entry.store.close();
  }
  await deleteDatabase(account.id, options);
  clearDeviceKeys(account.login, options.storage);
}
