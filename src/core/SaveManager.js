/**
 * SaveManager — meta-progression + settings in localStorage.
 * Meta unlocks widen the skill/pet POOL. They never grant raw power, so run 50
 * is still a real fight (the Hades/Slay-the-Spire rule).
 */
const KEY = 'rythmic.save.v1';

const DEFAULT = {
  meta: {
    runs: 0, bestLevel: 0, shards: 0, totalShardsEarned: 0,
    unlockedSkills: [], unlockedPets: ['metro', 'wisp'],
    bestAccuracy: 0, clears: 0,
  },
  settings: {
    musicVol: 0.6, sfxVol: 0.42, keybinds: true,
  },
  run: null,
};

function deepMerge(base, override) {
  const out = { ...base };
  for (const k of Object.keys(override || {})) {
    out[k] = (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k]))
      ? deepMerge(base[k] || {}, override[k])
      : override[k];
  }
  return out;
}

export class SaveManager {
  constructor() { this.data = this.load(); }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT);
      return deepMerge(structuredClone(DEFAULT), JSON.parse(raw));
    } catch {
      return structuredClone(DEFAULT);
    }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); }
    catch { /* private browsing / quota — game still playable, just won't persist */ }
  }

  get meta() { return this.data.meta; }
  get settings() { return this.data.settings; }

  setSetting(key, value) { this.data.settings[key] = value; this.save(); }

  saveRun(runState) { this.data.run = runState.serialize(); this.save(); }
  clearRun() { this.data.run = null; this.save(); }
  hasRun() { return !!this.data.run; }

  /** Shards = how far you got, plus an accuracy bonus. */
  endRun(runState, cleared) {
    const m = this.meta;
    m.runs++;
    const acc = runState.avgAccuracy;
    const baseShards = Math.round(runState.level * 10 + acc * 100 + (cleared ? 250 : 0));
    const lensBonus = Math.max(0, Math.floor(runState.lens || 0));
    const shards = baseShards + lensBonus;
    m.shards += shards;
    m.totalShardsEarned += shards;
    if (runState.level > m.bestLevel) m.bestLevel = runState.level;
    if (acc > m.bestAccuracy) m.bestAccuracy = acc;
    if (cleared) m.clears++;
    this.clearRun();
    this.save();
    return shards;
  }

  unlockSkill(id, cost) {
    if (this.meta.shards < cost || this.meta.unlockedSkills.includes(id)) return false;
    this.meta.shards -= cost;
    this.meta.unlockedSkills.push(id);
    this.save();
    return true;
  }

  unlockPet(id, cost) {
    if (this.meta.shards < cost || this.meta.unlockedPets.includes(id)) return false;
    this.meta.shards -= cost;
    this.meta.unlockedPets.push(id);
    this.save();
    return true;
  }

  reset() { this.data = structuredClone(DEFAULT); this.save(); }
}

export const saveManager = new SaveManager();
