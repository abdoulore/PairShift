import "./polyfill";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles.css";
import { StrictMode } from "react";
import { BrowserRouter } from "react-router-dom";
import { createRoot } from "react-dom/client";
import { WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { App } from "./App";

// Wallets are discovered through the Wallet Standard (Phantom, Solflare, Backpack, ...).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </BrowserRouter>
  </StrictMode>,
);
