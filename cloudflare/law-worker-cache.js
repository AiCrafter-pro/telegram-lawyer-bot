/** Worker 전역 타이머 없이 공개 법령 자료를 제한된 크기로 보관합니다. */
export class SimpleCache {
    constructor(maxSize = 100) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }
    set(key, data, ttl = 24 * 60 * 60 * 1000) {
        this.cleanup();
        this.cache.delete(key);
        if (this.cache.size >= this.maxSize) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, { data, expiresAt: Date.now() + ttl });
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            this.cache.delete(key);
            return null;
        }
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.data;
    }
    has(key) { return this.get(key) !== null; }
    delete(key) { this.cache.delete(key); }
    clear() { this.cache.clear(); }
    size() { return this.cache.size; }
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(key);
    }
}
export const lawCache = new SimpleCache(500);
