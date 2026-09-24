import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// Creates the keeper wallet and stores it in .env. The keeper only ever holds SOL for fees;
// user stocks pass through it inside a single atomic transaction.
const envPath = ".env";
const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : fs.readFileSync(".env.example", "utf8");
const existing = /^KEEPER_SECRET_KEY=(.+)$/m.exec(env)?.[1]?.trim();
if (existing) {
  const kp = Keypair.fromSecretKey(bs58.decode(existing));
  console.log(`Keeper already configured: ${kp.publicKey.toBase58()}`);
  process.exit(0);
}
const kp = Keypair.generate();
const line = `KEEPER_SECRET_KEY=${bs58.encode(kp.secretKey)}`;
const next = /^KEEPER_SECRET_KEY=.*$/m.test(env) ? env.replace(/^KEEPER_SECRET_KEY=.*$/m, line) : `${env.trimEnd()}\n${line}\n`;
fs.writeFileSync(envPath, next);
console.log(`Keeper created: ${kp.publicKey.toBase58()}`);
console.log("Fund it with ~0.02 SOL for transaction fees and token-account rent.");
