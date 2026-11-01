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
3. Mended shows a matching stored fix as written. Account checks can also return advice from the contract documentation. Unanswered questions wait for a person, whose answer is saved to Walrus Memory.
4. The developer applies the fix. For a fix with a named on-chain function and a known account owner, Tatum watches for a later successful call by that owner after the question was asked.
5. SQLite records the verified count and transaction digest for the public Fixes page. Fixes with a specified replacement SDK version are retired when that release is available; their history stays visible.

Verification has been checked on one historical transaction pair, not yet on a live user. A successful call establishes the on-chain outcome; it does not establish that the developer followed the suggested fix.

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
| Historical verification case | [Failed `remove_delegate_key` call](https://suiscan.xyz/mainnet/tx/HkjZZKkt35QdjrWGbUFBR5eyMuHQaLLRsGCYwvuzC5DS), followed by the same sender's successful call 11 seconds later in the recorded Mainnet check. Paste the failed digest into Search to inspect the pair. |
| Starting fixes | [Public-issue fixes and their source links](data/seed-fixes.json). These are starting material, not user usage. |
| Count handling | [Watcher checks](src/watcher.test.mjs) and [persistent count checks](src/db.test.mjs) cover successful calls and separate reports from verifications. |

## What works and what is untested

- Working locally with Mainnet services: search, account checks, stored fixes, the Fixes page, answers from a person and reuse of those answers, and retirement of outdated fixes.
- Claude Code and Codex have been tested as MCP clients. Cursor is untested.
- Verification has been exercised on one historical transaction pair. Verification for a live user remains untested.
- Fixes without an on-chain step, such as changing a batch size or upgrading an SDK, cannot get an on-chain verification. Reports stay separate from verified counts. Watching lasts up to 7 days.
- Account diagnosis is specific to Walrus Memory on Sui Mainnet. Other Sui packages can show transaction details, but their abort codes may have no names.
- If Tatum is unavailable, memory can still answer; if Walrus Memory is unavailable, account checks can still run. The missing service is stated in the response.
- Pasted text is scrubbed before storage or recall, but the Walrus relayer sees plaintext. Do not paste secrets or private data.

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

## Container

The image runs as the non-root `node` user. Compose keeps SQLite in the `mended_data` volume at `/data`, joins the existing external `public_proxy` network and publishes no ports. Configure the proxy on that network to route `mended.timidan.xyz` to `http://mended:4317`.

With `.env` filled in and the network already present:

```sh
docker compose build
docker compose run --rm mended node --no-warnings scripts/seed.mjs
docker compose up -d
```

The seed step is for a new database. An existing installation needs its SQLite database, including the local index and counts, copied into the volume while the service is stopped. Reusing a Walrus Memory account alone does not restore that index.

Environment variables take precedence over the optional home-directory key files in both clients. Those files are not needed in the container when the variables are populated. Container build and runtime still need checking on a host with Docker daemon access.
