import { Connection, PublicKey } from "@solana/web3.js";
import { ASSETS } from "../shared/assets";
import { effectiveMultiplier } from "../shared/math";

interface TransferFee {
  epoch: number;
  bps: number;
  maxFee: bigint;
}

// On-chain state of each mint that matters for safety and pricing: the scaled-UI multiplier
// (changes on dividends/splits), the issuer's pause switch, and Token-2022 transfer fees.
export interface MintState {
  multiplier: number;
  newMultiplier: number;
  effectiveAt: number;
  paused: boolean;
  fee?: { older: TransferFee; newer: TransferFee };
  fetchedAt: number;
}

export class TokenState {
  private states = new Map<string, MintState>();
  private epoch = 0;
  lastError?: string;

  constructor(private conn: Connection) {}

  async refresh() {
    try {
      const keys = ASSETS.map((a) => new PublicKey(a.mint));
      const [infos, epoch] = await Promise.all([this.conn.getMultipleParsedAccounts(keys), this.conn.getEpochInfo()]);
      this.epoch = epoch.epoch;
      infos.value.forEach((info, i) => {
        const data = info?.data as any;
        const exts: any[] = data?.parsed?.info?.extensions ?? [];
        const scaled = exts.find((e) => e.extension === "scaledUiAmountConfig")?.state;
        const pausable = exts.find((e) => e.extension === "pausableConfig")?.state;
        const fee = exts.find((e) => e.extension === "transferFeeConfig")?.state;
        const toFee = (f: any): TransferFee => ({ epoch: Number(f.epoch), bps: Number(f.transferFeeBasisPoints), maxFee: BigInt(String(f.maximumFee).split(".")[0]) });
        this.states.set(ASSETS[i].ticker, {
          multiplier: scaled ? Number(scaled.multiplier) : 1,
          newMultiplier: scaled ? Number(scaled.newMultiplier) : 1,
          effectiveAt: scaled ? Number(scaled.newMultiplierEffectiveTimestamp) : 0,
          paused: Boolean(pausable?.paused),
          fee: fee ? { older: toFee(fee.olderTransferFee), newer: toFee(fee.newerTransferFee) } : undefined,
          fetchedAt: Date.now(),
        });
      });
      this.lastError = undefined;
    } catch (e) {
      this.lastError = (e as Error).message;
    }
  }

  start() {
    this.refresh();
    setInterval(() => this.refresh(), 60_000);
  }

  get(ticker: string): MintState | undefined {
    return this.states.get(ticker);
  }

  multiplier(ticker: string, nowSec = Date.now() / 1000): number {
    const s = this.states.get(ticker);
    return s ? effectiveMultiplier(s, nowSec) : 1;
  }

  /** Transfer fee in basis points currently charged by the mint (0 for most tokens). */
  feeBps(ticker: string): number {
    const f = this.states.get(ticker)?.fee;
    if (!f) return 0;
    return (this.epoch >= f.newer.epoch ? f.newer : f.older).bps;
  }

  /** Exact fee Token-2022 withholds when moving `amount` raw units (needed by transferCheckedWithFee). */
  feeFor(ticker: string, amount: bigint): bigint {
    const f = this.states.get(ticker)?.fee;
    if (!f) return 0n;
    const cfg = this.epoch >= f.newer.epoch ? f.newer : f.older;
    if (cfg.bps === 0) return 0n;
    const fee = (amount * BigInt(cfg.bps) + 9_999n) / 10_000n;
    return fee > cfg.maxFee ? cfg.maxFee : fee;
  }

  /** A multiplier change within `hours` of now (either side) means a corporate action is in flight. */
  corporateActionNear(ticker: string, hours: number, nowSec = Date.now() / 1000): { near: boolean; at?: number } {
    const s = this.states.get(ticker);
    if (!s || s.effectiveAt === 0 || s.newMultiplier === s.multiplier) return { near: false };
    return { near: Math.abs(s.effectiveAt - nowSec) <= hours * 3600, at: s.effectiveAt };
  }
}
