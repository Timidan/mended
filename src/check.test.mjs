import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.TATUM_API_KEY ??= 'unused-in-these-tests'
const { parse, accountCheck } = await import('./check.mjs')
const { scrub } = await import('./scrub.mjs')

const digest = 'HkjZZKkt35QdjrWGbUFBR5eyMuHQaLLRsGCYwvuzC5DS'
const id = '0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5'
const base64Key = 'lXV1xCpbRERdeUErQOQcx6Ms+xwba/GGS+1CcFz0pi0='

test('parse separates IDs, keys and digests', () => {
  const found = parse(`failed ${digest} on ${id} with key ${base64Key}`)
  assert.deepEqual(found.ids, [id])
  assert.deepEqual(found.keys, [Buffer.from(base64Key, 'base64').toString('hex')])
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


test('parsing caps work and normalizes public keys', () => {
  const ids = Array.from({ length: 8 }, (_, n) => `0x${n.toString(16).padStart(64, '0')}`)
  const keys = Array.from({ length: 8 }, (_, n) => (n + 20).toString(16).padStart(64, '0'))
  const found = parse([...ids, ...keys, ...['A', 'B', 'C'].map((c) => c.repeat(44))].join(' '))
  assert.equal(found.ids.length, 5)
  assert.equal(found.keys.length, 5)
  assert.equal(found.digests.length, 2)
  assert.deepEqual(parse(`public key 0x${'AB'.repeat(32)}`).keys, ['ab'.repeat(32)])
})

test('secrets in named variables, common formats and seed lists are removed', () => {
  for (const name of ['OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_PASSWORD', 'MEMWAL_KEY']) {
    assert.doesNotMatch(scrub(`${name}=0x${'ab'.repeat(32)}`), /abab/)
  }
  assert.equal(scrub('sk-123456789abcdef ghp_123456789abcdef eyJabcd.abcdef.abcdef'), '[secret] [secret] [secret]')
  assert.doesNotMatch(scrub(`0x${'ab'.repeat(64)}`), /abab/)
  const words = 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ')
  for (const text of [words.join(' ').toUpperCase(), JSON.stringify(words), words.map((w, i) => `${i + 1}. ${w}`).join(' ')]) {
    assert.match(scrub(text), /seed phrase/)
    assert.doesNotMatch(scrub(text), /sausage/i)
  }
})

test('account checks use typed owners, only ask about keys given, and never send private IDs', async () => {
  const owner = `0x${'12'.repeat(32)}`
  const key = 'ab'.repeat(32)
  const account = { id, owner, active: true, delegate_keys: [{ public_key: `0x${key}`, label: 'Laptop' }] }
  const reads = { readObject: async (address) => address === id ? { type: 'pkg::account::MemWalAccount', json: account } : null,
    accountOfOwner: async () => null }
  const checked = await accountCheck('', `${id} ${key}`, reads)
  assert.equal(checked.asked, true)
  assert.equal(checked.owner, owner)
  assert.match(checked.checks.find((c) => c.label === 'This key').value, /Registered/)
  assert.equal((await accountCheck('', id, reads)).asked, false)
  const absent = await accountCheck('', owner, reads)
  assert.equal(absent.owner, owner)
  assert.match(absent.checks[0].value, /No Walrus Memory account/)
  assert.equal((await accountCheck('', key, reads)).nothingToCheck, true)
  const hidden = await accountCheck(`PRIVATE_KEY=0x${key}`, '', { readObject: async () => assert.fail('secret sent to Sui') })
  assert.equal(hidden.nothingToCheck, true)
})


test('abort names are decoded only for a matched Walrus account call, never a sender watch', async () => {
  const { MEMWAL } = await import('./sui.mjs')
  const tx = { ok: false, sender: 'untyped', digest, checkpoint: '1', abort: { code: 1 },
    call: { package: MEMWAL.package, module: 'account', function: 'remove_delegate_key' } }
  const reads = { readTransaction: async () => tx, callsAfter: async () => [] }
  const result = await accountCheck(digest, '', reads)
  assert.equal(result.answer.name, 'EDelegateKeyNotFound')
  assert.equal(result.owner, null)
  tx.call.module = 'other'
  assert.equal((await accountCheck(digest, '', reads)).answer, null)
  tx.call = null
  assert.equal((await accountCheck(digest, '', reads)).answer, null)
})
