import { AddressLookupTableAccount, PublicKey, TransactionInstruction, type Connection } from "@solana/web3.js";
import { config } from "./config";

export interface JupQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: { percent: number; swapInfo: { label: string } }[];
  [k: string]: unknown;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (config.jupiterApiKey) h["x-api-key"] = config.jupiterApiKey;
  return h;
}

export async function getQuote(inputMint: string, outputMint: string, amountRaw: bigint | string, slippageBps: number): Promise<JupQuote> {
  const url =
    `${config.jupiterUrl}/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amountRaw.toString()}&slippageBps=${slippageBps}&swapMode=ExactIn&maxAccounts=40`;
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(8_000) });
  const body = (await res.json()) as JupQuote & { error?: string };
  if (!res.ok || body.error) throw new Error(`Jupiter quote: ${body.error ?? res.status}`);
  return body;
}

export function routeLabel(q: JupQuote): string {
  return q.routePlan.map((r) => r.swapInfo.label).join(" > ");
}

interface RawIx {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

const toIx = (ix: RawIx) =>
  new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, "base64"),
  });

/**
 * Swap instructions for `user` (the keeper) that deliver the output straight into
 * `destinationTokenAccount` (the owner's target-stock account).
 */
export async function getSwapInstructions(conn: Connection, quote: JupQuote, user: PublicKey, destinationTokenAccount: PublicKey) {
  const res = await fetch(`${config.jupiterUrl}/swap-instructions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: user.toBase58(),
      destinationTokenAccount: destinationTokenAccount.toBase58(),
      wrapAndUnwrapSol: false,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 200_000, priorityLevel: "high" } },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as {
    error?: string;
    computeBudgetInstructions: RawIx[];
    setupInstructions: RawIx[];
    swapInstruction: RawIx;
    cleanupInstruction?: RawIx;
    otherInstructions?: RawIx[];
    addressLookupTableAddresses: string[];
  };
  if (!res.ok || body.error) throw new Error(`Jupiter swap-instructions: ${body.error ?? res.status}`);

  const alts: AddressLookupTableAccount[] = [];
  if (body.addressLookupTableAddresses.length) {
    const infos = await conn.getMultipleAccountsInfo(body.addressLookupTableAddresses.map((a) => new PublicKey(a)));
    infos.forEach((info, i) => {
      if (info) alts.push(new AddressLookupTableAccount({ key: new PublicKey(body.addressLookupTableAddresses[i]), state: AddressLookupTableAccount.deserialize(info.data) }));
    });
  }
  return {
    computeBudget: body.computeBudgetInstructions.map(toIx),
    setup: body.setupInstructions.map(toIx),
    swap: toIx(body.swapInstruction),
    cleanup: body.cleanupInstruction ? [toIx(body.cleanupInstruction)] : [],
    other: (body.otherInstructions ?? []).map(toIx),
    alts,
  };
}

/** A complete swap transaction for `user` to sign themselves (one-tap confirm switches). */
export async function getSwapTransaction(quote: JupQuote, user: string): Promise<string> {
  const res = await fetch(`${config.jupiterUrl}/swap`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: user,
      wrapAndUnwrapSol: false,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 200_000, priorityLevel: "high" } },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { swapTransaction?: string; error?: string };
  if (!res.ok || !body.swapTransaction) throw new Error(`Jupiter swap: ${body.error ?? res.status}`);
  return body.swapTransaction;
}
