// Installs an in-memory IndexedDB on the globals, so device-store code runs in
// the `node` test environment. It must load before any IndexedDB library.
import "fake-indexeddb/auto";
