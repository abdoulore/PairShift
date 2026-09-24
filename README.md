# PairShift

**Switch between tokenized stocks when the relationship moves, not the price.**

PairShift lets you say *"move $300 from Tesla into SpaceX when SpaceX gets 5% cheaper relative to Tesla"* and does the rest on Solana. It turns the sentence into a measurable ratio trigger, watches the real-world prices behind both assets, refuses to trade on stale, drifting or mispriced data, and executes the stock-to-stock switch in a single transaction through Jupiter.

It works across **13 public stocks (Backed xStocks)** and **8 pre-IPO companies (PreStocks)**, including mixed pairs like Tesla into SpaceX.

Built for the Stocklana hackathon (Main track, PreStocks bounty).

---

## Why

People who hold tokenized stocks on Solana rotate between them: trim a winner into the index, buy a laggard after it underperforms, move from one private AI company into another. Today that means watching two charts, working out a ratio by hand, selling into USDC and buying back, with price risk in between. Existing limit orders trigger on one token's own price, not on how two assets move against each other.

Tokenized stocks also add risks most holders never check:

- They trade 24/7, while the real stock does not. At night and on weekends a token can drift away from its stock.
- Pre-IPO tokens trade far from their reference price. At the time of writing, OpenAI tokens traded about **33% above** their PreStocks mark and SpaceX about **19% below**.
- PreStocks charge a **1% transfer fee** on every transfer, which quietly eats small moves.

PairShift handles all three.

## How it works

1. **Describe the switch in plain English.** A deterministic parser extracts the pair, amount (dollars or shares), direction and threshold. Everything is editable as a sentence with inline controls.
2. **PairShift fixes a baseline.** The ratio *price of target / price of source* is measured from reference prices at arm time. "6% cheaper" means the ratio falls 6% from that baseline; "outperforms by 5%" means it rises 5%.
3. **It watches reference prices, not token prices.** Public stocks use **Pyth** equity feeds (`Equity.US.TSLA/USD`); pre-IPO tokens use the **PreStocks mark**.
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
   | Execution within slippage | A quote worse than market prices, after the known transfer fees |
   | Funds approved / wallet balance | Switches the wallet can't cover |

   The trigger must also hold across **3 fresh price updates on each leg**, so one bad tick can't fire a switch. PairShift also warns before you arm when fees and spread would eat most of the move, and pre-IPO pairs default to a 2.5% slippage limit to match their thinner pools.
5. **It executes in one of two ways:**
   - **Automatic** (source is an xStock): you sign one SPL approval for the exact amount. When the trigger fires, a keeper sends one atomic transaction: pull the approved amount, swap through Jupiter with a hard minimum out, and deliver the new stock straight into your wallet. If any step fails, nothing moves.
   - **One tap** (source is a PreStocks token): moving it through the keeper would cost an extra 1% transfer fee, so PairShift doesn't. When everything passes, the switch shows as *Ready*. You press Confirm, PairShift re-runs every check, and you sign a fresh swap from your own wallet.

Paper mode runs the same pipeline without moving funds.

## Verified against mainnet

The live paths were dry-run with `simulateTransaction` against current mainnet state, using real token holders as stand-ins (`scripts/simulate.ts`, `scripts/sim-confirm.ts`):

| Path | Pair | Result |
|---|---|---|
| Automatic | SPYx → NVDAx | Received 22,462,569 raw NVDAx vs 22,462,669 quoted; 968 bytes, 140k CU |
| Automatic | TSLAx → SpaceX | Received 16,471,098 raw SpaceX vs 16,470,950 quoted; new Token-2022 account created in the same transaction |
| One tap | OpenAI → Anthropic | Received 18,835,497 vs 18,835,427 predicted after the 1% input fee |

PairShift also corrects for a quoting gap it found: Jupiter quotes include a Token-2022 transfer fee on the output token but not on the input token, so PairShift prices the input fee itself and widens the on-chain minimum out by exactly that fee.

## Architecture

```
browser (React + Solana wallet adapter)
   │  plain-English intent, previews, signed messages / transactions
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
| `PYTH_API_KEY` | Pyth Hermes key (Bearer). PairShift detects which feeds the key can read; any other xStock is priced by Backed via Jupiter and runs in paper mode. |
| `PYTH_HERMES_URL` | Defaults to `https://pyth.dourolabs.app/hermes` |
| `SOLANA_RPC_URL` | Mainnet RPC; the public endpoint works for demos |
| `JUPITER_API_URL`, `JUPITER_API_KEY` | Defaults to the keyless `lite-api.jup.ag` |
| `KEEPER_SECRET_KEY` | Keeper wallet, created by `npm run keygen` |
| `LIVE_EXECUTION` | Set to `false` to disable all real switches |

## Security model

- **Your stock stays in your wallet until the switch.** Automatic switches use a standard SPL approval capped at the exact amount of one token. Nothing else in the wallet is reachable, and the approval can be revoked at any time, from PairShift or any wallet.
- **One atomic transaction.** The approved amount is pulled, swapped through Jupiter with an on-chain minimum out, and delivered straight to your wallet's token account. If any step fails, the whole transaction reverts.
- **Only you can arm or cancel.** Live switches and cancellations are authorized by a signature from your wallet, so no one can arm a switch against your approval.
- **One-tap switches grant no approval at all.** You sign the swap yourself when it's ready.
- **The keeper holds only SOL** for network fees.

## Roadmap

- **On-chain switch program.** Enforce the trigger and the swap in a Solana program with on-chain Pyth price verification, so an approval can only ever execute the switch it was given for.
- **Push notifications** for one-tap switches on mobile.
- **Multi-leg rotations**, such as moving out of an index into a basket of names.

Availability: xStocks and PreStocks are offered by their issuers outside the US; see their terms for eligibility.
