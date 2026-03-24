/* ============================================================
   storage.js — IndexedDB + Cloudflare KV Sync
   ============================================================
   Local-first: IndexedDB handles all reads/writes immediately.
   Cloud sync: writes replicate to Cloudflare KV in the background.
   On startup, pullFromCloud() merges cloud data into local.
   ============================================================ */

const Storage = (() => {
    'use strict';

    // ---- Cloud Config ----
    // Set these after deploying your Worker:
    const WORKER_URL = 'https://scorebook-api.wesyoakum.workers.dev';
    const API_KEY = 'scorebook-7b85055f9ad050ac88614502997a9764';

    function cloudEnabled() {
        return WORKER_URL && API_KEY;
    }

    // ---- IndexedDB (local) ----
    const DB_NAME = 'BaseballScorebook';
    const DB_VERSION = 1;
    const STORES = ['currentGame', 'games', 'teams', 'players'];

    let dbPromise = null;
    let syncing = false;
    let onSyncChange = null; // callback for UI sync indicator

    function open() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                for (const store of STORES) {
                    if (!db.objectStoreNames.contains(store)) {
                        db.createObjectStore(store);
                    }
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    async function getDb() {
        return open();
    }

    // ---- Local put (IndexedDB only, no cloud) ----
    async function localPut(store, key, value) {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // ---- Public put: local + cloud sync ----
    async function put(store, key, value) {
        await localPut(store, key, value);
        syncToCloud(store, key, value); // fire-and-forget
    }

    async function get(store, key) {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async function getAll(store) {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const os = tx.objectStore(store);
            const results = [];
            const cursorReq = os.openCursor();
            cursorReq.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    results.push({ key: cursor.key, value: cursor.value });
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            cursorReq.onerror = () => reject(cursorReq.error);
        });
    }

    // ---- Public del: local + cloud sync ----
    async function del(store, key) {
        const db = await getDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        syncDeleteToCloud(store, key); // fire-and-forget
    }

    async function keys(store) {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function clear(store) {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // ---- Cloud Sync Helpers ----

    function cloudFetch(path, options = {}) {
        if (!cloudEnabled()) return Promise.resolve(null);
        return fetch(WORKER_URL + path, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY,
                ...(options.headers || {})
            }
        }).catch(err => {
            console.warn('Cloud sync failed:', err.message);
            return null;
        });
    }

    function syncToCloud(store, key, value) {
        if (!cloudEnabled()) return;
        cloudFetch(`/kv/${store}/${key}`, {
            method: 'PUT',
            body: JSON.stringify(value)
        });
    }

    function syncDeleteToCloud(store, key) {
        if (!cloudEnabled()) return;
        cloudFetch(`/kv/${store}/${key}`, {
            method: 'DELETE'
        });
    }

    /**
     * Pull all data from cloud and merge into local IndexedDB.
     * Cloud wins when its data has a newer timestamp.
     * Returns true if any local data was updated.
     */
    async function pullFromCloud() {
        if (!cloudEnabled()) return false;

        setSyncing(true);
        let updated = false;

        try {
            for (const store of STORES) {
                const res = await cloudFetch(`/kv/${store}`);
                if (!res || !res.ok) continue;

                const cloudItems = await res.json();
                for (const { key, value: cloudValue } of cloudItems) {
                    if (!cloudValue) continue;

                    const localValue = await get(store, key);

                    if (!localValue) {
                        // Cloud has it, local doesn't — take cloud
                        await localPut(store, key, cloudValue);
                        updated = true;
                    } else {
                        // Both exist — compare timestamps
                        const cloudTime = cloudValue.updatedAt || cloudValue.completedAt || cloudValue.createdAt || '';
                        const localTime = localValue.updatedAt || localValue.completedAt || localValue.createdAt || '';
                        if (cloudTime > localTime) {
                            await localPut(store, key, cloudValue);
                            updated = true;
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('Pull from cloud failed:', err.message);
        }

        setSyncing(false);
        return updated;
    }

    /**
     * Full sync: pull cloud data down, then push any local-only items up.
     */
    async function fullSync() {
        if (!cloudEnabled()) return false;

        setSyncing(true);
        let updated = false;

        try {
            // Pull cloud → local
            updated = await pullFromCloud();

            // Push local → cloud (items that may not be in cloud)
            for (const store of STORES) {
                const res = await cloudFetch(`/kv/${store}`);
                const cloudItems = res && res.ok ? await res.json() : [];
                const cloudKeys = new Set(cloudItems.map(i => i.key));

                const localItems = await getAll(store);
                for (const { key, value } of localItems) {
                    if (!cloudKeys.has(key)) {
                        // Local-only — push to cloud
                        await cloudFetch(`/kv/${store}/${key}`, {
                            method: 'PUT',
                            body: JSON.stringify(value)
                        });
                    }
                }
            }
        } catch (err) {
            console.warn('Full sync failed:', err.message);
        }

        setSyncing(false);
        return updated;
    }

    function setSyncing(val) {
        syncing = val;
        if (onSyncChange) onSyncChange(syncing);
    }

    function isSyncing() {
        return syncing;
    }

    return {
        open, put, get, getAll, del, keys, clear,
        pullFromCloud, fullSync, isSyncing,
        cloudEnabled,
        STORES,
        _workerUrl: WORKER_URL,
        _apiKey: API_KEY,
        set onSyncChange(fn) { onSyncChange = fn; }
    };
})();
