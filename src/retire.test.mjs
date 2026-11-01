import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from './db.mjs'
import { compareVersions, retireFixes } from './retire.mjs'

test('version comparison uses numeric components and prerelease order', () => {
  assert.equal(compareVersions('0.1.9', '0.1.12'), -1)
  assert.equal(compareVersions('0.2.0', '0.1.12'), 1)
  assert.equal(compareVersions('0.1.12+build', '0.1.12'), 0)
  assert.equal(compareVersions('0.1.12-rc.2', '0.1.12-rc.10'), -1)
  assert.equal(compareVersions('0.1.12-rc.1', '0.1.12'), -1)
  assert.equal(compareVersions(null, '0.1.12'), null)
})

test('retirement keeps history and skips unavailable or inapplicable versions', async () => {
  const store = createStore(':memory:')
  try {
    const fields = { title: 'Fix', error: 'Error', body: 'Upgrade', source: 'issue' }
    const fix = store.addFix({ ...fields, retire_at_version: '0.1.12' })
    store.addFix({ ...fields, retire_at_version: '0.1.13' })
    store.addFix(fields)
    assert.equal(await retireFixes({ store, fetchVersion: async () => { throw new Error('offline') } }), 0)
    assert.equal(await retireFixes({ store, fetchVersion: async () => ({ ok: true, json: async () => ({ version: '0.1.12' }) }) }), 1)
    assert.equal(store.fix(fix.id).status, 'retired')
    assert.equal(store.fix(fix.id).retired_reason, 'Fixed in SDK 0.1.12')
    assert.equal(store.fixes().length, 3)
  } finally {
    store.close()
  }
})
