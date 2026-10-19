import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTextEdits, revision } from '../plugins/pages-native/src/text-edits.mjs';
const snapshot = characters => ({ characters, text: characters.join('') });
test('native character ranges preserve emoji/combining sequences and use 1-based indices', () => {
  const s = snapshot(['A', '👩🏽‍💻', 'e\u0301', 'Z']);
  const p = planTextEdits(s, [{ kind: 'range', start: 2, delete_count: 2, text: '新' }]);
  assert.equal(p.after, 'A新Z'); assert.deepEqual(p.edits, [{ start: 2, delete_count: 2, text: '新' }]);
});
test('literal matching refuses a partial native character', () => {
  assert.throws(() => planTextEdits(snapshot(['e\u0301']), [{ kind: 'replace', find: 'e', replacement: 'a' }]), e => e.code === 'TEXT_BOUNDARY');
});
test('replacements are planned in reverse native order without stale offsets', () => {
  const p = planTextEdits(snapshot([...('old / old')]), [{ kind: 'replace', find: 'old', replacement: 'longer', occurrence: 'all', expected_count: 2 }]);
  assert.equal(p.after, 'longer / longer'); assert.deepEqual(p.edits.map(x => x.start), [7, 1]);
});
test('exact literal counts and occurrences prevent unintended broad edits', () => {
  const s = snapshot([...('x x')]);
  assert.throws(() => planTextEdits(s, [{ kind: 'replace', find: 'x', replacement: 'z', expected_count: 1 }]), e => e.code === 'MATCH_COUNT');
  assert.throws(() => planTextEdits(s, [{ kind: 'replace', find: 'x', replacement: 'z', occurrence: 3 }]), e => e.code === 'MATCH_COUNT');
  assert.throws(() => planTextEdits(s, [{ kind: 'replace', find: 'X', replacement: 'z' }]), e => e.code === 'TEXT_NOT_FOUND');
});
test('overlapping edits and colliding insertions fail before mutation', () => {
  const s = snapshot([...('abc')]);
  for (const operations of [[{ kind: 'range', start: 1, delete_count: 2, text: '' }, { kind: 'range', start: 2, delete_count: 0, text: 'x' }], [{ kind: 'range', start: 2, delete_count: 0, text: 'x' }, { kind: 'range', start: 2, delete_count: 0, text: 'y' }]]) assert.throws(() => planTextEdits(s, operations), e => e.code === 'OVERLAPPING_EDITS');
});
test('prepend, append, empty document and deletion have precise boundaries', () => {
  assert.equal(planTextEdits(snapshot(['a']), [{ kind: 'range', start: 1, delete_count: 0, text: 'X' }, { kind: 'range', start: 2, delete_count: 0, text: 'Z' }]).after, 'XaZ');
  assert.equal(planTextEdits(snapshot([]), [{ kind: 'range', start: 1, delete_count: 0, text: 'A' }]).after, 'A');
  assert.equal(planTextEdits(snapshot(['a']), [{ kind: 'range', start: 1, delete_count: 1, text: '' }]).after, '');
  assert.throws(() => planTextEdits(snapshot(['a']), [{ kind: 'range', start: 2, delete_count: 1, text: '' }]), e => e.code === 'TEXT_RANGE');
});
test('untrusted native character maps and excessive matches are rejected', () => {
  assert.throws(() => planTextEdits({ text: 'a', characters: ['b'] }, []), e => e.code === 'NATIVE_CHARACTER_MAP');
  assert.throws(() => planTextEdits(snapshot(Array(201).fill('x')), [{ kind: 'replace', find: 'x', replacement: '', occurrence: 'all' }]), e => e.code === 'EDIT_LIMIT');
});

test('revision guards ignore native dictionary key order while retaining array/content order', () => {
  assert.equal(revision({ snapshot: { text: 'ab', characters: ['a', 'b'] }, target: { kind: 'body' } }), revision({ target: { kind: 'body' }, snapshot: { characters: ['a', 'b'], text: 'ab' } }));
  assert.notEqual(revision({ characters: ['a', 'b'] }), revision({ characters: ['b', 'a'] }));
});
