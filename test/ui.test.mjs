// Tests for the agent screen's instruction parser (src/ui/instructions.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInstruction } from '../src/ui/instructions.js';

const fresh = () => ({
  drums: { auto: true, level: 2, register: 0 },
  bass: { auto: true, level: 2, register: 0 },
  chords: { auto: true, level: 2, register: 0 },
  melody: { auto: true, level: 2, register: 0 },
});
const setFor = (r, role) => r.changes.find((c) => c.role === role)?.set;

test('a named part is targeted, and "some" means less rather than mute', () => {
  const r = parseInstruction('take out some drums', fresh(), ['bass']);
  assert.deepEqual(r.changes.map((c) => c.role), ['drums']);
  assert.deepEqual(setFor(r, 'drums'), { auto: false, level: 1, register: 0 });
});

test('"take out the melody" rests it', () => {
  assert.equal(setFor(parseInstruction('take out the melody', fresh()), 'melody').level, 0);
});

test('no part named: applies to the parts this device plays', () => {
  const r = parseInstruction('busier', fresh(), ['bass']);
  assert.deepEqual(r.changes, [{ role: 'bass', set: { auto: false, level: 3, register: 0 } }]);
});

test('registers stay within what each part allows', () => {
  const a = fresh();
  a.bass.register = 1;
  assert.equal(setFor(parseInstruction('bass higher', a), 'bass').register, 1);
  assert.equal(setFor(parseInstruction('melody higher', fresh()), 'melody').register, 1);
  assert.equal(setFor(parseInstruction('drums higher', fresh()), 'drums').register, 0);
});

test('"let it decide" hands control back to the agent', () => {
  assert.deepEqual(parseInstruction('let it decide', fresh(), ['chords']).changes, [{ role: 'chords', set: { auto: true } }]);
});

test('"bring the melody back" after resting', () => {
  const a = fresh();
  a.melody = { auto: false, level: 0, register: 0 };
  assert.equal(setFor(parseInstruction('bring the melody back', a), 'melody').level, 2);
});

test('stop on its own stops this device; nonsense is reported', () => {
  assert.equal(parseInstruction('stop', fresh()).stop, true);
  assert.equal(parseInstruction('stop the drums', fresh()).stop, false);
  assert.equal(parseInstruction('purple monkey', fresh()).understood, false);
});

test('"build it up" does not move the register', () => {
  const r = parseInstruction('build it up', fresh(), ['melody']);
  assert.deepEqual(setFor(r, 'melody'), { auto: false, level: 3, register: 0 });
});

test('"bring it back" with no part named revives this device\'s parts', () => {
  const a = fresh();
  a.bass = { auto: false, level: 0, register: 0 };
  assert.deepEqual(parseInstruction('bring it back', a, ['bass']).changes, [{ role: 'bass', set: { auto: false, level: 2, register: 0 } }]);
});

test('a part with only one register says so rather than reporting no change', () => {
  assert.match(parseInstruction('drums higher', fresh()).summary, /no register to move/);
  assert.doesNotMatch(parseInstruction('melody higher', fresh()).summary, /no register to move/);
});

test('every suggestion chip in agent.html is understood', () => {
  for (const chip of ['Busier', 'Calm it down', 'Go higher', 'Take a break', 'Let it decide']) {
    assert.equal(parseInstruction(chip, fresh(), ['drums']).understood, true, chip);
  }
});
