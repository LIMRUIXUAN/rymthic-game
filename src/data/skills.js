/**
 * All 24 skills. Each declares hooks the SkillEngine calls at defined moments,
 * so no skill needs a special case anywhere in the combat code.
 *
 * Hooks available:
 *   onNoteJudged({ judgment, run, enemy })      -> may return { judgment } to override
 *   onDamageDealt({ amount, run, enemy })       -> return modified amount
 *   onDamageTaken({ amount, run, enemy })       -> return modified amount
 *   onPhraseEnd({ phrase, score, run, enemy })
 *   onLethal({ run })                           -> return true to survive
 *   modifyOutgoing({ run, enemy })              -> multiplier
 *   modifyMana({ cost, run })                   -> modified cost
 */

export const SKILL_TYPE = { ACTIVE: 'A', PASSIVE: 'P', TOGGLE: 'T' };

export const SKILLS = [
  {
    id: 'respawn_area', name: 'Respawn Area', type: SKILL_TYPE.ACTIVE, cost: 20,
    desc: 'Drain 15% of CURRENT HP from both the enemy and yourself.',
    long: 'A pure equalizer. Devastating when you are ahead on HP, suicidal when behind.',
    cast: ({ run, enemy, fx }) => {
      const selfLoss = Math.floor(run.hp * 0.15);
      const foeLoss = Math.floor(enemy.hp * 0.15);
      enemy.hp = Math.max(0, enemy.hp - foeLoss);
      if (run.hasSkill('respawn_happier')) {
        run.heal(selfLoss);
        fx?.(`RESPAWN HAPPIER +${selfLoss}`, 0x8bff5e);
      } else {
        run.damage(selfLoss);
        fx?.(`-${selfLoss} / -${foeLoss}`, 0xff9f43);
      }
      return true;
    },
  },
  {
    id: 'respawn_happier', name: 'Respawn Happier', type: SKILL_TYPE.PASSIVE, cost: 0,
    desc: 'LINK: Respawn Area heals you instead of hurting you. Also converts the first 30 damage each phrase into healing.',
    long: 'Useless on its own. The whole point is the pairing.',
    linksWith: 'respawn_area',
    onPhraseEnd: ({ run }) => { run.happierBudget = 30; },
    onDamageTaken: ({ amount, run }) => {
      if (run.happierBudget > 0) {
        const converted = Math.min(amount, run.happierBudget);
        run.happierBudget -= converted;
        run.heal(converted);
        return amount - converted;
      }
      return amount;
    },
  },
  {
    id: 'hurry', name: 'Hurry', type: SKILL_TYPE.TOGGLE, cost: 10,
    desc: 'Step difficulty up one tier. You hit harder, but you take much more.',
    long: 'Offense scales 1.0/1.3/1.6/2.0. Risk scales 1.0/1.45/2.0/2.8. Windows shrink 15% per tier.',
    cast: ({ run, fx }) => {
      if (run.diffTier >= 3) { fx?.('ALREADY FRENZY', 0xff4d6d); return false; }
      run.diffTier++;
      fx?.(`${run.diffName.toUpperCase()}!`, 0xff9f43);
      return true;
    },
  },
  {
    id: 'metronome_heart', name: 'Metronome Heart', type: SKILL_TYPE.PASSIVE, cost: 0,
    desc: 'Every 32 consecutive PERFECTs, heal 8% max HP.',
    onNoteJudged: ({ judgment, run, fx }) => {
      if (judgment.name === 'PERFECT') {
        run.perfectStreak = (run.perfectStreak || 0) + 1;
        if (run.perfectStreak >= 32) {
          run.perfectStreak = 0;
          const h = Math.ceil(run.maxHp * 0.08);
          run.heal(h);
          fx?.(`+${h} HEART`, 0x8bff5e);
        }
      } else run.perfectStreak = 0;
    },
  },
  {
    id: 'second_wind', name: 'Second Wind', type: SKILL_TYPE.PASSIVE, cost: 0,
    desc: 'Once per run: survive a lethal hit at 1 HP.',
    onLethal: ({ run, fx }) => {
      if (run.secondWindUsed) return false;
      run.secondWindUsed = true;
      run.hp = 1;
      run.invulnUntil = performance.now() + 3000;
      fx?.('SECOND WIND!', 0x5ef2ff);
      return true;
    },
  },
  {
    id: 'ghost_note', name: 'Ghost Note', type: SKILL_TYPE.ACTIVE, cost: 15,
    desc: 'Your next 8 misses count as GOOD instead.',
    cast: ({ run, fx }) => { run.ghostCharges = (run.ghostCharges || 0) + 8; fx?.('GHOST x8', 0xa78bfa); return true; },
    onNoteJudged: ({ judgment, run, JUD }) => {
      if (judgment.name === 'MISS' && run.ghostCharges > 0) {
        run.ghostCharges--;
        return { judgment: JUD.GOOD };
      }
    },
  },
  {
    id: 'mirror_shield', name: 'Mirror Shield', type: SKILL_TYPE.ACTIVE, cost: 25,
    desc: 'For one enemy phrase, reflect 40% of blocked damage back.',
    cast: ({ run, fx }) => { run.mirrorPhrases = 1; fx?.('MIRROR', 0x5ef2ff); return true; },
  },
  {
    id: 'overclock', name: 'Overclock', type: SKILL_TYPE.ACTIVE, cost: 30,
    desc: 'Combo multiplier climbs at double rate for 16 beats.',
    cast: ({ run, conductor, fx }) => {
      run.overclockUntil = performance.now() + 16 * (conductor?.msPerBeat || 500);
      fx?.('OVERCLOCK', 0xffe45e); return true;
    },
  },
  {
    id: 'vampire_beat', name: 'Vampire Beat', type: SKILL_TYPE.PASSIVE, cost: 0,
    desc: 'Heal 8% of all damage you deal.',
    onDamageDealt: ({ amount, run }) => { run.heal(amount * 0.08); return amount; },
  },
  {
    id: 'silence', name: 'Silence', type: SKILL_TYPE.ACTIVE, cost: 35,
    desc: 'Disable enemy skills for 2 phrases.',
    cast: ({ run, fx }) => { run.silencePhrases = 2; fx?.('SILENCED', 0x868e96); return true; },
  },
  {
    id: 'half_time', name: 'Half Time', type: SKILL_TYPE.ACTIVE, cost: 40,
    desc: 'Notes approach 40% slower for 8 beats. Your damage drops to 0.7x.',
    long: 'The panic button. Buys you a clean phrase at the cost of output.',
    cast: ({ run, conductor, fx }) => {
      run.halfTimeUntil = performance.now() + 8 * (conductor?.msPerBeat || 500);
      fx?.('HALF TIME', 0x4fd1c5); return true;
    },
    // LevelScene reads run.halfTimeActive each frame and feeds it into the
    // minigame's speedMultiplier. Without that, this skill charged 40 mana to
    // apply nothing but a damage penalty.
    modifyOutgoing: ({ run }) => (run.halfTimeActive ? 0.7 : 1),
  },
  {
    id: 'double_down', name: 'Double Down', type: SKILL_TYPE.PASSIVE, cost: 0,
    desc: 'PERFECTs deal double. MISSes hurt double.',
    onDamageDealt: ({ amount, judgment }) =>
      (judgment && judgment.name === 'PERFECT' ? amount * 2 : amount),
    onDamageTaken: ({ amount }) => amount * 2,
  },
  {
    id: 'pet_feast', name: 'Pet Feast', type: SKILL_TYPE.ACTIVE, cost: 20,
    desc: 'Your pet fires its special immediately, ignoring cooldown.',
    cast: ({ run, enemy, fx }) => {
      if (!run.pet) { fx?.('NO PET', 0xff4d6d); return false; }
      run.petFeastPending = true;   // consumed by LevelScene.consumePetFeast()
      fx?.('PET FEAST', 0x9be15d);
      return true;
    },
  },
  {
    id: 'encore', name: 'Encore', type: SKILL_TYPE.ACTIVE, cost: 50,
    desc: 'Instantly repeat the damage of your last attack phrase.',
    cast: ({ run, enemy, fx }) => {
      const d = run.lastPhraseDamage || 0;
      if (d <= 0) { fx?.('NOTHING TO ENCORE', 0xff4d6d); return false; }
      enemy.hp = Math.max(0, enemy.hp - d);
      fx?.(`ENCORE ${Math.round(d)}`, 0xffd166); return true;
    },
  },
  {
    id: 'bass_drop', name: 'Bass Drop', type: SKILL_TYPE.ACTIVE, cost: 30,
    desc: 'Charge 3 phrases, then hit for 300% ATK ignoring enemy DEF.',
    cast: ({ run, enemy, fx }) => {
      if ((run.bassCharge || 0) < 3) {
        run.bassCharge = (run.bassCharge || 0) + 1;
        fx?.(`CHARGING ${run.bassCharge}/3`, 0x845ef7);
        return true;
      }
      run.bassCharge = 0;
      const dmg = run.atk * 3;
      enemy.hp = Math.max(0, enemy.hp - dmg);
      fx?.(`BASS DROP ${Math.round(dmg)}`, 0xff3860);
      return true;
    },
  },
  {
    id: 'shield_loop', name: 'Shield Loop', type: SKILL_TYPE.PASSIVE, cost: 0,
    desc: 'The first miss of every phrase is negated.',
    onPhraseEnd: ({ run }) => { run.loopUsed = false; },
    onNoteJudged: ({ judgment, run, JUD }) => {
      if (judgment.name === 'MISS' && !run.loopUsed) {
        run.loopUsed = true;
        return { judgment: JUD.GOOD };
      }
    },
  },
  {
    id: 'greed_chord', name: 'Greed Chord', type: SKILL_TYPE.PASSIVE, cost: 0,
    desc: '+25% stat points on level up, but -15% max HP.',
    onAcquire: ({ run }) => {
      run.maxHpPenalty = 0.15;
      run.hp = Math.min(run.hp, run.maxHp);
    },
  },
  {
    id: 'scavenger', name: 'Scavenger', type: SKILL_TYPE.PASSIVE, cost: 0,
    desc: '+1 mana per enemy note spawned, hit or not.',
    onNoteSpawn: ({ run, phraseType }) => {
      if (phraseType === 'enemy') run.addMana(1);
    },
  },
  {
    id: 'tempo_thief', name: 'Tempo Thief', type: SKILL_TYPE.ACTIVE, cost: 25,
    desc: 'Permanently slow the ENEMY phrases for this level. Your own stay fast.',
    long: 'Stacks. Only affects defend phrases, so it is pure survivability with no damage cost.',
    cast: ({ run, fx }) => {
      run.tempoTheft = Math.min(0.6, (run.tempoTheft || 0) + 0.12);
      fx?.(`TEMPO STOLEN +${Math.round(run.tempoTheft * 100)}%`, 0x4c6ef5);
      return true;
    },
  },
  {
    id: 'last_stand', name: 'Last Stand', type: SKILL_TYPE.PASSIVE, cost: 0,
    desc: 'Below 25% HP, your damage is +60%.',
    modifyOutgoing: ({ run }) => (run.hp / run.maxHp < 0.25 ? 1.6 : 1),
  },
  {
    id: 'chorus_echo', name: 'Chorus Echo', type: SKILL_TYPE.PASSIVE, cost: 0,
    desc: 'Every 4th PERFECT strikes twice.',
    onDamageDealt: ({ amount, judgment, run }) => {
      if (judgment && judgment.name === 'PERFECT') {
        run.echoCount = (run.echoCount || 0) + 1;
        if (run.echoCount % 4 === 0) return amount * 2;
      }
      return amount;
    },
  },
  {
    id: 'cold_open', name: 'Cold Open', type: SKILL_TYPE.PASSIVE, cost: 0,
    desc: 'The first phrase of every level has an accuracy floor of 60%.',
    floorsFirstPhrase: true,
  },
  {
    id: 'dissonance', name: 'Dissonance', type: SKILL_TYPE.ACTIVE, cost: 30,
    desc: "Scramble the enemy's own timing — their next phrase hits 30% weaker.",
    cast: ({ run, fx }) => { run.dissonancePhrases = 1; fx?.('DISSONANCE', 0xf06595); return true; },
  },
  {
    id: 'soul_trade', name: 'Soul Trade', type: SKILL_TYPE.PASSIVE, cost: 0,
    desc: 'With no mana, skills spend HP instead at 1 HP = 2 mana.',
    allowsHpCasting: true,
  },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

/** Skills every run starts able to be offered. Others unlock with Shards. */
export const STARTER_POOL = [
  'respawn_area', 'respawn_happier', 'hurry', 'metronome_heart', 'second_wind',
  'ghost_note', 'vampire_beat', 'shield_loop', 'last_stand', 'overclock',
  'half_time', 'mirror_shield', 'chorus_echo', 'scavenger',
];

export const UNLOCKABLE = [
  { id: 'double_down', cost: 200 }, { id: 'bass_drop', cost: 400 },
  { id: 'encore', cost: 450 }, { id: 'silence', cost: 300 },
  { id: 'tempo_thief', cost: 250 }, { id: 'dissonance', cost: 350 },
  { id: 'greed_chord', cost: 300 }, { id: 'soul_trade', cost: 500 },
  { id: 'cold_open', cost: 200 }, { id: 'pet_feast', cost: 250 },
];
