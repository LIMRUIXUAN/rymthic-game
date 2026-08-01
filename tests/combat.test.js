/**
 * Headless tests. Run with: npm test
 *
 * The point of these is NOT coverage — it is to prove that the JS the player
 * actually runs produces the same numbers as tools/balance_sim.py. It is very
 * easy for a design spreadsheet and a game to quietly drift apart, and then the
 * whole balance table becomes fiction.
 */
import assert from 'node:assert';
import { RunState, DIFF_ATK, DIFF_RISK, stageDamageMultiplier } from '../src/core/RunState.js';
import { CombatResolver, K_OUT, K_IN } from '../src/core/CombatResolver.js';
import { SkillEngine } from '../src/core/SkillEngine.js';
import { judge, JUDGMENTS, windowScale } from '../src/core/Judge.js';
import { SKILLS } from '../src/data/skills.js';
import { makeEnemy, enemyHp, enemyAtk, enemyDef, bpmForLevel } from '../src/data/enemies.js';
import { MusicEngine, SCALES } from '../src/core/MusicEngine.js';
import {
  generateChart, chartNoteCount, notesPerPhrase, phrasePairs, LANES, MIN_GAP_BEATS, TILE_KINDS,
} from '../src/core/ChartGen.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✔ ${name}`); }
  catch (e) { failed++; console.log(`  ✘ ${name}\n      ${e.message}`); }
}
const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ~${b} (tol ${tol})`);

// A run built exactly like balance_sim.py assumes: points split evenly.
function evenBuild(level) {
  const run = new RunState(1234);
  run.level = level;
  const pts = (level - 1) * 3;
  const q = Math.round(pts * 0.25);
  run.points = { hp: q, mana: q, def: q, atk: q };
  run.hp = run.maxHp;
  return run;
}

console.log('\n── damage formula ───────────────────────────────');

test('outgoing damage matches the design formula', () => {
  const run = evenBuild(10);
  const enemy = makeEnemy(10);
  const skills = new SkillEngine(run, { beat: 0 });
  const combat = new CombatResolver(run, enemy, skills, { beat: 0 });

  // Pin the combo multiplier to the sim's assumed 2.5
  Object.defineProperty(run, 'comboMult', { get: () => 2.5 });
  Object.defineProperty(run, 'petMult', { get: () => 1.15 });

  const expected = run.atk * K_OUT * 1.0 * 2.5 * 1.15 * DIFF_ATK[1]
    * stageDamageMultiplier(10)
    * (1 - enemy.def / (enemy.def + 100));
  const before = enemy.hp;
  combat.resolveHeroNote(JUDGMENTS.PERFECT);
  near(before - enemy.hp, expected, 0.001, 'per-note damage');
});

test('incoming damage matches the design formula', () => {
  const run = evenBuild(10);
  const enemy = makeEnemy(10);
  const skills = new SkillEngine(run, { beat: 0 });
  const combat = new CombatResolver(run, enemy, skills, { beat: 0 });

  const expected = enemy.atk * K_IN * DIFF_RISK[1] * stageDamageMultiplier(10)
    * (1 - run.defReduction);
  run.missShieldUsed = true; // C9: the phrase's first miss is absorbed
  const before = run.hp;
  combat.resolveEnemyNote(JUDGMENTS.MISS);
  near(before - run.hp, expected, 0.001, 'per-miss damage');
});

test('blocked notes deal no damage', () => {
  const run = evenBuild(8);
  const enemy = makeEnemy(8);
  const combat = new CombatResolver(run, enemy, new SkillEngine(run, {}), {});
  const before = run.hp;
  combat.resolveEnemyNote(JUDGMENTS.PERFECT);
  assert.strictEqual(run.hp, before);
});

test('stages after 8 scale both damage directions with one transition grace hit', () => {
  assert.strictEqual(stageDamageMultiplier(8), 1);
  assert.ok(stageDamageMultiplier(9) > 1);
  assert.ok(stageDamageMultiplier(20) > stageDamageMultiplier(9));

  const run = evenBuild(9);
  const enemy = makeEnemy(9);
  const combat = new CombatResolver(run, enemy, new SkillEngine(run, {}), {});
  run.missShieldUsed = true;
  run.hp = 1;
  combat.resolveEnemyNote(JUDGMENTS.MISS);
  assert.strictEqual(run.hp, 1, 'the transition grace hit should prevent immediate death');
  assert.strictEqual(run.postStage8GraceUsed, true);
  combat.resolveEnemyNote(JUDGMENTS.MISS);
  assert.strictEqual(run.hp, 0, 'later damage should still be able to kill normally');
});

console.log('\n── C9 soft-punishment buffer ───────────────────');

test('the first miss of each phrase is absorbed, later misses hurt', () => {
  const run = evenBuild(10);
  const enemy = makeEnemy(10);
  const combat = new CombatResolver(run, enemy, new SkillEngine(run, {}), {});
  let shielded = 0;
  combat.onShielded = () => shielded++;

  const before = run.hp;
  combat.resolveEnemyNote(JUDGMENTS.MISS);
  assert.strictEqual(run.hp, before, 'first miss must deal no damage');
  assert.strictEqual(shielded, 1, 'onShielded must fire once');

  combat.resolveEnemyNote(JUDGMENTS.MISS);
  assert.ok(run.hp < before, 'second miss of the phrase must hurt');
  assert.strictEqual(shielded, 1, 'no second shield within the same phrase');

  const after = run.hp;
  run.resetPhraseFlags();
  combat.resolveEnemyNote(JUDGMENTS.MISS);
  assert.strictEqual(run.hp, after, 'the buffer refreshes at phrase end');
  assert.strictEqual(shielded, 2);
});

test('blocked notes never consume the C9 buffer', () => {
  const run = evenBuild(10);
  const enemy = makeEnemy(10);
  const combat = new CombatResolver(run, enemy, new SkillEngine(run, {}), {});
  combat.resolveEnemyNote(JUDGMENTS.PERFECT);
  assert.strictEqual(run.missShieldUsed, false, 'a perfect block must not spend the shield');
});

console.log('\n── enemy table vs balance_sim.py ────────────────');

// Values printed by tools/balance_sim.py. Levels 7 and 15 are the ones where
// Python's banker's rounding used to disagree with JS Math.round — this table
// is the JS (i.e. actual game) truth, and the simulator was corrected to match.
const EXPECTED_HP = {
  1: 360, 2: 430, 3: 470, 4: 490, 5: 580, 6: 800, 7: 900, 8: 880,
  9: 980, 10: 1140, 11: 1130, 12: 1150, 13: 1260, 14: 1310, 15: 1520,
  16: 1730, 17: 1860, 18: 2000, 19: 2060, 20: 2270,
};

test('enemy HP curve matches the simulation exactly', () => {
  for (let lv = 1; lv <= 20; lv++) {
    assert.strictEqual(enemyHp(lv), EXPECTED_HP[lv],
      `level ${lv} HP: got ${enemyHp(lv)}, sim says ${EXPECTED_HP[lv]}`);
  }
});

test('boss levels are meaningfully harder', () => {
  for (const lv of [5, 10, 15, 20]) {
    assert.ok(enemyAtk(lv) > enemyAtk(lv - 1) * 1.3, `boss ${lv} ATK spike`);
    assert.ok(enemyDef(lv) >= enemyDef(lv - 1) + 20, `boss ${lv} DEF bonus`);
  }
});

console.log('\n── difficulty must be a real trade-off ──────────');

test('offense-per-risk FALLS as difficulty rises', () => {
  // If this ever inverts, max difficulty becomes strictly correct and the
  // Hurry skill stops being a decision. This is the bug I shipped in the
  // first draft of the design doc.
  const ratios = DIFF_ATK.map((atk, i) => (0.90 * atk) / (0.10 * DIFF_RISK[i]));
  for (let i = 0; i < ratios.length - 1; i++) {
    assert.ok(ratios[i] > ratios[i + 1],
      `tier ${i} ratio ${ratios[i].toFixed(2)} must exceed tier ${i + 1} ${ratios[i + 1].toFixed(2)}`);
  }
});

test('timing windows tighten with difficulty', () => {
  assert.ok(windowScale(2) < windowScale(1));
  assert.ok(windowScale(3) < windowScale(2));
  // A hit that is PERFECT on Normal can drop to GREAT on Frenzy
  assert.strictEqual(judge(44, 1).name, 'PERFECT');
  assert.strictEqual(judge(44, 3).name, 'GREAT');
});

console.log('\n── judgments ────────────────────────────────────');

test('judgment windows are correct at Normal', () => {
  assert.strictEqual(judge(0, 1).name, 'PERFECT');
  assert.strictEqual(judge(-44, 1).name, 'PERFECT');
  assert.strictEqual(judge(70, 1).name, 'GREAT');
  assert.strictEqual(judge(120, 1).name, 'GOOD');
  assert.strictEqual(judge(500, 1).name, 'MISS');
});

console.log('\n── charts ───────────────────────────────────────');

test('note counts match the balance model', () => {
  for (const lv of [1, 10, 20]) {
    const chart = generateChart(lv);
    const perPhrase = notesPerPhrase(lv);
    const phrases = phrasePairs(lv) * 2;
    assert.strictEqual(chart.phrases.length, phrases, `level ${lv} phrase count`);
    // Chaotic patterns can collide on the same beat+lane and get deduped,
    // so allow a small shortfall but never an overshoot.
    const total = chartNoteCount(chart);
    const target = perPhrase * phrases;
    assert.ok(total <= target, `level ${lv}: ${total} notes must not exceed ${target}`);
    assert.ok(total > target * 0.75, `level ${lv}: ${total} notes is too far under ${target}`);
  }
});

test('phrases alternate enemy then hero', () => {
  const chart = generateChart(7);
  chart.phrases.forEach((p, i) => {
    assert.strictEqual(p.type, i % 2 === 0 ? 'enemy' : 'hero', `phrase ${i}`);
  });
});

test('charts are deterministic', () => {
  const a = JSON.stringify(generateChart(12));
  const b = JSON.stringify(generateChart(12));
  assert.strictEqual(a, b, 'same level must generate the same chart');
});

test('notes never fall outside their phrase', () => {
  for (let lv = 1; lv <= 20; lv++) {
    for (const p of generateChart(lv).phrases) {
      for (const n of p.notes) {
        assert.ok(n.beat >= 0 && n.beat < p.lengthBeats,
          `lv${lv} note at beat ${n.beat} outside 0..${p.lengthBeats}`);
        assert.ok(n.lane >= 0 && n.lane < LANES,
          `lv${lv} lane ${n.lane} outside 0..${LANES - 1}`);
        assert.ok(Number.isInteger(n.lane), `lv${lv} lane ${n.lane} must be an integer`);
      }
    }
  }
});

test('charts keep one score target, with explicit Trap hazard pairs', () => {
  // There is one ball and one scoreable lane at any moment. The only allowed
  // same-beat pair is a Trap hazard beside its safe normal target.
  for (let lv = 1; lv <= 20; lv++) {
    for (const phrase of generateChart(lv).phrases) {
      const byBeat = new Map();
      for (const n of phrase.notes) {
        if (!byBeat.has(n.beat)) byBeat.set(n.beat, []);
        byBeat.get(n.beat).push(n);
      }
      for (const [beat, notes] of byBeat) {
        if (notes.length === 1) continue;
        assert.strictEqual(notes.length, 2,
          `lv${lv} phrase ${phrase.index}: beat ${beat} has too many tiles`);
        assert.notStrictEqual(notes[0].lane, notes[1].lane,
          `lv${lv} phrase ${phrase.index}: same-column duplicate at beat ${beat}`);
        assert.ok(notes.some((n) => n.kind === TILE_KINDS.TRAP)
          && notes.some((n) => n.kind === TILE_KINDS.NORMAL),
        `lv${lv} phrase ${phrase.index}: same-beat pair must be Trap + normal`);
      }
    }
  }
});

test('no two tiles are close enough to overlap on screen', () => {
  // A tile spans +/-0.05 in depth over a 4-beat approach window, so anything
  // closer than 0.4 beats renders as two slabs on top of each other. That is
  // what "duplicate tiles" looked like.
  for (let lv = 1; lv <= 20; lv++) {
    for (const phrase of generateChart(lv).phrases) {
      const s = [...phrase.notes].sort((a, b) => a.beat - b.beat);
      for (let i = 1; i < s.length; i++) {
        const gap = s[i].beat - s[i - 1].beat;
        if (gap === 0) {
          assert.ok(s[i - 1].kind === TILE_KINDS.NORMAL || s[i].kind === TILE_KINDS.NORMAL,
            `lv${lv}: same-beat overlap must include the safe normal tile`);
          continue;
        }
        assert.ok(gap >= MIN_GAP_BEATS - 1e-9,
          `lv${lv}: gap of ${gap.toFixed(3)} beats is below the ${MIN_GAP_BEATS} minimum`);
      }
    }
  }
});

test('every lane change is physically reachable in the time given', () => {
  // The ball has to travel. A two-lane jump inside half a beat is not playable
  // no matter how good you are.
  for (let lv = 1; lv <= 20; lv++) {
    for (const phrase of generateChart(lv).phrases) {
      // Trap lanes are avoid targets; only scoreable notes define the path the
      // ball must physically travel between.
      const s = phrase.notes.filter((n) => n.kind !== TILE_KINDS.TRAP)
        .sort((a, b) => a.beat - b.beat);
      for (let i = 1; i < s.length; i++) {
        const gap = s[i].beat - s[i - 1].beat;
        const jump = Math.abs(s[i].lane - s[i - 1].lane);
        const maxJump = gap >= 1.0 ? LANES - 1 : gap >= 0.75 ? 2 : 1;
        assert.ok(jump <= maxJump,
          `lv${lv}: ${jump}-lane jump in ${gap.toFixed(2)} beats (max ${maxJump})`);
      }
    }
  }
});

test('note density never exceeds what the minimum gap allows', () => {
  for (let lv = 1; lv <= 20; lv++) {
    const ceiling = Math.floor(16 / MIN_GAP_BEATS);   // 16 beats per phrase
    assert.ok(notesPerPhrase(lv) <= ceiling,
      `lv${lv} asks for ${notesPerPhrase(lv)} notes but only ${ceiling} fit`);
  }
});

test('minigame switches at level 11', () => {
  assert.strictEqual(generateChart(10).minigame, 'ballhop');
  assert.strictEqual(generateChart(11).minigame, 'osu');
});

test('Ball Hop variants unlock progressively and remain sparse', () => {
  const kinds = (level) => generateChart(level).phrases.flatMap((p) => p.notes.map((n) => n.kind));
  assert.ok(kinds(1).every((k) => k === TILE_KINDS.NORMAL));
  assert.ok(kinds(2).every((k) => k === TILE_KINDS.NORMAL));
  assert.ok(kinds(3).includes(TILE_KINDS.BOOST), 'Level 3 should introduce Boost');
  assert.ok(!kinds(3).includes(TILE_KINDS.TRAP), 'Trap should wait until Level 4');
  assert.ok(kinds(4).includes(TILE_KINDS.TRAP), 'Level 4 should introduce Trap');
  const level3 = generateChart(3).phrases.flatMap((p) => p.notes);
  const boostRate = level3.filter((n) => n.kind === TILE_KINDS.BOOST).length
    / level3.filter((n) => n.kind !== TILE_KINDS.TRAP).length;
  assert.ok(boostRate <= 0.10, `Boost should stay rare, got ${(boostRate * 100).toFixed(1)}%`);
  for (const level of [3, 4, 5, 10]) {
    for (const phrase of generateChart(level).phrases) {
      const notes = phrase.notes.filter((n) => n.kind !== TILE_KINDS.NORMAL);
      for (let i = 1; i < notes.length; i++) {
        assert.ok(notes[i].beat - notes[i - 1].beat >= 2.0,
          `lv${level} special platforms need 2 beats of visual breathing room`);
      }
      for (const trap of phrase.notes.filter((n) => n.kind === TILE_KINDS.TRAP)) {
        const pair = phrase.notes.find((n) => n.trapPair === trap.trapPair
          && n.kind === TILE_KINDS.NORMAL);
        assert.ok(pair, `lv${level}: every Trap needs a safe paired tile`);
        assert.strictEqual(pair.beat, trap.beat, 'Trap pair must land together');
        assert.notStrictEqual(pair.lane, trap.lane, 'Trap pair cannot share a column');
      }
    }
  }
  assert.ok(kinds(11).every((k) => k === TILE_KINDS.NORMAL),
    'Osu levels should not carry Ball Hop platform variants');
});

console.log('\n── skills ───────────────────────────────────────');

test('Respawn Happier converts Respawn Area self-damage into healing', () => {
  const run = evenBuild(10);
  const enemy = makeEnemy(10);
  const skills = new SkillEngine(run, { beat: 0 });
  run.addSkill('respawn_area');
  run.addSkill('respawn_happier');
  run.hp = run.maxHp * 0.5;
  run.mana = run.maxMana;
  const hpBefore = run.hp, enemyBefore = enemy.hp;

  skills.cast('respawn_area', enemy);
  assert.ok(run.hp > hpBefore, 'linked: should HEAL, not hurt');
  assert.ok(enemy.hp < enemyBefore, 'enemy should still take damage');
});

test('Respawn Area alone hurts you', () => {
  const run = evenBuild(10);
  const enemy = makeEnemy(10);
  const skills = new SkillEngine(run, { beat: 0 });
  run.addSkill('respawn_area');
  run.mana = run.maxMana;
  const hpBefore = run.hp;
  skills.cast('respawn_area', enemy);
  assert.ok(run.hp < hpBefore, 'unlinked: should cost HP');
});

test('Second Wind prevents exactly one death', () => {
  const run = evenBuild(10);
  const skills = new SkillEngine(run, {});
  run.addSkill('second_wind');
  run.hp = 5;
  run.damage(9999);
  assert.strictEqual(run.hp, 0);
  assert.ok(skills.tryPreventDeath(), 'first death should be prevented');
  assert.strictEqual(run.hp, 1);
  run.invulnUntil = 0;
  run.damage(9999);
  assert.ok(!skills.tryPreventDeath(), 'second death must stick');
});

test('Shield Loop negates the first miss of a phrase', () => {
  const run = evenBuild(10);
  const skills = new SkillEngine(run, {});
  run.addSkill('shield_loop');
  run.loopUsed = false;
  assert.strictEqual(skills.filterJudgment(JUDGMENTS.MISS).name, 'GOOD');
  assert.strictEqual(skills.filterJudgment(JUDGMENTS.MISS).name, 'MISS');
});

test('loadout is capped at 10', () => {
  const run = evenBuild(20);
  const ids = ['respawn_area', 'respawn_happier', 'hurry', 'metronome_heart',
    'second_wind', 'ghost_note', 'mirror_shield', 'overclock', 'vampire_beat',
    'silence', 'half_time'];
  ids.forEach((id) => run.addSkill(id));
  assert.strictEqual(run.skills.length, 10, 'must not exceed 10 skills');
});

test('casting without mana fails cleanly', () => {
  const run = evenBuild(5);
  const enemy = makeEnemy(5);
  const skills = new SkillEngine(run, { beat: 0 });
  run.addSkill('silence');
  run.mana = 0;
  const r = skills.cast('silence', enemy);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'mana');
});

console.log('\n── skills that were silently doing nothing ──────');

// Every skill below shipped as a no-op in the first build: the flag was written
// and nothing ever read it. Each test asserts a MEASURABLE state change, so a
// skill can never quietly become decorative again.

test('Overclock actually speeds up combo growth', () => {
  const run = evenBuild(10);
  const skills = new SkillEngine(run, { beat: 0, msPerBeat: 500 });
  run.addSkill('overclock');
  run.mana = run.maxMana;
  run.combo = 24;

  const before = run.comboMult;
  assert.ok(skills.cast('overclock', makeEnemy(10)).ok);
  assert.ok(run.overclockActive, 'overclock should be active after casting');
  assert.ok(run.comboMult > before,
    `combo multiplier should rise at the same combo (${before} -> ${run.comboMult})`);
});

test('Half Time is readable as active state, not just a damage penalty', () => {
  const run = evenBuild(10);
  const skills = new SkillEngine(run, { beat: 0, msPerBeat: 500 });
  run.addSkill('half_time');
  run.mana = run.maxMana;

  assert.ok(!run.halfTimeActive);
  assert.ok(skills.cast('half_time', makeEnemy(10)).ok);
  assert.ok(run.halfTimeActive,
    'LevelScene reads halfTimeActive to slow the notes — without it the skill ' +
    'only applied its own 0.7x damage penalty, making it strictly harmful');
  assert.strictEqual(skills.outgoingMultiplier(makeEnemy(10)), 0.7);
});

test('Tempo Thief accumulates and is capped', () => {
  const run = evenBuild(10);
  const skills = new SkillEngine(run, { beat: 0 });
  run.addSkill('tempo_thief');
  run.mana = 10000;
  for (let i = 0; i < 10; i++) skills.cast('tempo_thief', makeEnemy(10));
  assert.ok(run.tempoTheft > 0, 'must record stolen tempo');
  assert.ok(run.tempoTheft <= 0.6, `must cap (got ${run.tempoTheft})`);
});

test('Pet Feast flags a pending special, and fails without a pet', () => {
  const run = evenBuild(10);
  const skills = new SkillEngine(run, { beat: 0 });
  run.addSkill('pet_feast');
  run.mana = run.maxMana;

  assert.ok(!skills.cast('pet_feast', makeEnemy(10)).ok, 'no pet: must fail');
  assert.ok(!run.petFeastPending);

  run.pet = { id: 'wisp', level: 1 };
  assert.ok(skills.cast('pet_feast', makeEnemy(10)).ok);
  assert.ok(run.petFeastPending, 'LevelScene.consumePetFeast() reads this');
});

test('no skill writes a run flag that nothing ever reads', () => {
  // Guard against the whole class of bug above. Cast every active skill and
  // confirm it changed *something* observable on the run or the enemy.
  const IGNORE = new Set(['mana', 'combo', 'accuracyHistory', 'curseNext']);
  for (const sk of SKILLS.filter((s) => s.cast)) {
    const run = evenBuild(14);
    run.pet = { id: 'cinder', level: 2 };
    run.addSkill(sk.id);
    if (sk.id === 'encore') run.lastPhraseDamage = 100;
    run.mana = 10000;
    const enemy = makeEnemy(14);
    const skills = new SkillEngine(run, { beat: 0, msPerBeat: 500 });

    const snapRun = JSON.stringify(run.serialize());
    const snapFlags = JSON.stringify([
      run.overclockUntil, run.halfTimeUntil, run.tempoTheft, run.petFeastPending,
      run.ghostCharges, run.mirrorPhrases, run.silencePhrases, run.dissonancePhrases,
      run.bassCharge, run.diffTier, run.hp,
    ]);
    const snapEnemy = enemy.hp;

    skills.cast(sk.id, enemy);

    const changed = JSON.stringify(run.serialize()) !== snapRun
      || JSON.stringify([
        run.overclockUntil, run.halfTimeUntil, run.tempoTheft, run.petFeastPending,
        run.ghostCharges, run.mirrorPhrases, run.silencePhrases, run.dissonancePhrases,
        run.bassCharge, run.diffTier, run.hp,
      ]) !== snapFlags
      || enemy.hp !== snapEnemy;

    assert.ok(changed, `${sk.id} cast successfully but changed no observable state`);
  }
});

console.log('\n── difficulty tiers ─────────────────────────────');

test('Chill is genuinely more forgiving than Normal', () => {
  // These were identical in the first build: pow(0.85, max(0, tier-1)) gives
  // 1.0 for both tier 0 and tier 1.
  assert.ok(windowScale(0) > windowScale(1),
    `Chill window (${windowScale(0)}) must exceed Normal (${windowScale(1)})`);
  // A hit that misses the PERFECT window on Normal should land it on Chill
  assert.strictEqual(judge(52, 1).name, 'GREAT');
  assert.strictEqual(judge(52, 0).name, 'PERFECT');
});

test('windows shrink monotonically across all four tiers', () => {
  for (let t = 0; t < 3; t++) {
    assert.ok(windowScale(t) > windowScale(t + 1),
      `tier ${t} must be more forgiving than tier ${t + 1}`);
  }
});

console.log('\n── audio: hit sounds must be musical, not noise ──');

test('every hit note lands in the current song\'s key', () => {
  // Hit sounds fire ~30 times a phrase. A fixed-frequency blip is dissonant
  // against whatever the music is playing, and that dissonance is relentless.
  // Notes drawn from the song's own scale just sound like part of the track.
  for (const level of [1, 5, 12, 20]) {
    const song = MusicEngine.makeSong(level);
    const scale = SCALES[song.scale];
    assert.ok(scale, `level ${level} uses a real scale (${song.scale})`);

    for (let combo = 0; combo <= 80; combo += 4) {
      const step = Math.floor(combo / 4) % 14;
      const idx = ((step % scale.length) + scale.length) % scale.length;
      const oct = Math.floor(step / scale.length);
      const midi = song.root + scale[idx] + (2 + oct) * 12;

      const semitoneFromRoot = ((midi - song.root) % 12 + 12) % 12;
      assert.ok(scale.includes(semitoneFromRoot),
        `lv${level} combo ${combo}: semitone ${semitoneFromRoot} is not in ${song.scale}`);
    }
  }
});

test('hit pitch climbs with combo, then wraps instead of running away', () => {
  const steps = [];
  for (let combo = 0; combo <= 200; combo += 4) steps.push(Math.floor(combo / 4) % 14);
  // Rises for the first stretch...
  for (let i = 1; i < 14; i++) {
    assert.ok(steps[i] > steps[i - 1], 'pitch should climb with combo');
  }
  // ...and never exceeds ~2 octaves of scale degrees.
  assert.ok(Math.max(...steps) < 14, 'must wrap rather than climb forever');
});

test('song tempo matches the level BPM exactly', () => {
  // The backing track and the chart have to be driven by the same number, or
  // the music drifts away from the notes.
  for (let lv = 1; lv <= 20; lv++) {
    assert.strictEqual(MusicEngine.makeSong(lv).bpm, bpmForLevel(lv),
      `level ${lv}: song BPM must equal the chart BPM`);
  }
});

console.log('\n── stat system ──────────────────────────────────');

test('defense reduction has diminishing returns and never reaches 1', () => {
  const run = evenBuild(20);
  run.points.def = 1000;
  assert.ok(run.defReduction < 1, 'must never reach full immunity');
  assert.ok(run.defReduction > 0.9, 'but should get close at absurd investment');
});

test('spending an HP point grants the HP, not just the ceiling', () => {
  const run = evenBuild(5);
  run.unspentPoints = 1;
  const hpBefore = run.hp, maxBefore = run.maxHp;
  run.spendPoint('hp');
  assert.strictEqual(run.maxHp, maxBefore + 12);
  assert.strictEqual(run.hp, hpBefore + 12, 'current HP should rise too');
});

test('Attack points roll a persistent +2 or +3 gain', () => {
  const run = evenBuild(1);
  run.unspentPoints = 1;
  const before = run.atk;
  assert.ok(run.spendPoint('atk'));
  assert.ok([2, 3].includes(run.atk - before), `attack gain should be +2 or +3, got ${run.atk - before}`);

  const restored = RunState.deserialize(run.serialize());
  assert.strictEqual(restored.atk, run.atk, 'attack rolls must survive serialization');
});

test('combo multiplier caps at 4x', () => {
  const run = evenBuild(10);
  run.combo = 100000;
  assert.strictEqual(run.comboMult, 4.0);
});

test('run serialises and restores', () => {
  const run = evenBuild(9);
  run.addSkill('vampire_beat');
  run.pet = { id: 'cinder', level: 3 };
  run.hp = 55;
  run.lens = 7;
  const restored = RunState.deserialize(JSON.parse(JSON.stringify(run.serialize())));
  assert.strictEqual(restored.level, 9);
  assert.strictEqual(restored.hp, 55);
  assert.deepStrictEqual(restored.skills, ['vampire_beat']);
  assert.strictEqual(restored.pet.id, 'cinder');
  assert.strictEqual(restored.lens, 7);
  assert.strictEqual(restored.atk, run.atk);
});

console.log('\n── full-level simulation ────────────────────────');

/** Play a whole level at a fixed accuracy and report the outcome. */
function simulateLevel(level, accuracy) {
  const run = evenBuild(level);
  const enemy = makeEnemy(level);
  const skills = new SkillEngine(run, { beat: 0 });
  const combat = new CombatResolver(run, enemy, skills, { beat: 0 });
  Object.defineProperty(run, 'petMult', { get: () => 1.15 });
  Object.defineProperty(run, 'comboMult', { get: () => 2.5 });

  const chart = generateChart(level);
  // Bresenham-style miss distribution. An earlier version used `i % 100 < acc*100`,
  // which silently produced ZERO misses whenever a phrase had fewer than 100 notes
  // — so every late-game test "passed" at full HP. Spread the misses evenly instead.
  let debt = 0;
  const missRate = 1 - accuracy;
  for (const phrase of chart.phrases) {
    for (let i = 0; i < phrase.notes.length; i++) {
      debt += missRate;
      let j = JUDGMENTS.PERFECT;
      if (debt >= 1) { debt -= 1; j = JUDGMENTS.MISS; }
      if (phrase.type === 'hero') combat.resolveHeroNote(j);
      else combat.resolveEnemyNote(j);
    }
    // C9 soft buffer resets per phrase, exactly like the real game's endPhrase.
    run.resetPhraseFlags();
  }
  return {
    enemyKilled: enemy.hp <= 0,
    enemyHpPct: enemy.hp / enemy.maxHp,
    heroAlive: run.hp > 0,
    heroHpPct: run.hp / run.maxHp,
  };
}

test('a 90% player clears normal levels but is pressured by bosses', () => {
  for (const lv of [1, 3, 7, 12, 18]) {
    const r = simulateLevel(lv, 0.90);
    assert.ok(r.enemyKilled, `level ${lv} should die to a 90% player`);
    assert.ok(r.heroAlive, `hero should survive level ${lv} at 90%`);
  }
});

test('80% accuracy remains dangerous in the late game', () => {
  const late = simulateLevel(19, 0.80);
  const final = simulateLevel(20, 0.80);
  assert.ok(!final.heroAlive,
    `an 80% player must not clear the final boss (got ${(final.heroHpPct * 100).toFixed(0)}% HP)`);
  assert.ok(!late.heroAlive || late.heroHpPct < 0.3,
    `an 80% player should be nearly dead by level 19 (got ${(late.heroHpPct * 100).toFixed(0)}% HP)`);
});

test('the final boss is a genuine wall at 90% and beatable at 95%', () => {
  const at90 = simulateLevel(20, 0.90);
  const at95 = simulateLevel(20, 0.95);
  assert.ok(at90.heroAlive && at90.heroHpPct < 0.6,
    `level 20 at 90% should be tense but winnable (got ${(at90.heroHpPct * 100).toFixed(0)}% HP)`);
  assert.ok(at95.heroAlive, 'level 20 at 95% must be survivable');
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
