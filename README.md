# Mended

Paste a Walrus Memory or Sui error and see how other developers fixed it.

Open [Search](https://mended.timidan.xyz/search), paste the error, and add a Sui address or Walrus Memory account ID if you have one. Read the account check and matching fix, then try it in your project. A transaction digest is optional. No login or wallet connection is needed.

Or add Mended to your coding agent:

```sh
# Claude Code
claude mcp add --transport http mended https://mended.timidan.xyz/mcp
# Codex
codex mcp add mended --url https://mended.timidan.xyz/mcp
```

Ask the agent to use `search_fixes` with your error and an optional public address. Never send private keys.

[Website](https://mended.timidan.xyz) · [Fixes](https://mended.timidan.xyz/fixes)

These are the planned public URLs. Mended works locally; deployment is pending.

## Who it helps

Developers integrating Walrus Memory or Sui keep reading GitHub issues and Discord for the same errors. Mended keeps the fixes together, checks the account behind an error, and remembers answers from a person for the next developer.

## How it works

1. A developer sends an error through Search or the `search_fixes` MCP tool. Both use the same server.
2. Tatum reads the supplied account or transaction on Sui Mainnet; Walrus Memory recalls fixes by meaning from the `fixes` namespace.
3. Mended shows the account finding first, then relevant stored advice. A memory match must agree with the finding’s function or share an exact error token; a diagnosed missing key excludes unrelated package advice. Retired fixes remain readable when no active match qualifies. Only a successful recall with no answer and no service failure enters the person’s queue.
4. For an eligible fix, Tatum watches only an address the developer supplied or the owner of an account they supplied. Digest senders, examples, possible matches, and account creation advice for existing accounts never start watches. Contract verification requires the first subsequent call to succeed; a failure stops the watch. A named delegate must also be present after add_delegate_key. A memory_write fix requires the first subsequent Blob creation for that owner, with matching memwal_agent_id when a delegate was named. Writes already working in the previous 15 minutes are not watched.
5. Every five minutes, watched questions are grouped by owner and verification kind and read from their lowest checkpoint. SQLite counts distinct verified owners per fix, deduplicates fix/digest pairs, and keeps reports separate. Fixes with a specified replacement SDK version are retired when that release is available; their history stays visible.

Verification has been tested once on Mainnet, with our own memory write on a test database. No outside developer has been verified yet, and the public count starts at zero. Verified means Sui shows this address's next call or memory write succeeded after it searched. It can't show the fix caused that, and anyone can name an address.

## Integrations

| Service | Code | What it does |
| --- | --- | --- |
| Walrus Memory | [Memory client](src/memory.mjs) | Stores fixes on Mainnet with `rememberAndWait` and recalls them by meaning with `recall`. |
| Tatum | [Sui gateway client](src/sui.mjs), [account checks](src/check.mjs), [watcher](src/watcher.mjs) | Reads account state, delegate keys and transactions through GraphQL, then checks for successful calls. |

One Node server serves the pages, HTTP API and MCP endpoint. Walrus Memory holds searchable fix memories; SQLite holds their local text and index, questions, status and counts. Both are needed: a recalled memory ID must match a local fix.

## Decisions and evidence

| Decision | Evidence and reason |
| --- | --- |
| Use Tatum's GraphQL endpoint. | The 31 October gateway check found GraphQL at `/graphql` in `/_methods`, while JSON-RPC returned 404 despite being listed in [Tatum's guide](https://tatum.io/blog/building-on-sui). The [client](src/sui.mjs) uses that GraphQL endpoint. |
| Ask for accounts, not just digests. | Only 1 of 1,626 sampled Walrus Memory calls failed on chain. The SDK [simulates before choosing a gas budget](https://sdk.mystenlabs.com/sui/transactions/signing-and-execution), so failed simulations never produce submitted transactions. [Account checks](src/check.mjs) can diagnose these errors without a digest. |
| Use a distance cutoff and exact error tokens. | Tuned on 27 questions on Mainnet: distance below 0.5 is trusted; from 0.5 to below 0.58, a match also needs an exact error token. At 0.58 or above it is rejected. Otherwise a person answers unless the account check supplies documentation advice. See the [thresholds](src/memory.mjs), [matching rule](src/search.mjs) and [tests](src/search.test.mjs). |
| No LLM. | [Search](src/search.mjs) returns the stored fix text as written. Recall chooses a fix; it does not generate or rewrite the answer. |
| Cut logins, wallet connection and payments. | Search and MCP need only error text and optional public IDs. [Server routes](src/server.mjs) and [Tatum reads](src/sui.mjs) complete that path without a user account, signature or payment; these features would add steps without helping someone resolve an error. Only the answer queue needs the operator's admin token. |

## Evidence

| Check | Where to inspect it |
| --- | --- |
| Starting fixes | [Public-issue fixes and their source links](data/seed-fixes.json). These are starting material, not user usage. |
| Count handling | [Watcher checks](src/watcher.test.mjs) and [persistent count checks](src/db.test.mjs) cover successful calls and separate reports from verifications. |

## What works and what is untested

- Working locally with Mainnet services: search, account checks, stored fixes, the Fixes page, answers from a person and reuse of those answers, and retirement of outdated fixes.
- Claude Code and Codex have been tested as MCP clients. Cursor is untested.
- Verification has been tested once on Mainnet, with our own memory write on a test database. No outside developer has been verified yet, and the public count starts at zero. The included Mainnet abort example is diagnostic only; another call by its sender is not evidence that the same key was retried. The redesigned contract and Blob watchers have been tested with fakes only.
- Fixes tagged memory_write can be checked by a later Blob arriving at that address even when the fix changes SDK configuration, installation, or write pacing. Fixes with no verification kind only receive reports. Watching lasts up to 7 days.
- Account diagnosis is specific to Walrus Memory on Sui Mainnet. Other Sui packages can show transaction details, but their abort codes may have no names.
- If Tatum is unavailable, memory can still answer; if Walrus Memory is unavailable, account checks can still run. The missing service is stated in the response.
- Pasted errors are scrubbed before account parsing, storage, and recall, and limited to 4 KB. The separate public address/key field is used for account checks. A person can edit the error before publishing an answer or saving it permanently in Walrus; person-sourced error text is omitted from the public fixes API. Scrubbing is best effort: do not paste secrets or private data. The Walrus relayer sees plaintext.

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
| `MEMWAL_ACCOUNT_ID` | That Mainnet account's ID; fixes use the `fixes` namespace. |
| `ADMIN_TOKEN` | Operator password for `/answer`, where a person answers queued questions. Leave unset to disable that page. |
| `TRUST_CLOUDFLARE` | Set to `1` only behind a trusted Cloudflare proxy. Otherwise the last `x-forwarded-for` entry (or socket address) identifies the caller. |
| `DB_PATH` | Set to `data/mended.sqlite` locally. Compose sets `/data/mended.sqlite`. Do not leave it empty. |

For a new database, seed the local index and Walrus Memory. This writes the supplied fixes to your configured Mainnet memory account; it skips entries already recorded as remembered in SQLite.

```sh
node --env-file=.env --no-warnings scripts/seed.mjs
node --env-file=.env --no-warnings src/server.mjs
```

Open [local Search](http://localhost:4317/search). For local MCP use, replace the public endpoint in either command above with `http://localhost:4317/mcp`. At `/answer`, use any username and `ADMIN_TOKEN` as the password.

Run the existing tests without service credentials:

```sh
TATUM_API_KEY=unused MEMWAL_KEY=unused MEMWAL_ACCOUNT_ID= npm test
```

## Limits and local storage

Search parses at most five IDs, five delegate keys, and two digests. Tatum runs at one request per 450 ms with at most 12 pending reads; excess work returns a busy response, and disconnected requests cancel queued reads. Blob scans stop after ten pages rather than making an unbounded scan; incomplete checks do not verify or start a watch.

Walrus recall has a shared rolling budget of 20 calls per minute and 400 per hour, plus a five-minute cache keyed by scrubbed text. A busy memory service does not prevent the account check. HTTP limits include private pages and failed logins. POST requests require application/json; answers also require an Origin matching Host. Reports deduplicate by fix, hashed caller, and UTC day. Known example texts are excluded from question counts, which count distinct error text.

Startup adds columns, indexes, and a daily caller-report table. The original reports table is retained for historical counts because its one-row-per-question primary key cannot represent multiple callers or days without rebuilding it. It changes only the selected seeds’ verification kind, keyed by fix ID; it never rewrites Walrus memories. Existing questions default to not watched because their original input provenance was not stored. Legacy verification rows without an owner are not counted or linked. Questions without a fix expire after 30 days. Identical unanswered questions merge, the answer queue returns at most 100 entries, and a person can dismiss entries.

The migration was run twice against a temporary copy of the existing database: all 32 fixes and 3 questions retained their original text and memory IDs, and integrity checks passed. The source database was not migrated during this offline work.

### Seeds checked by memory writes

These 13 seeds now use memory_write in both the seed file and the startup migration:

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

Recall-only errors, actual MCP login/session errors, and ambiguous timeout outcomes remain unchanged. #829 concerns SDK authentication, not an MCP login. Account creation fixes keep their contract verification kind.

### Walrus object links

New completed writes retain the SDK memory ID, Walrus blob_id, and the matching owned Sui Blob object address. Only the object address is used in Suiscan links. If its lookup fails or indexing lags, the answer remains saved and the link stays absent; retry the backfill once reads recover.

For the existing 32 fixes, run the read-only service lookup below with the configured public account ID (or MEMWAL_OWNER). It lists that owner’s Blobs with namespace fixes and joins them to recall results by exact fix ID and blob_id. It updates only SQLite links, never Walrus memory. Recall lookups are paced to stay below the minute budget, and unmatched rows are reported as missing.

```sh
node --env-file=.env --no-warnings scripts/backfill-blobs.mjs
```

Live GraphQL schema compatibility, Blob metadata, object links, and verification outcomes still need checking against Mainnet. No network calls, live writes, backfill, Docker build, or browser rendering were exercised in this sandbox. Local tests use fakes for external services.

## Container

GET /healthz checks the server and SQLite without upstream calls. The Docker health check uses it. SIGTERM stops accepting requests, closes the database, and exits within ten seconds. Responses include a CSP allowing Google Fonts and the local WebGL canvas, nosniff, and a no-referrer policy.

The image runs as the non-root `node` user. Compose keeps SQLite in the `mended_data` volume at `/data`, joins the existing external `public_proxy` network and publishes no ports. Configure the proxy on that network to route `mended.timidan.xyz` to `http://mended:4317`.

With `.env` filled in and the network already present:

```sh
docker compose build
docker compose run --rm mended node --no-warnings scripts/seed.mjs
docker compose up -d
```

The seed step is for a new database. An existing installation needs its SQLite database, including the local index and counts, copied into the volume while the service is stopped. Reusing a Walrus Memory account alone does not restore that index.

Environment variables take precedence over the optional home-directory key files in both clients. Those files are not needed in the container when the variables are populated. Container build and runtime still need checking on a host with Docker daemon access.
