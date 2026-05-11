import React, { useEffect, useMemo } from "react";
import { ethers } from "ethers";
import { createAppKit, useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from "@reown/appkit/react";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { defineChain } from "@reown/appkit/networks";
import { RPC_URL, ELECTRONEUM_CHAIN_ID, EXPLORER_BASE_URL } from "../config.js";

export const ELECTRONEUM_CHAIN_ID = ELECTRONEUM_CHAIN_ID;
export const RPC_URL = RPC_URL;
export const EXPLORER_BASE_URL = EXPLORER_BASE_URL;

export const electroneum = defineChain({
  id: ELECTRONEUM_CHAIN_ID,
  caipNetworkId: "eip155:52014",
  chainNamespace: "eip155",
  name: "Electroneum Mainnet",
  nativeCurrency: {
    name: "Electroneum",
    symbol: "ETN",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "Electroneum Explorer",
      url: "https://blockexplorer.electroneum.com",
    },
  },
});

const projectId = "146ee334d324044083b6427d4bbf9202";

const metadata = {
  name: "Core Clash",
  description: "Core Clash on Electroneum",
  url: window.location.origin,
  icons: [`${window.location.origin}/favicon.ico`],
};

export const appKitModal = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [electroneum],
  defaultNetwork: electroneum,
  projectId,
  metadata,
  features: {
    analytics: true,
    email: false,
    socials: false,
  },
});

export function useCoreClashWallet() {
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();

  const { address, isConnected, status } = useAppKitAccount({
    namespace: "eip155",
  });

  const { walletProvider } = useAppKitProvider("eip155");

  const provider = useMemo(() => {
    if (walletProvider) {
      return new ethers.BrowserProvider(walletProvider);
    }

    return new ethers.JsonRpcProvider(RPC_URL);
  }, [walletProvider]);

  const connectWallet = async () => {
    await open({ view: "Connect", namespace: "eip155" });
  };

  const disconnectWallet = async () => {
    await disconnect();
  };

  const ensureCorrectNetwork = async () => {
    if (!isConnected) return;

    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

    if (chainId !== ELECTRONEUM_CHAIN_ID) {
      await appKitModal.switchNetwork(electroneum);
    }
  };

  useEffect(() => {
    ensureCorrectNetwork().catch((err) => {
      console.warn("Network check failed:", err);
    });
  }, [isConnected, provider]);

  return {
    provider,
    account: address || null,
    isConnected,
    walletStatus: status,
    connectWallet,
    disconnectWallet,
    ensureCorrectNetwork,
  };
}

export default function CoreClashWalletButton({ account }) {
  const { connectWallet, disconnectWallet, isConnected } = useCoreClashWallet();

  return (
    <button
      onClick={isConnected ? disconnectWallet : connectWallet}
      style={{
        background: isConnected ? "#181818" : "#18bb1a",
        color: isConnected ? "#18bb1a" : "#050505",
        border: "1px solid #18bb1a",
        borderRadius: 10,
        padding: "10px 14px",
        fontWeight: 800,
        cursor: "pointer",
      }}
    >
      {isConnected && account
        ? `${account.slice(0, 6)}...${account.slice(-4)}`
        : "Connect Wallet"}
    </button>
  );
}