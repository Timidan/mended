import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from '../src/db.mjs'
import { backfillBlobs } from './backfill-blobs.mjs'

test('backfill links only exact recalled fix and blob IDs without memory writes', async () => {
  const store = createStore(':memory:')
  try {
    const fix = store.addFix({ title: 'Fix', error: 'error', body: 'fix', source: 'issue' })
    const result = await backfillBlobs({ store, owner: 'owner', sleep: async () => {},
      list: async (owner, namespace) => {
        assert.equal(owner, 'owner')
        assert.equal(namespace, 'fixes')
        return [{ blobId: 'blob-one', objectId: 'object-one' }]
      }, recall: async () => [{ id: 'other', blob_id: 'blob-other' }, { id: fix.id, blob_id: 'blob-one' }] })
    assert.equal(result.linked, 1)
    assert.equal(store.fix(fix.id).blob_object_id, 'object-one')
    assert.equal(store.fix(fix.id).memory_id, null)
  } finally { store.close() }
})
