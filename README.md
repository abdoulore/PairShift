<img src="public/favicon.svg" width="56" height="56" alt="Tandem logo" />

# Tandem

**Switch when the relationship is right, not just the price.**

Tandem turns private-market and tokenized-stock views into executable orders on Solana. Set up *"move $100 from OpenAI into Anthropic when Anthropic becomes 10% cheaper relative to OpenAI"* and Tandem turns it into a deterministic trigger, watches the reference prices behind both assets, checks token state, fees, liquidity and slippage, and switches in a single transaction through Jupiter when the condition is met.

It covers **8 pre-IPO companies (PreStocks)** and **13 public stocks (Backed xStocks)**, including mixed pairs like Tesla into SpaceX.

Built for Stocklana (Main track, PreStocks bounty).

---

## Verified on Solana mainnet

**Executed.** A live one-tap switch, created in the app, triggered by the engine and confirmed from a wallet:

| | |
|---|---|
| Transaction | [`2LxBEz5p…DraCEfvJ`](https://solscan.io/tx/2LxBEz5pmcL9BZkjmuYY3xVtZ5ZieLm9jNZUv4AEU3c4QPtbnwY65XbzRk6HdLLWoBConUiEmrEnZntfDraCEfvJ) |
| When | 2026-09-25 10:17 UTC, slot 450,323,285 |
| Switch | OpenAI → Anthropic, one tap |
| Spent | 0.004884 OPENAI |
| Received | 0.006181 ANTHROPIC, into a token account created in the same transaction |
| Route | OpenAI → USDC → SOL → Anthropic via Jupiter, 153k compute units |

OpenAI uses Token-2022's scaled UI amount (multiplier 1.4861347 since 2026-07-17), so 0.004884 OPENAI is 0.003287 in raw token units; explorers that ignore the multiplier show the raw figure. Tandem sizes, quotes and reports every amount in UI units.

**Simulated.** Every live path was also dry-run with `simulateTransaction` against current mainnet state, using real token holders as stand-ins (`scripts/simulate.ts`, `scripts/sim-confirm.ts`):

| Path | Pair | Result |
|---|---|---|
| One tap | OpenAI → Anthropic | Received 18,835,497 vs 18,835,427 predicted after the 1% PreStocks input fee |
| Automatic | TSLAx → SpaceX | Received 16,471,098 vs 16,470,950 quoted; new Token-2022 account created in the same transaction |
| Automatic | SPYx → NVDAx | Received 22,462,569 vs 22,462,669 quoted; 968 bytes, 140k compute units |

Tandem also corrects for a quoting gap it found: Jupiter quotes include a Token-2022 transfer fee on the output token but not on the input token, so Tandem prices the input fee itself and widens the on-chain minimum out by exactly that fee.

## What's live

- Live PreStocks marks, token prices and valuations; live Pyth data where the key has access
- A structured switch builder that reads every order back as a plain sentence
- Relative-value triggers confirmed across 3 fresh price updates per leg
- Grouped safety checks: reference data, asset state, execution
- Fee-aware Jupiter quotes and real Solana transaction construction
- Paper mode on live prices, with an execution receipt for every switch
- Wallet signing: one-tap PreStocks execution and automatic delegated xStock execution
- Telegram alerts when a switch is ready to confirm, completes or fails, with buttons that open the app in a mobile wallet

## Why

Private-market tokens rarely trade at their reference value. At the time of writing, OpenAI tokens traded about **29% above** their PreStocks mark and SpaceX about **21% below**. Investors who rotate between these positions, or between a public stock and a private one, watch two prices, work out a ratio by hand, and sell to cash before buying back, with price risk in between. Existing limit orders trigger on one token's own price, not on how two assets move against each other.

Tokenized markets also add costs and risks most holders never check:

- PreStocks charge a **1% transfer fee** on every transfer, which quietly eats small moves.
- Public-stock tokens trade 24/7 while the real stock does not, so at night and on weekends a token can drift from its stock.

Tandem handles all of it.

## PreStocks integration

Tandem uses PreStocks data for:

- asset discovery, token prices and mark prices for all 8 companies
- premium and discount to mark, shown live and enforced as a check
- the mark as the reference price for pre-IPO triggers
- implied and mark valuations on the Markets page

And it adapts execution to how PreStocks tokens work:

- detects the Token-2022 transfer fee and prices it into every quote
- never moves a PreStocks token an extra time: switches out of one run as one-tap confirms from the owner's wallet
- defaults pre-IPO pairs to a 2.5% slippage limit to match thinner pools
- blocks a switch that would buy far above, or sell far below, the mark
- warns before arming when fees and spread would eat most of the move

Only PreStocks pre-IPO tokens are integrated.

## How it works

1. **Pick the pair, amount and condition.** Choose any two of the 21 assets, an amount in dollars or units, and a relative move. Tandem reads the order back as a plain sentence.
2. **Tandem fixes a baseline.** The ratio *price of target / price of source* is measured from reference prices at arm time. "6% cheaper" means the ratio falls 6% from that baseline; "outperforms by 5%" means it rises 5%.
3. **It watches reference prices, not token prices.** Pre-IPO tokens use the **PreStocks mark**; public stocks use **Pyth** equity feeds (`Equity.US.TSLA/USD`).
4. **Before any trade, every safety check must pass:**

   | Check | What it prevents |
   |---|---|
   | Trusted reference prices | Trading live on anything other than Pyth (public) or PreStocks marks (pre-IPO) |
   | Reference prices fresh | Acting on stale data (60s for Pyth, 3 min for PreStocks marks) |
   | US market open | Trading an xStock while its real stock is closed |
   | Pyth confidence tight | Trading when Pyth's confidence interval is wide |
   | xStocks track their stock | Buying an xStock above, or selling below, its Pyth price by more than 1.5% |
   | Pre-IPO price vs PreStocks mark | Buying a pre-IPO token above, or selling below, its mark by more than 10% |
   | No corporate action in flight | Switching around a dividend or split (xStock scaled-UI multiplier change) |
   | Tokens not paused | Issuer-paused tokens |
   | Execution within slippage | A quote worse than on-chain DEX prices, after the known transfer fees |
   | Funds approved / wallet balance | Switches the wallet can't cover |

   The trigger must also hold across **3 fresh price updates on each leg**, so one bad tick can't fire a switch. Tandem also warns before you arm when fees and spread would eat most of the move, and pre-IPO pairs default to a 2.5% slippage limit to match their thinner pools.
5. **It executes in one of two ways:**
   - **One tap** (source is a PreStocks token): moving it through the keeper would cost an extra 1% transfer fee, so Tandem doesn't. When everything passes, the switch shows as *Ready*. You press Confirm, Tandem re-runs every check, and you sign a fresh swap from your own wallet.
   - **Automatic** (source is an xStock): you sign one SPL approval for the exact amount. When the trigger fires, a keeper sends one atomic transaction: pull the approved amount, swap through Jupiter with a hard minimum out, and deliver the new stock straight into your wallet. If any step fails, nothing moves.

Paper mode runs the same pipeline without moving funds.

## Architecture

```
browser (React + Solana wallet adapter)
   │  switch orders, previews, signed messages / transactions
   ▼
server (Node + Express)
   ├─ prices.ts      Pyth Hermes (per-feed entitlement detection), PreStocks API, Jupiter price API
   ├─ tokenState.ts  Token-2022 state: scaled-UI multiplier, pause flag, transfer fees
   ├─ engine.ts      trigger evaluation, safety checks, quotes, execution
   ├─ jupiter.ts     quotes, swap instructions, swap transactions
   ├─ solana.ts      approval, atomic switch, submission and confirmation
   └─ store.ts       intents (JSON file)
shared/              assets, parser, math, types (used by both sides)
```

## Run it

Requires Node 20+.

```bash
npm install
cp .env.example .env         # add PYTH_API_KEY (and a private RPC URL if you have one)
npm run keygen               # creates the keeper wallet in .env
npm run dev                  # site on http://localhost:5173 (app at /app), API on :8787
```

- **Paper mode** works with no key and no wallet.
- **One-tap live switches** need a connected wallet holding the source token.
- **Automatic live switches** also need about 0.02 SOL in the keeper wallet printed by `npm run keygen`.

Production: `npm run build && npm start` serves the app and API from one process on `PORT`.

Other scripts:

```bash
npm test                                   # intent parser cases
npm run simulate -- TSLA SPACEX 10         # dry-run an automatic switch on mainnet state
npx tsx scripts/sim-confirm.ts OPENAI ANTHROPIC 0.01   # dry-run a one-tap switch
```

### Configuration

| Variable | Purpose |
|---|---|
| `PYTH_API_KEY` | Pyth Hermes key (Bearer). Tandem detects which feeds the key can read; any other xStock is priced by Backed via Jupiter and runs in paper mode. |
| `PYTH_HERMES_URL` | Defaults to `https://pyth.dourolabs.app/hermes` |
| `SOLANA_RPC_URL` | Mainnet RPC; the public endpoint works for demos |
| `JUPITER_API_URL`, `JUPITER_API_KEY` | Defaults to the keyless `lite-api.jup.ag` |
| `KEEPER_SECRET_KEY` | Keeper wallet, created by `npm run keygen` |
| `TELEGRAM_BOT_TOKEN` | Optional. Turns on Telegram alerts; one bot serves every user |
| `APP_URL` | Public address used in alert links |
| `LIVE_EXECUTION` | Set to `false` to disable all real switches |

## Security model

- **Your stock stays in your wallet until the switch.** Automatic switches use a standard SPL approval capped at the exact amount of one token. Nothing else in the wallet is reachable, and the approval can be revoked at any time, from Tandem or any wallet.
- **One atomic transaction.** The approved amount is pulled, swapped through Jupiter with an on-chain minimum out, and delivered straight to your wallet's token account. If any step fails, the whole transaction reverts.
- **Only you can arm or cancel.** Live switches and cancellations are authorized by a signature from your wallet, so no one can arm a switch against your approval.
- **One-tap switches grant no approval at all.** You sign the swap yourself when it's ready.
- **The keeper holds only SOL** for network fees.

## Roadmap

- **On-chain switch program.** Enforce the trigger and the swap in a Solana program with on-chain Pyth price verification, so an approval can only ever execute the switch it was given for.
- **Push notifications** for one-tap switches on mobile.
- **Multi-leg rotations**, such as moving out of an index into a basket of names.

Availability: xStocks and PreStocks are offered by their issuers outside the US; see their terms for eligibility.
