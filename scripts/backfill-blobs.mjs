import { pathToFileURL } from 'node:url'
import { getStore } from '../src/db.mjs'
import { ownedBlobs, readObject } from '../src/sui.mjs'
import * as memory from '../src/memory.mjs'

export async function backfillBlobs({ store = getStore(), owner, list = ownedBlobs, recall = memory.recall, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  if (!owner) throw new Error('Set MEMWAL_OWNER to the public owner address')
  const blobs = await list(owner, 'fixes')
  let linked = 0
  let missing = 0
  for (const fix of store.fixes()) {
    if (fix.blob_object_id) continue
    if (!fix.blob_id) await sleep(3100)
    const blobId = fix.blob_id ?? (await recall(`${fix.title}\n${fix.error}`)).find((hit) => hit.id === fix.id)?.blob_id
    const object = blobs.find((b) => b.blobId && b.blobId === blobId)
    if (object) {
      store.setBlob(fix.id, object.objectId)
      linked += 1
    } else missing += 1
  }
  return { linked, missing }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.MEMWAL_OWNER && !process.env.MEMWAL_ACCOUNT_ID) throw new Error('Set MEMWAL_OWNER or MEMWAL_ACCOUNT_ID')
    const owner = process.env.MEMWAL_OWNER || (await readObject(process.env.MEMWAL_ACCOUNT_ID))?.json?.owner
    console.log(JSON.stringify(await backfillBlobs({ owner })))
  } finally {
    getStore().close()
  }
}
