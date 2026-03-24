/* ============================================================
   storage.js — IndexedDB KV Wrapper (Cloudflare KV–compatible)
   ============================================================ */

const Storage = (() => {
    'use strict';

    const DB_NAME = 'BaseballScorebook';
    const DB_VERSION = 1;
    const STORES = ['currentGame', 'games', 'teams', 'players'];

    let dbPromise = null;

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

    async function put(store, key, value) {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
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

    async function del(store, key) {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
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

    return { open, put, get, getAll, del, keys, clear, STORES };
})();
