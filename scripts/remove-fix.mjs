// Stops an agent's fix reaching search. Its Walrus copy is permanent, but search only serves what SQLite allows.
import { getStore } from '../src/db.mjs'

const [id] = process.argv.slice(2)
const { changes } = getStore().remove(id ?? '')
console.log(changes ? `Removed ${id}` : `No fix with ID ${id}`)
getStore().close()
