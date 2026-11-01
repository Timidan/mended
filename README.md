<div align="center">

<img src="public/mark.svg" alt="Mended" width="72" height="72">

# Mended

**Paste a Walrus Memory or Sui error and see how other developers fixed it.**<br>
Mended also checks your account on Sui Mainnet, and a person answers when no stored fix matches.

[Use it](#use-it) · [How it works](#how-it-works) · [Decisions and evidence](#decisions-and-evidence) · [What works](#what-works-and-what-is-untested) · [Run locally](#run-locally) · [Container](#container)

![Node 22.13 or later](https://img.shields.io/badge/Node-22.13%2B-339933?logo=nodedotjs&logoColor=white)
![Sui Mainnet](https://img.shields.io/badge/chain-Sui%20Mainnet-4da2ff?logo=sui&logoColor=white)
![Walrus Memory](https://img.shields.io/badge/storage-Walrus%20Memory-c69a3c)
![MCP over HTTP](https://img.shields.io/badge/MCP-HTTP-555555)
[![MIT license](https://img.shields.io/badge/license-MIT-123a42)](LICENSE)

</div>

<img src="docs/screens/landing.jpg" alt="The Mended landing page: a dark bowl mended with gold above the heading Paste your Sui error. Get the fix that already worked.">

> [!NOTE]
> Mended is not deployed yet. It works locally with Mainnet services, and `mended.timidan.xyz` is the planned address.

## Highlights

- **Search by meaning.** Walrus Memory recalls stored fixes even when the wording of the error differs.
- **Account checks first.** Tatum reads the account or transaction on Sui Mainnet, so Mended can diagnose errors that never reached the chain.
- **Stored text only.** There is no LLM. Recall chooses a fix, and Mended returns it as written.
- **A person answers the misses.** A question with no match goes to a queue, and the answer is stored for the next developer.
- **Verification with stated limits.** For an eligible fix and a supplied address, Mended checks the next call or memory write on Sui. It can't show that the fix caused the result.
- **No sign-up.** Search and the MCP tool need only error text and optional public IDs. Mended never asks for a private key and can't sign anything.

## Who it helps

Developers integrating Walrus Memory or Sui keep reading GitHub issues and Discord for the same errors. Mended keeps the fixes together, checks the account behind an error, and remembers answers from a person for the next developer.

## Use it

**In a browser.** Open Search, paste the error, and add a Sui address or Walrus Memory account ID if you have one. Read the account check and the matching fix, then try it in your project. A transaction digest is optional. You don't need a login or a wallet connection.

<img src="docs/screens/search.jpg" alt="The Search page with 401 AUTH_REJECTED pasted. Mended shows the Walrus docs finding, a stored fix, and an account check where the key is not registered.">

**In a coding agent.** Add the MCP server, then ask the agent to use `search_fixes` with your error and an optional public address. Never send private keys.

```sh
# Claude Code
claude mcp add --transport http mended https://mended.timidan.xyz/mcp
# Codex
codex mcp add mended --url https://mended.timidan.xyz/mcp
```

These commands use the planned address. For a local server, use `http://localhost:4317/mcp`.

## How it works

```mermaid
flowchart TD
  D[Developer or coding agent] -->|error text and optional public IDs| S[Search page or search_fixes tool]
  S --> M[Mended server]
  M -->|reads the account or transaction| T[Tatum Sui gateway]
  T --> C[(Sui Mainnet)]
  M -->|recalls fixes by meaning| W[(Walrus Memory)]
  M -->|account check and matching fix| D
  M -->|eligible fix and supplied address| V[Watcher, every five minutes]
  V -->|next call or Blob| T
  M -->|no match| P[A person answers the question]
  P -->|stores the new fix| W
  V -->|verified count| Q[(SQLite: fixes, questions, counts)]
  M -->|questions and reports| Q
  Q --> F[Fixes page]
```

1. A developer sends an error through Search or the `search_fixes` MCP tool. Both use the same server.
2. Tatum reads the supplied account or transaction on Sui Mainnet. Walrus Memory recalls fixes by meaning from the `fixes` namespace.
3. Mended shows the account finding first, then relevant stored advice. A memory match must agree with the finding's function or share an exact error token. A diagnosed missing key excludes unrelated package advice. Retired fixes remain readable when no active match qualifies.
4. Only a successful recall with no answer and no service failure enters the person's queue.
5. For an eligible fix, the watcher follows the result on Sui and adds to the counts on the [Fixes page](#the-fixes-page).

### Verification

- Tatum watches only an address the developer supplied, or the owner of an account they supplied.
- Digest senders, examples, possible matches, and account creation advice for existing accounts never start watches.
- Contract verification requires the first later call to succeed. A failure stops the watch. A named delegate must also be present after `add_delegate_key`.
- A `memory_write` fix requires the first later Blob creation for that owner, with a matching `memwal_agent_id` when a delegate was named.
- Writes already working in the previous 15 minutes are not watched.
- Every five minutes, watched questions are grouped by owner and verification kind and read from their lowest checkpoint.
- SQLite counts distinct verified owners per fix, deduplicates fix and digest pairs, and keeps reports separate.
- Fixes with a specified replacement SDK version are retired when that release is available. Their history stays visible.

> [!IMPORTANT]
> Verification has been tested once on Mainnet, with our own memory write on a test database. No outside developer has been verified yet, and the public count starts at zero. Verified means Sui shows this address's next call or memory write succeeded after it searched. It can't show the fix caused that, and anyone can name an address.

### The Fixes page

<img src="docs/screens/fixes.jpg" alt="The Fixes page: a table of stored fixes with status, verified and reported counts, SDK version and source links. Every count is zero.">

Every stored fix is listed with its status, counts, SDK version and source. All 32 stored fixes show a link to their Walrus object.

## Built with

| Service | Code | What it does |
| --- | --- | --- |
| [Walrus Memory](https://docs.wal.app/walrus-memory) | [Memory client](src/memory.mjs) | Stores fixes on Mainnet with `rememberAndWait` and recalls them by meaning with `recall`. |
| [Tatum](https://tatum.io) | [Sui gateway client](src/sui.mjs), [account checks](src/check.mjs), [watcher](src/watcher.mjs) | Reads account state, delegate keys and transactions through GraphQL, then checks for successful calls. |

One Node server serves the pages, the HTTP API and the MCP endpoint. Walrus Memory holds searchable fix memories. SQLite holds their local text and index, questions, status and counts. Both are needed, because a recalled memory ID must match a local fix.

## Decisions and evidence

| Decision | Evidence and reason |
| --- | --- |
| Use Tatum's GraphQL endpoint. | The 31 October gateway check found GraphQL at `/graphql` in `/_methods`, while JSON-RPC returned 404 despite being listed in [Tatum's guide](https://tatum.io/blog/building-on-sui). The [client](src/sui.mjs) uses that GraphQL endpoint. |
| Ask for accounts, not just digests. | Only 1 of 1,626 sampled Walrus Memory calls failed on chain. The SDK [simulates before choosing a gas budget](https://sdk.mystenlabs.com/sui/transactions/signing-and-execution), so failed simulations never produce submitted transactions. [Account checks](src/check.mjs) can diagnose these errors without a digest. |
| Use a distance cutoff and exact error tokens. | Tuned on 27 questions on Mainnet. Distance below 0.5 is trusted. From 0.5 to below 0.58, a match also needs an exact error token. At 0.58 or above it is rejected. Otherwise a person answers, unless the account check supplies documentation advice. See the [thresholds](src/memory.mjs), [matching rule](src/search.mjs) and [tests](src/search.test.mjs). |
| No LLM. | [Search](src/search.mjs) returns the stored fix text as written. Recall chooses a fix. It does not generate or rewrite the answer. |
| Cut logins, wallet connection and payments. | Search and MCP need only error text and optional public IDs. [Server routes](src/server.mjs) and [Tatum reads](src/sui.mjs) complete that path without a user account, signature or payment. These features would add steps without helping someone resolve an error. Only the answer queue needs the operator's admin token. |

To inspect the data behind the counts:

- **Starting fixes.** [Public-issue fixes and their source links](data/seed-fixes.json). These are starting material, not user usage.
- **Count handling.** [Watcher checks](src/watcher.test.mjs) and [persistent count checks](src/db.test.mjs) cover successful calls and keep reports separate from verifications.

## What works and what is untested

- **Working locally with Mainnet services:** search, account checks, stored fixes, the Fixes page, answers from a person and reuse of those answers, and retirement of outdated fixes.
- **MCP clients:** Claude Code and Codex have been tested. Cursor is untested.
- **Verification:** tested once on Mainnet, with our own memory write on a test database. No outside developer has been verified yet, and the public count starts at zero. The included Mainnet abort example is diagnostic only. Another call by its sender is not evidence that the same key was retried. The redesigned contract and Blob watchers have been tested with fakes only.
- **Weak signals:** fixes tagged `memory_write` can be checked by a later Blob arriving at that address, even when the fix changes SDK configuration, installation or write pacing. Fixes with no verification kind only receive reports. Watching lasts up to 7 days.
- **Scope:** account diagnosis is specific to Walrus Memory on Sui Mainnet. Other Sui packages can show transaction details, but their abort codes may have no names.
- **Outages:** if Tatum is unavailable, memory can still answer. If Walrus Memory is unavailable, account checks can still run. The missing service is stated in the response.
- **Privacy:** pasted errors are scrubbed before account parsing, storage and recall, and limited to 4 KB. The separate public address and key field is used for account checks. A person can edit the error before publishing an answer or saving it permanently in Walrus. Person-sourced error text is omitted from the public fixes API. Scrubbing is best effort, so do not paste secrets or private data. The Walrus relayer sees plaintext.
- **Still to check against Mainnet:** live GraphQL schema compatibility, Blob metadata, object links and verification outcomes. Local tests use fakes for external services.

## Run locally

Use Node 22.13 or later in the Node 22 release line, which [supports the built-in SQLite module without an extra flag](https://nodejs.org/download/release/v22.13.0/docs/api/cli.html#--no-experimental-sqlite).

```sh
npm ci --omit=dev
cp .env.example .env
```

Fill in `.env` before continuing:

| Variable | Purpose |
| --- | --- |
| `TATUM_API_KEY` | Tatum key for Sui Mainnet reads. |
| `MEMWAL_KEY` | Delegate key for the server's Walrus Memory account. |
| `MEMWAL_ACCOUNT_ID` | That Mainnet account's ID. Fixes use the `fixes` namespace. |
| `ADMIN_TOKEN` | Operator password for `/answer`, where a person answers queued questions. Leave unset to disable that page. |
| `TRUST_CLOUDFLARE` | Set to `1` only behind a trusted Cloudflare proxy. Otherwise the last `x-forwarded-for` entry, or the socket address, identifies the caller. |
| `DB_PATH` | Set to `data/mended.sqlite` locally. Compose sets `/data/mended.sqlite`. Do not leave it empty. |

For a new database, seed the local index and Walrus Memory. This writes the supplied fixes to your configured Mainnet memory account. It skips entries already recorded as remembered in SQLite.

```sh
node --env-file=.env --no-warnings scripts/seed.mjs
node --env-file=.env --no-warnings src/server.mjs
```

Open `http://localhost:4317/search`. At `/answer`, use any username and `ADMIN_TOKEN` as the password.

Run the tests without service credentials:

```sh
TATUM_API_KEY=unused MEMWAL_KEY=unused MEMWAL_ACCOUNT_ID= npm test
```

## Limits and local storage

**Search.** Search parses at most five IDs, five delegate keys and two digests.

**Tatum.** One request per 450 ms, with at most 12 pending reads. Excess work returns a busy response, and disconnected requests cancel queued reads. Blob scans stop after ten pages rather than running without a limit. Incomplete checks do not verify or start a watch.

**Walrus recall.** A shared rolling budget of 20 calls per minute and 400 per hour, plus a five-minute cache keyed by scrubbed text. A busy memory service does not prevent the account check.

**HTTP.** Limits include private pages and failed logins. POST requests require `application/json`, and answers also require an Origin matching Host. Reports deduplicate by fix, hashed caller and UTC day. Known example texts are excluded from question counts, which count distinct error text.

**Questions.** Questions without a fix expire after 30 days. Identical unanswered questions merge, the answer queue returns at most 100 entries, and a person can dismiss entries.

<details>
<summary>Startup migration</summary>

Startup adds columns, indexes and a daily caller-report table. The original reports table is retained for historical counts, because its one-row-per-question primary key cannot represent multiple callers or days without rebuilding it.

Startup changes only the selected seeds' verification kind, keyed by fix ID. It never rewrites Walrus memories. Existing questions default to not watched, because their original input provenance was not stored. Legacy verification rows without an owner are not counted or linked.

The migration was run twice against a temporary copy of the existing database. All 32 fixes and 3 questions retained their original text and memory IDs, and integrity checks passed.

</details>

<details>
<summary>Seeds checked by memory writes</summary>

These 13 seeds use `memory_write` in both the seed file and the startup migration:

| Issue | Fix |
| --- | --- |
| #1032 | Account created under the documented package is rejected |
| #819 | Older-package account gets 401 on every authenticated call |
| #1132 | Wallet address used as accountId |
| #1125 | Delegate key not registered |
| #313 | Credentials and relayer on different networks |
| #829 | SDK reports an MCP login instruction for rejected credentials |
| #1033 | Unsupported @mysten/memwal package returns 426 |
| #1041 | Missing credentials cause Uint8Array expected |
| #254 | SDK installation fails with ERESOLVE |
| #1143 | Package exports cannot be resolved |
| #279 | oc-memwal installation fails on workspace dependency |
| #686 | remember loop hits the delegate-key 429 limit |
| #1116 | Writes hit the account-wide 429 limit |

Recall-only errors, actual MCP login and session errors, and ambiguous timeout outcomes remain unchanged. #829 concerns SDK authentication, not an MCP login. Account creation fixes keep their contract verification kind.

</details>

<details>
<summary>Walrus object links</summary>

New completed writes retain the SDK memory ID, the Walrus `blob_id`, and the matching owned Sui Blob object address. Only the object address is used in Suiscan links. If its lookup fails or indexing lags, the answer remains saved and the link stays absent. Retry the backfill once reads recover.

The backfill below is a read-only service lookup. Run it with the configured public account ID or `MEMWAL_OWNER`. It lists that owner's Blobs with namespace `fixes` and joins them to recall results by exact fix ID and `blob_id`. It updates only SQLite links, never Walrus memory. Recall lookups are paced to stay below the minute budget, and unmatched rows are reported as missing.

```sh
node --env-file=.env --no-warnings scripts/backfill-blobs.mjs
```

</details>

## Container

`GET /healthz` checks the server and SQLite without upstream calls, and the Docker health check uses it. SIGTERM stops accepting requests, closes the database and exits within ten seconds. Responses include a CSP allowing Google Fonts and the local WebGL canvas, `nosniff`, and a no-referrer policy.

The image runs as the non-root `node` user. Compose keeps SQLite in the `mended_data` volume at `/data`, joins the existing external `public_proxy` network and publishes no ports. Configure the proxy on that network to route `mended.timidan.xyz` to `http://mended:4317`.

With `.env` filled in and the network already present:

```sh
docker compose build
docker compose run --rm mended node --no-warnings scripts/seed.mjs
docker compose up -d
```

The seed step is for a new database. An existing installation needs its SQLite database, including the local index and counts, copied into the volume while the service is stopped. Reusing a Walrus Memory account alone does not restore that index.

Environment variables take precedence over the optional home-directory key files in both clients. Those files are not needed in the container when the variables are populated.

Container build and runtime still need checking on a host with Docker daemon access.

## Project structure

```
public/    pages, styles and the WebGL bowl (plain HTML, CSS and JS)
src/       server, search, account checks, Walrus Memory client, watcher, tests
scripts/   seed and object-link backfill
data/      seed fixes; the local SQLite database is not committed
docs/      screenshots
```

## License

[MIT](LICENSE)
