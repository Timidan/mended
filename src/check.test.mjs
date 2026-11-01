import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.TATUM_API_KEY ??= 'unused-in-these-tests'
const { parse } = await import('./check.mjs')
const { scrub } = await import('./scrub.mjs')

const digest = 'HkjZZKkt35QdjrWGbUFBR5eyMuHQaLLRsGCYwvuzC5DS'
const id = '0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5'
const base64Key = 'lXV1xCpbRERdeUErQOQcx6Ms+xwba/GGS+1CcFz0pi0='

test('parse separates IDs, keys and digests', () => {
  const found = parse(`failed ${digest} on ${id} with key ${base64Key}`)
  assert.deepEqual(found.ids, [id])
  assert.deepEqual(found.keys, [base64Key])
  assert.deepEqual(found.digests, [digest])
})

test('scrub removes secrets and keeps the error', () => {
  const clean = scrub(`401 AUTH_REJECTED api_key=abc123456789 suiprivkey1qqexample key ${'ab'.repeat(32)} at ${id}`)
  assert.match(clean, /401 AUTH_REJECTED/)
  assert.match(clean, new RegExp(id))
  assert.doesNotMatch(clean, /abc123456789|suiprivkey1qqexample|abab/)
})

test('scrub leaves ordinary words after a secret-like word', () => {
  assert.equal(scrub('token refresh failed'), 'token refresh failed')
  assert.equal(scrub('password hunter2xyz'), '[secret]')
  assert.match(scrub('legal winner thank year wave sausage worth useful legal winner thank yellow'), /seed phrase/)
  assert.doesNotMatch(scrub('later reuses the same job when you retry the same text with that key'), /seed phrase/)
})
