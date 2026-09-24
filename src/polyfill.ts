import { Buffer } from "buffer";

// @solana/web3.js expects Node's Buffer in the browser.
(globalThis as any).Buffer ??= Buffer;
