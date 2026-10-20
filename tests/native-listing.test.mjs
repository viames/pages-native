import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('listing documents and template preflights never paginate unrelated open documents', () => {
  let paginationReads = 0;
  const document = { id: () => 'large-user-document', name: () => 'Existing document', file: () => null, modified: () => false, documentBody: () => true };
  for (const key of ['pages', 'sections']) Object.defineProperty(document, key, { get() { paginationReads++; throw new Error('Unrelated pagination must not be requested.'); } });
  const app = { running: () => true, documents: () => [document] };
  const code = readFileSync(new URL('../plugins/pages-native/native/worker.js', import.meta.url), 'utf8');
  const result = runInNewContext(code + '\nresolveApp = function(){return "Pages.app";}; execute("documents", {});', { ObjC: { import() {} }, Application: () => app });
  assert.equal(result.documents.length, 1); assert.equal(result.documents[0].document_id, 'large-user-document');
  assert.equal(paginationReads, 0); assert.equal(result.documents[0].page_count, undefined);
});

test('open, save and close return document identity without forcing immediate pagination', () => {
  const document = { id: () => 'target', name: () => 'Native copy', file: () => null, modified: () => false, documentBody: () => true };
  for (const key of ['pages', 'sections']) Object.defineProperty(document, key, { get() { throw new Error('Pagination belongs to explicit inspection.'); } });
  const app = { running: () => true, documents: () => [document], open: () => document, save() {}, close() {} };
  const code = readFileSync(new URL('../plugins/pages-native/native/worker.js', import.meta.url), 'utf8');
  for (const action of ['open', 'save', 'close']) {
    const context = { ObjC: { import() {} }, Application: () => app, Path: value => value, action };
    const result = runInNewContext(code + '\nresolveApp = function(){return "Pages.app";}; execute(action, {document_id:"target",path:"fixture.pages",save:false});', context);
    assert.equal(result.document_id, 'target'); assert.equal(result.page_count, undefined);
  }
});

test('native search inventory avoids pagination by default and validates explicit indices', () => {
  const document = { id: () => 'd', documentBody: () => true, textItems: [], shapes: [], tables: [] };
  // JXA collections are callable arrays; ordinary arrays suffice for discovery.
  document.textItems = []; document.shapes = []; document.tables = [];
  for (const key of ['pages', 'sections']) Object.defineProperty(document, key, { get() { throw new Error('Unrequested pagination.'); } });
  const code = readFileSync(new URL('../plugins/pages-native/native/worker.js', import.meta.url), 'utf8');
  const context = { ObjC: { import() {} }, document, args: { scopes: ['body', 'text', 'shape'] } };
  const result = runInNewContext(code + '\nsearchInventory(document,args);', context);
  assert.equal(result.targets.length, 1); assert.equal(result.targets[0].kind, 'body');
  assert.throws(() => runInNewContext(code + '\nsearchInventory(document,{scopes:["shape"],text_targets:[{kind:"shape",index:1}]});', context), e => e.nativeCode === 'INDEX_OUT_OF_BOUNDS');
});

test('native search rejects target budgets and duplicate targets before text reads', () => {
  const document = { documentBody: () => true, textItems: Array(101).fill({}) };
  const code = readFileSync(new URL('../plugins/pages-native/native/worker.js', import.meta.url), 'utf8');
  const context = { ObjC: { import() {} }, document };
  assert.throws(() => runInNewContext(code + '\nsearchInventory(document,{scopes:["text"]});', context), e => e.nativeCode === 'SEARCH_LIMIT');
  assert.throws(() => runInNewContext(code + '\nsearchInventory(document,{scopes:["body"],text_targets:[{kind:"body"},{kind:"body"}]});', context), e => e.nativeCode === 'DUPLICATE_TARGET');
});
