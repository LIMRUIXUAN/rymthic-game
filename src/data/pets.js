/** Pets: a passive damage multiplier plus a beat-timed special on cooldown. */

export const PETS = [
  {
    id: 'metro', name: 'Metro', species: 'metronome slime', color: 0x5ef2ff,
    mult: 0.10, desc: '+10% damage. Flashes the timing of the next 4 notes.',
    special: 'highlight',
  },
  {
    id: 'kicker', name: 'Kicker', species: 'drum beetle', color: 0xff9f43,
    mult: 0.15, desc: '+15% damage. Auto-hits one note per phrase as PERFECT.',
    special: 'autohit',
  },
  {
    id: 'wisp', name: 'Wisp', species: 'mana moth', color: 0xa78bfa,
    mult: 0.05, desc: '+5% damage. Grants +2 mana every 8 beats.',
    special: 'mana',
  },
  {
    id: 'fang', name: 'Fang', species: 'bass hound', color: 0xff3860,
    mult: 0.20, desc: '+20% damage, but -10% of your defense. Glass cannon.',
    special: 'none', defPenalty: 0.10,
  },
  {
    id: 'cinder', name: 'Cinder', species: 'fire canary', color: 0xffd166,
    mult: 0.10, desc: '+10% damage. Burns 2% of enemy max HP each phrase.',
    special: 'burn',
  },
  {
    id: 'echo', name: 'Echo', species: 'mirror cat', color: 0x9be15d,
    mult: 0.12, desc: '+12% damage. 10% chance to repeat your last hit.',
    special: 'echo',
  },
];

export const PET_BY_ID = Object.fromEntries(PETS.map((p) => [p.id, p]));

/** Pets gain +0.05 multiplier per level, to level 5. */
export function petMultiplier(pet) {
  if (!pet) return 1.0;
  const base = PET_BY_ID[pet.id];
  if (!base) return 1.0;
  return 1.0 + base.mult + (pet.level - 1) * 0.05;
}

export const PET_LEVELS = [3, 8, 13, 18]; // levels where a pet is offered
