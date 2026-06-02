/* eslint-disable no-unused-vars */

import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { ethers } from "ethers";
import GameABI from "./abis/GameABI.json";
import ERC20ABI from "./abis/ERC20ABI.json";

import { useCoreClashWallet } from "./wallet/coreClashWallet.jsx";

import {
  GAME_ADDRESS,
  WHITELISTED_TOKENS,
  CORE_TOKEN,
  WHITELISTED_NFTS,
  VKIN_CONTRACT_ADDRESS,
  VQLE_CONTRACT_ADDRESS,
  SCIONS_CONTRACT_ADDRESS,
  EVG_CONTRACT_ADDRESS,
  RARE_BACKGROUNDS,
  ADMIN_ADDRESS,
  ADDRESS_TO_COLLECTION_KEY,
  BACKEND_URL,
  RPC_URL,
  ELECTRONEUM_CHAIN_ID,
  EXPLORER_BASE_URL,
} from "./config.js";

import { renderTokenImages } from "./renderTokenImages.jsx";

import {
  CoreClashLogo, AppBackground, PlanetZephyrosAE, HowToPlay, GameInfo, ElectroSwap,
  VerdantKinBanner, ElectroneumLogo, AetherScionsBanner, VerdantQueenBanner, EtnClubLogo, EvgBanner, 
  TelegramLogo, XLogo, PlanetZephyrosLogo
} from "./appMedia/media.js";

import { FaTelegramPlane } from "react-icons/fa";

import GameCard from "./gameCard.jsx";
import EcosystemBlock from "./ecosystemBlock.jsx";
import WalletXpPanel from "./walletXpPanel.jsx";

import "./App.css";

export default function App() {
/* ---------------- WALLET & PROVIDER ---------------- */
const {
  provider,
  account,
  isConnected,
  walletStatus,
  connectWallet,
  disconnectWallet,
  ensureCorrectNetwork,
} = useCoreClashWallet();

const readProvider = new ethers.JsonRpcProvider(RPC_URL);

/* ---------------- GAME SETUP ---------------- */
  const [stakeToken, setStakeToken] = useState("");
  const [stakeAmount, setStakeAmount] = useState("");

  const [validated, setValidated] = useState(false);
  const [validating, setValidating] = useState(false);

  useEffect(() => {
  if (!stakeToken && WHITELISTED_TOKENS.length > 0) {
    setStakeToken(WHITELISTED_TOKENS[0].address);
  }
}, [stakeToken]);

const [showHowToPlay, setShowHowToPlay] = useState(false);
const [showGameInfo, setShowGameInfo] = useState(false);
const [helpModal, setHelpModal] = useState(null);
const [showOwnershipWarning, setShowOwnershipWarning] = useState(false);

const ELECTRONEUM_CHAIN_HEX = "0xcb4e";

/* ---------------- CONTRACTS (READ ONLY) ---------------- */
const erc20 = useMemo(() => {
  if (!provider || !stakeToken) return null;
  return new ethers.Contract(stakeToken, ERC20ABI, provider);
}, [provider, stakeToken]);

const coreContract = useMemo(() => {
  if (!provider) return null;
  return new ethers.Contract(CORE_TOKEN, ERC20ABI, provider);
}, [provider]);

/* ---------------- NFT STATE ---------------- */
const [ownedNFTs, setOwnedNFTs] = useState([]);
const [nfts, setNfts] = useState([
  { address: "", tokenId: null, tokenURI: null, metadata: null },
  { address: "", tokenId: null, tokenURI: null, metadata: null },
  { address: "", tokenId: null, tokenURI: null, metadata: null },
]);

const [showNftGallery, setShowNftGallery] = useState(false);
const selectedNftCount = nfts.filter((n) => n?.tokenId).length;

function normalizeTokenId(id) {
  return String(id ?? "").trim().replace(/^0+/, "");
}

function resolveImage(mapping, collection, tokenId) {
  const cleanId = String(tokenId).replace(/^0+/, "").trim();
  return mapping?.[collection]?.[cleanId]?.image_file || null;
}

function normalizeAddr(addr) {
  return (addr || "").toLowerCase();
}

function getCollection(rawAddr) {
  const addr = normalizeAddr(rawAddr);

  if (addr === VKIN_CONTRACT_ADDRESS.toLowerCase()) return "VKIN";
  if (addr === VQLE_CONTRACT_ADDRESS.toLowerCase()) return "VQLE";
  if (addr === SCIONS_CONTRACT_ADDRESS.toLowerCase()) return "SCIONS";
  if (addr === EVG_CONTRACT_ADDRESS.toLowerCase()) return "EVG";

  console.warn("[UNKNOWN COLLECTION ADDRESS]", rawAddr);
  return null;
}

  /* ---------- DEBUG NFTs------------*/
useEffect(() => {
  console.group("NFT SLOTS DEBUG (ALL)");
  nfts.forEach((n, i) => {
    console.log(`Slot ${i}`, {
      address: n.address,
      tokenId: n.tokenId,
      metadata: n.metadata,
    });
  });
  console.groupEnd();
}, [nfts]);

useEffect(() => {
  console.log("ownedNFTs updated", ownedNFTs.length);
}, [ownedNFTs]);

const [nftRefreshLoading, setNftRefreshLoading] = useState(false);
const [nftRefreshMessage, setNftRefreshMessage] = useState("");
const [nftRefreshCooldownUntil, setNftRefreshCooldownUntil] = useState(0);

/* ---------------- MAPPING (CSV → JSON) ---------------- */
const [mapping, setMapping] = useState({});
const stableMappingRef = useRef(null);

useEffect(() => {
  async function loadMapping() {
    try {
const res = await fetch(
  `${BACKEND_URL}/nfts/mapping.json`
);

      const data = await res.json();

      const prev = stableMappingRef.current;

      // Only update if version changed (if backend provides it)
      if (!prev || prev.version !== data.version) {
        stableMappingRef.current = data;
        setMapping((prev) => {
  if (prev === data) return prev;
  return data;
});
      }
    } catch (err) {
      console.error("mapping load failed:", err);
    }
  }

  // initial load
  loadMapping();

  // interval refresh
  const interval = setInterval(loadMapping, 600000);

  return () => clearInterval(interval);
}, []);

const imageMapRef = useRef({});

useEffect(() => {
  if (!mapping) return;

  const cache = {};

  for (const collectionKey of Object.keys(mapping)) {
    const tokens = mapping[collectionKey];

    for (const tokenId of Object.keys(tokens)) {
      cache[`${collectionKey}:${tokenId}`] =
        `${BACKEND_URL}/images/${collectionKey}/${tokens[tokenId].image_file}`;
    }
  }

  imageMapRef.current = cache;
}, [mapping]);

  /* ---------------- GAMES STATE ---------------- */
  const [games, setGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [showResolved, setShowResolved] = React.useState(true);
  const [showCancelled, setShowCancelled] = React.useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [pendingAutoRevealGameId, setPendingAutoRevealGameId] = useState(null);
  const [activeTab, setActiveTab] = useState("open");
  const [weeklyArchive, setWeeklyArchive] = useState({});

  /* ---------------- LOADING SCREEN ---------------- */
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(5);
  const [progress, setProgress] = useState(0);

/* ---------------- Ecosystem State ---------------- */
const handleEcosystemClick = async (linkKey, url) => {
  try {
    if (account) {
      const res = await fetch(`${BACKEND_URL}/xp/ecosystem-click`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": account.toLowerCase(),
        },
        credentials: "include",
        body: JSON.stringify({ linkKey }),
      });

      const data = await res.json().catch(() => ({}));
      console.log("Ecosystem click response:", linkKey, res.status, data);

      if (!res.ok) {
        throw new Error(data.error || `Failed to track ${linkKey}`);
      }

      await loadXpProfile();
    }
  } catch (err) {
    console.warn(`Ecosystem XP tracking failed for ${linkKey}:`, err);
  }

  window.open(url, "_blank", "noopener,noreferrer");
};

const [xpProfile, setXpProfile] = useState(null);
const [xpLoading, setXpLoading] = useState(false);

// To prevent multiple rewards from the same ad click in one session
const rewardedSponsoredAdsRef = useRef(new Set());

const handleSponsoredAdClick = async (rewardKey, url) => {
  if (rewardedSponsoredAdsRef.current.has(rewardKey)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  rewardedSponsoredAdsRef.current.add(rewardKey);

  try {
    await handleEcosystemClick(rewardKey, url);
  } catch (err) {
    rewardedSponsoredAdsRef.current.delete(rewardKey);
    throw err;
  }
};
  
  /* ---------------- HANDLE GAMECREATED EVENT ---------------- */
  const [showDeviceWarning, setShowDeviceWarning] = useState(false);
  const [deviceConfirmed, setDeviceConfirmed] = useState(false);

/* ---------------- LOADING BAR ---------------- */
const [logoReady, setLogoReady] = useState(false);

useEffect(() => {
  if (!loading || !logoReady) return;

  const duration = 5000;
  const intervalTime = 50;
  const step = 100 / (duration / intervalTime);

  const timer = setInterval(() => {
    setProgress((prev) => {
      if (prev >= 100) {
        clearInterval(timer);
        setLoading(false);
        return 100;
      }

      return Math.min(prev + step, 100);
    });
  }, intervalTime);

  return () => clearInterval(timer);
}, [loading, logoReady]);

/// ---------------- XP PROFILE ----------------
const loadXpProfile = useCallback(async () => {
  if (!account) {
    setXpProfile(null);
    return;
  }

  try {
    setXpLoading(true);

    const res = await fetch(`${BACKEND_URL}/xp/me`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-wallet": account.toLowerCase(),
      },
      credentials: "include",
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to load XP");
    }

    setXpProfile(data);
  } catch (err) {
    console.warn("Failed to load XP profile:", err);
    setXpProfile(null);
  } finally {
    setXpLoading(false);
  }
}, [account]);

const claimDailyLoginXp = useCallback(async () => {
  if (!account) return;

  try {
    const res = await fetch(`${BACKEND_URL}/xp/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wallet": account.toLowerCase(),
      },
      credentials: "include",
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to claim daily login XP");
    }

    console.log("Daily login XP:", data);
  } catch (err) {
    console.warn("Daily login XP failed:", err);
  } finally {
    await loadXpProfile();
  }
}, [account, loadXpProfile]);

useEffect(() => {
  if (!account) {
    setXpProfile(null);
    return;
  }

  claimDailyLoginXp();
}, [account, claimDailyLoginXp]);

/* ---------------- OWNED NFT FETCH ---------------- */
useEffect(() => {
  if (!account) return setOwnedNFTs([]);

  const fetchOwned = async () => {
    try {
      let res = await fetch(`${BACKEND_URL}/nfts/owned/${account}`);
      let data = await res.json();

      console.log("Initial owned NFTs:", data);

if (data.length === 0) {
  console.warn("No NFTs — forcing cache population");
  try {
    const forceRes = await fetch(`${BACKEND_URL}/nfts/force-cache/${account}`, { method: 'POST' });
    if (!forceRes.ok) {
      const forceErr = await forceRes.json();
      console.error("Force cache failed:", forceErr);
      alert("Force cache failed: " + (forceErr.error || "Unknown error"));
    } else {
      console.log("Force cache succeeded");
    }

    res = await fetch(`${BACKEND_URL}/nfts/owned/${account}`);
    data = await res.json();
    console.log("Retry owned NFTs:", data);
  } catch (forceErr) {
    console.error("Force cache error:", forceErr);
  }
}
setOwnedNFTs((prev) => {
  if (!data?.length) return [];

  const same =
    prev.length === data.length &&
    prev.every((a, i) =>
      a.tokenId === data[i].tokenId &&
      a.nftAddress === data[i].nftAddress
    );

  return same ? prev : data;
});
    } catch (err) {
      console.error("Owned fetch error:", err);
      setOwnedNFTs([]);
    }
  };

  fetchOwned();
}, [account]);

const refreshNftGallery = async (e) => {
  e.stopPropagation();

  if (!account || nftRefreshLoading) return;

  const now = Date.now();
  if (now < nftRefreshCooldownUntil) {
    setNftRefreshMessage("Please wait a few minutes before refreshing again.");
    return;
  }

  setNftRefreshLoading(true);
  setNftRefreshMessage("Refreshing NFT cache... this may take a few minutes.");

  try {
    const res = await fetch(`${BACKEND_URL}/nfts/owned/${account}?refresh=true`);

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      setNftRefreshMessage(data.error || "Refresh is on cooldown.");
      return;
    }

    if (!res.ok) throw new Error("Refresh failed");

    const freshNfts = await res.json();
    setOwnedNFTs(freshNfts); // change if your setter has a different name

    setNftRefreshCooldownUntil(Date.now() + 5 * 60 * 1000);
    setNftRefreshMessage("NFT gallery refreshed.");
  } catch (err) {
    console.error("NFT refresh failed:", err);
    setNftRefreshMessage("Refresh failed. Please try again shortly.");
  } finally {
    setNftRefreshLoading(false);
  }
};

  /* ---------------- NFT UPDATE ---------------- */
  const updateNFT = (idx, field, value) => {
    setNfts((prev) => {
      const copy = [...prev];
      copy[idx][field] = value;
      if (field === "address" || field === "tokenId") {
        copy[idx].metadata = null;
        setValidated(false);
      }
      return copy;
    });
  };

const validateTeam = useCallback(async () => {
  setValidating(true);
  try {
    const seenNames = new Set();
    const seenRareBackgrounds = new Set();

    for (const n of nfts) {
      if (!n.metadata) {
        throw new Error("Missing metadata for one or more NFTs");
      }

let { name, background } = n.metadata;

name = name?.trim().toLowerCase();
background = background?.trim();

      if (!name || !background) {
        throw new Error(`Incomplete metadata for token #${n.tokenId || "?"}`);
      }

      // Duplicate character check
if (seenNames.has(name)) {
  throw new Error(`Duplicate character: ${n.metadata.name}`);
}
seenNames.add(name);

// Rare background rule (robust, no Set dependency)
if (RARE_BACKGROUNDS.includes(background)) {
  if (seenRareBackgrounds.has(background)) {
    throw new Error(`Rare background duplicated: ${background}`);
  }
  seenRareBackgrounds.add(background);
}
      }

    setValidated(true);
    alert("Team validated successfully!");
  } catch (e) {
    alert(`Validation failed: ${e.message}`);
  } finally {
    setValidating(false);
  }
}, [nfts]);

/* -------- APPROVE TOKENS ---------- */
const approveTokens = async () => {
  if (!stakeToken || !stakeAmount) {
    alert("Missing stake token or amount");
    return;
  }

  if (!account) {
    await connectWallet();
    return;
  }

  if (!provider) {
    alert("Provider not ready");
    return;
  }

  try {
    await ensureCorrectNetwork();

    const signer = await provider.getSigner();
    const liveAccount = await signer.getAddress();

    const erc20 = new ethers.Contract(stakeToken, ERC20ABI, signer);

    const stakeWei = ethers.parseUnits(stakeAmount.toString(), 18);

    const allowance = await erc20.allowance(liveAccount, GAME_ADDRESS);

    // Optional but smart: avoid unnecessary approvals
    if (allowance >= stakeWei) {
      alert("Already approved");
      return;
    }

    const tx = await erc20.approve(GAME_ADDRESS, stakeWei);
    await tx.wait();

    alert("Tokens approved successfully");
  } catch (err) {
    console.error(err);
    alert(err.reason || err.message || "Approval failed");
  }
};

const downloadRevealBackup = useCallback(
  ({ gameId, player, salt, nftContracts, tokenIds, backgrounds }) => {
    const payload = {
      gameId: Number(gameId),
      player,
      salt: salt.toString(),
      nftContracts,
      tokenIds: tokenIds.map(t => t.toString()),
      backgrounds: backgrounds || [],
    };

    const playerKey =
      player.toLowerCase() === account.toLowerCase()
        ? "p1"
        : `p2_${gameId}`;

    localStorage.setItem(`${playerKey}_salt`, payload.salt);
    localStorage.setItem(
      `${playerKey}_nftContracts`,
      JSON.stringify(payload.nftContracts)
    );
    localStorage.setItem(
      `${playerKey}_tokenIds`,
      JSON.stringify(payload.tokenIds)
    );
    localStorage.setItem(
      `${playerKey}_backgrounds`,
      JSON.stringify(payload.backgrounds)
    );

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coreclash-reveal-game-${payload.gameId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
  [account]
);

/* ---------------- LOAD GAMES ---------------- */
const loadGames = useCallback(async () => {
  setLoadingGames(true);

  try {
const contract = new ethers.Contract(GAME_ADDRESS, GameABI, readProvider);

    // 1️⃣ Load on-chain games
    const loadedOnChain = [];
    let i = 0;
    while (true) {
      try {
        const gameData = await contract.games(i);
        if (gameData.player1 === ethers.ZeroAddress) break;

        loadedOnChain.push({
          id: i,
          player1: gameData.player1,
          player2: gameData.player2,
          stakeAmount: gameData.stakeAmount.toString(),
          stakeToken: gameData.stakeToken,
          settled: gameData.settled,
          winner: gameData.winner,
          player1Revealed: gameData.player1Revealed,
          player2Revealed: gameData.player2Revealed,
        });

        i++;
      } catch {
        break;
      }
    }

    // 2️⃣ Fetch backend games
    const res = await fetch(`${BACKEND_URL}/games`);
    if (!res.ok) throw new Error("Backend fetch failed");
    const backendGames = await res.json();

    // 3️⃣ Merge on-chain + backend
const merged = backendGames.map((backendGame) => {
  const onChainGame = loadedOnChain.find(g => g.id === backendGame.id) || {};

  return {
    id: backendGame.id,
    player1: onChainGame.player1 || backendGame.player1 || ethers.ZeroAddress,
    player2: onChainGame.player2 || backendGame.player2 || ethers.ZeroAddress,
    stakeAmount: onChainGame.stakeAmount?.toString() || "0",
    stakeToken: backendGame.stakeToken || onChainGame.stakeToken,
    player1Revealed: !!backendGame.player1Revealed,
    player2Revealed: !!backendGame.player2Revealed,
    player1Reveal: backendGame.player1Reveal || null,
    player2Reveal: backendGame.player2Reveal || null,
    player2JoinedAt: backendGame.player2JoinedAt || null,
    createdAt: backendGame.createdAt || null,
    roundResults: backendGame.roundResults || [],
    winner: backendGame.winner || onChainGame.winner || ethers.ZeroAddress,
    tie: !!backendGame.tie,
    settled: backendGame.settled === true || onChainGame.settled === true,
    settledAt: backendGame.settledAt || null,
    settleTxHash: backendGame.settleTxHash || null,
    cancelled: backendGame.cancelled === true,
  };
});

    setGames(merged);
  } catch (err) {
    console.error("loadGames failed:", err);
  } finally {
    setLoadingGames(false);
  }
}, []); // ✅ no dependencies, ESLint clean

useEffect(() => {
  loadGames(); // initial load
  const interval = setInterval(loadGames, 30_000); // refresh every 30s
  return () => clearInterval(interval);
}, [loadGames]);

/* ---------------- REVEAL SUCCESS – Trigger backend compute ---------------- */
  const triggerBackendComputeIfNeeded = useCallback(async (gameId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/games/${gameId}/compute-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json();
        console.warn("Backend compute-results failed:", err);
      } else {
        console.log(`Backend compute-results triggered for game ${gameId}`);
        await loadGames();
      }
    } catch (err) {
      console.error("Trigger compute failed:", err);
    }
  }, [loadGames]);

  /* ---------------- SSE CONNECTION ---------------- */
  useEffect(() => {
    const es = new EventSource(`${BACKEND_URL}/events/stream`);

    const refresh = () => loadGames();
    es.addEventListener("GameCreated", refresh);
    es.addEventListener("GameJoined", refresh);
    es.addEventListener("GameCancelled", refresh);
    es.addEventListener("GameSettled", refresh);

    es.onerror = () => {
      console.warn("SSE disconnected");
      es.close();
    };

    return () => es.close();
  }, [loadGames]);

/// ---------------- CREATE GAME ---------------- */
const createGame = useCallback(async () => {
  if (!validated) {
    alert("Team not validated");
    return;
  }

  if (!account) {
    await connectWallet();
    return;
  }

  if (!provider) {
    alert("Provider not ready");
    return;
  }

  if (!stakeToken || !stakeAmount || nfts.some(n => !n.address || !n.tokenId)) {
    alert("All fields must be completed before creating a game");
    return;
  }

  try {
    await ensureCorrectNetwork();

    const signerSafe = await provider.getSigner();

    const gameContract = new ethers.Contract(GAME_ADDRESS, GameABI, signerSafe);
    const erc20Write = new ethers.Contract(stakeToken, ERC20ABI, signerSafe);

    const readProvider = new ethers.JsonRpcProvider(RPC_URL);
    const erc20Read = new ethers.Contract(stakeToken, ERC20ABI, readProvider);

    const stakeWei = ethers.parseUnits(stakeAmount.toString(), 18);

    let allowance;
    try {
      allowance = await erc20Read.allowance(account, GAME_ADDRESS);
    } catch (err) {
      console.error("Allowance check failed:", err);
      throw new Error("Could not read allowance. Check RPC or network.");
    }

    if (allowance < stakeWei) {
      const approveTx = await erc20Write.approve(GAME_ADDRESS, stakeWei);
      await approveTx.wait();
    }

    const salt = ethers.toBigInt(ethers.randomBytes(32));
    const nftContracts = nfts.map((n) => n.address);
    const tokenIds = nfts.map((n) => BigInt(n.tokenId));

    const commit = ethers.solidityPackedKeccak256(
      [
        "uint256",
        "address",
        "address",
        "address",
        "uint256",
        "uint256",
        "uint256",
      ],
      [salt, ...nftContracts, ...tokenIds]
    );

    const tx = await gameContract.createGame(stakeToken, stakeWei, commit);
    const receipt = await tx.wait();

    const parsedLogs = receipt.logs
      .map((log) => {
        try {
          return gameContract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const createdEvent = parsedLogs.find((e) => e.name === "GameCreated");

    if (!createdEvent) {
      throw new Error("GameCreated event not found");
    }

    const gameId = Number(createdEvent.args.gameId);

    downloadRevealBackup({
      gameId,
      player: account.toLowerCase(),
      salt: salt.toString(),
      nftContracts,
      tokenIds: tokenIds.map((t) => t.toString()),
      backgrounds: nfts.map((n) => n.metadata?.background || ""),
    });

    const backendRes = await fetch(`${BACKEND_URL}/games`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        gameId,
        creator: account,
        stakeToken,
        stakeAmount: stakeWei.toString(),
      }),
    });

    const backendData = await backendRes.json();

    if (!backendRes.ok || !backendData.success) {
      console.error("Backend game save failed:", backendData);
      throw new Error(backendData.error || "Failed to save game to backend");
    }

    alert(`Game #${gameId} created successfully!\nReveal file downloaded.`);

    await loadGames();
    await loadXpProfile();
  } catch (err) {
    console.error("Create game failed:", err);
    alert(err.reason || err.message || "Create game failed");
  }
}, [
  validated,
  stakeToken,
  stakeAmount,
  nfts,
  account,
  provider,
  connectWallet,
  ensureCorrectNetwork,
  loadGames,
  loadXpProfile,
  downloadRevealBackup,
]);

/* ---------------- JOIN GAME ---------------- */
const joinGame = async (gameId) => {
  if (!account) {
    await connectWallet();
    return;
  }

  if (!provider) {
    alert("Provider not ready");
    return;
  }

  if (nfts.some((n) => !n.address || !n.tokenId)) {
    alert("Select your full team before joining a game");
    return;
  }

  try {
    await ensureCorrectNetwork();

    const numericGameId = Number(gameId);

    const liveSigner = await provider.getSigner();
    const liveAccount = await liveSigner.getAddress();

    if (!liveAccount || liveAccount === ethers.ZeroAddress) {
      throw new Error("Invalid wallet address");
    }

    const contractRead = new ethers.Contract(GAME_ADDRESS, GameABI, provider);
    const contractWrite = contractRead.connect(liveSigner);

    const gameRes = await fetch(`${BACKEND_URL}/games/${numericGameId}`);
    if (!gameRes.ok) {
      throw new Error("Failed to fetch game details");
    }

    const gameData = await gameRes.json();

    const joinStakeToken = gameData.stakeToken;
    const joinStakeAmount = gameData.stakeAmount;

    if (!joinStakeToken || !joinStakeAmount) {
      throw new Error("Missing stake information from game");
    }

    const salt = ethers.toBigInt(ethers.randomBytes(32));
    const nftContracts = nfts.map((n) => n.address);
    const tokenIds = nfts.map((n) => BigInt(n.tokenId));
    const backgrounds = nfts.map((n) => n.metadata?.background || "");

    downloadRevealBackup({
      gameId: numericGameId,
      player: liveAccount.toLowerCase(),
      salt: salt.toString(),
      nftContracts,
      tokenIds: tokenIds.map((t) => t.toString()),
      backgrounds,
    });

    const prefix = `${liveAccount.toLowerCase()}_${numericGameId}`;
    localStorage.setItem(`${prefix}_salt`, salt.toString());
    localStorage.setItem(`${prefix}_nftContracts`, JSON.stringify(nftContracts));
    localStorage.setItem(
      `${prefix}_tokenIds`,
      JSON.stringify(tokenIds.map((t) => t.toString()))
    );
    localStorage.setItem(`${prefix}_backgrounds`, JSON.stringify(backgrounds));

    const commit = ethers.solidityPackedKeccak256(
      [
        "uint256",
        "address",
        "address",
        "address",
        "uint256",
        "uint256",
        "uint256",
      ],
      [salt, ...nftContracts, ...tokenIds]
    );

    const erc20 = new ethers.Contract(joinStakeToken, ERC20ABI, liveSigner);
    const stakeWei = ethers.parseUnits(joinStakeAmount.toString(), 18);

    const allowance = await erc20.allowance(liveAccount, GAME_ADDRESS);

    if (allowance < stakeWei) {
      const approveTx = await erc20.approve(GAME_ADDRESS, stakeWei);
      await approveTx.wait();
      alert("Tokens approved!");
    }

    const tx = await contractWrite.joinGame(numericGameId, commit);
    await tx.wait();

    const gameOnChain = await contractRead.games(numericGameId);

    if (gameOnChain.player2.toLowerCase() !== liveAccount.toLowerCase()) {
      throw new Error("On-chain player mismatch");
    }

    const joinRes = await fetch(`${BACKEND_URL}/games/${numericGameId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        player2: gameOnChain.player2,
        player2JoinedAt: new Date().toISOString(),
      }),
    });

    const joinData = await joinRes.json();

    if (!joinRes.ok || !joinData.success) {
      throw new Error(joinData.error || "Backend join failed");
    }

    const refreshedGameRes = await fetch(`${BACKEND_URL}/games/${numericGameId}`);

    if (!refreshedGameRes.ok) {
      throw new Error("Failed to fetch refreshed game after join");
    }

    const refreshedGameData = await refreshedGameRes.json();

    await autoRevealIfPossible({
      ...refreshedGameData,
      id: numericGameId,
    });

    alert(`Joined game #${numericGameId} successfully!`);

    await loadGames();
    await loadXpProfile();
    setPendingAutoRevealGameId(numericGameId);
  } catch (err) {
    console.error("Join game failed:", err);
    alert(err.reason || err.message || "Join failed");
  }
};

/* -------- CANCEL UNJOINED GAME ----------- */
const cancelUnjoinedGame = async (gameId) => {
  if (!account) {
    await connectWallet();
    return;
  }

  if (!provider) {
    alert("Provider not ready");
    return;
  }

  try {
    await ensureCorrectNetwork();

    const liveSigner = await provider.getSigner();

    const contract = new ethers.Contract(
      GAME_ADDRESS,
      GameABI,
      liveSigner
    );

    const tx = await contract.cancelUnjoinedGame(Number(gameId));
    await tx.wait();

    await loadGames();

    alert(`Game #${gameId} cancelled successfully`);
  } catch (err) {
    console.error("Cancel failed:", err);
    alert(err.reason || err.message || "Cancel failed");
  }
};

/* ---------------- AUTO REVEAL (CHAIN AUTHORITATIVE) ---------------- */
const autoRevealIfPossible = useCallback(
  async (g) => {
    if (!account || !provider) return;

    try {
      await ensureCorrectNetwork();

      const contractRead = new ethers.Contract(GAME_ADDRESS, GameABI, provider);

      const signer = await provider.getSigner();
      const liveAccount = await signer.getAddress();
      const liveAccountLower = liveAccount.toLowerCase();

      const contractWrite = new ethers.Contract(GAME_ADDRESS, GameABI, signer);

      const chainGame = await contractRead.games(BigInt(g.id));

      const zeroLower = ethers.ZeroAddress.toLowerCase();

      const player1 = chainGame.player1.toLowerCase();
      const player2 = chainGame.player2.toLowerCase();

      const isP1 = player1 === liveAccountLower;
      const isP2 = player2 === liveAccountLower;

      if (!isP1 && !isP2) return;

      if (
        (isP1 && chainGame.player1Revealed) ||
        (isP2 && chainGame.player2Revealed)
      ) {
        return;
      }

      if (player2 === zeroLower) return;

      const prefix = `${liveAccountLower}_${g.id}`;
      const saltStr = localStorage.getItem(`${prefix}_salt`);
      const nftContractsStr = localStorage.getItem(`${prefix}_nftContracts`);
      const tokenIdsStr = localStorage.getItem(`${prefix}_tokenIds`);

      if (!saltStr || !nftContractsStr || !tokenIdsStr) return;

      const salt = BigInt(saltStr);
      const nftContracts = JSON.parse(nftContractsStr);
      const tokenIds = JSON.parse(tokenIdsStr).map(BigInt);

      const tx = await contractWrite.reveal(
        BigInt(g.id),
        salt,
        nftContracts,
        tokenIds
      );

      await tx.wait();

      const revealRes = await fetch(`${BACKEND_URL}/games/${g.id}/reveal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": liveAccountLower,
        },
        body: JSON.stringify({
          player: liveAccountLower,
          salt: salt.toString(),
          nftContracts,
          tokenIds: tokenIds.map((t) => t.toString()),
        }),
      });

      const revealJson = await revealRes.json().catch(() => ({}));

      console.log("Reveal response:", revealRes.status, revealJson);

      if (!revealRes.ok) {
        throw new Error(
          revealJson.error || `Reveal failed (${revealRes.status})`
        );
      }

      console.log("Auto-reveal completed", g.id, revealJson);

      await triggerBackendComputeIfNeeded(g.id);
      await loadGames();
      await loadXpProfile();
    } catch (err) {
      console.error("Auto-reveal failed:", err);
    }
  },
  [
    account,
    provider,
    ensureCorrectNetwork,
    triggerBackendComputeIfNeeded,
    loadGames,
    loadXpProfile,
  ]
);

/* ---------------- REVEAL FILE UPLOAD ---------------- */
const handleRevealFile = useCallback(
  async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const { gameId, salt, nftContracts, tokenIds, backgrounds } = data;

      if (
        gameId === undefined ||
        !salt ||
        !Array.isArray(nftContracts) ||
        !Array.isArray(tokenIds) ||
        !Array.isArray(backgrounds)
      ) {
        throw new Error("Invalid reveal file");
      }

      if (!account) {
        await connectWallet();
        return;
      }

      if (!provider) {
        throw new Error("Provider not ready");
      }

      await ensureCorrectNetwork();

      const signer = await provider.getSigner();
      const liveAccount = await signer.getAddress();

      const contract = new ethers.Contract(
        GAME_ADDRESS,
        GameABI,
        signer
      );

      // 1️⃣ On-chain reveal
      const tx = await contract.reveal(
        BigInt(gameId),
        BigInt(salt),
        nftContracts,
        tokenIds.map((id) => BigInt(id)),
        backgrounds
      );

      await tx.wait();
      console.log("On-chain reveal succeeded for game", gameId);

      // 2️⃣ Backend reveal
      let backendData;

      try {
        const res = await fetch(`${BACKEND_URL}/games/${gameId}/reveal`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-wallet": liveAccount.toLowerCase(),
          },
          body: JSON.stringify({
            player: liveAccount.toLowerCase(),
            salt,
            nftContracts,
            tokenIds,
            backgrounds,
          }),
        });

let backendData = null;

try {
  backendData = await res.json();
} catch {
  backendData = {};
}

        if (!res.ok) {
          throw new Error(
            backendData.error || "Backend reveal failed"
          );
        }

        console.log("Backend reveal succeeded for game", gameId);
      } catch (backendErr) {
        console.warn(
          "Backend reveal failed, but on-chain succeeded:",
          backendErr
        );

        alert(
          "Reveal succeeded on-chain but failed to update backend. Please retry posting reveal."
        );

        return;
      }

      // 3️⃣ Trigger compute + refresh
      await triggerBackendComputeIfNeeded(gameId);
      await loadGames();
      await loadXpProfile();

      alert("Reveal successful!");
    } catch (err) {
      console.error("Reveal failed:", err);
      alert(`Reveal failed: ${err.message}`);
    }
  },
  [
    account,
    provider,
    connectWallet,
    ensureCorrectNetwork,
    triggerBackendComputeIfNeeded,
    loadGames,
    loadXpProfile,
  ]
);

/* ------ MANUAL SETTLE GAME -------- */
const manualSettleGame = useCallback(
  async (gameId) => {
    try {
      if (!account) {
        await connectWallet();
        return;
      }

      if (!provider) {
        alert("Provider not ready");
        return;
      }

      await ensureCorrectNetwork();

      const liveSigner = await provider.getSigner();
      const liveAccount = await liveSigner.getAddress();

      const computeHttpRes = await fetch(
        `${BACKEND_URL}/games/${gameId}/compute-results`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const computeRes = await computeHttpRes.json();

      if (!computeHttpRes.ok || !computeRes.success) {
        alert(`Failed to compute results: ${computeRes.error || "Unknown error"}`);
        return;
      }

      console.log("Computed results:", computeRes);

      const postWinnerHttpRes = await fetch(
        `${BACKEND_URL}/games/${gameId}/post-winner`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-wallet": liveAccount.toLowerCase(),
          },
        }
      );

      const postWinnerRes = await postWinnerHttpRes.json();

      if (
        (!postWinnerHttpRes.ok || !postWinnerRes.success) &&
        !postWinnerRes.alreadyPosted
      ) {
        alert(`Failed to post winner: ${postWinnerRes.error || "Unknown error"}`);
        return;
      }

      console.log("Winner posted:", postWinnerRes);

      const settleHttpRes = await fetch(
        `${BACKEND_URL}/games/${gameId}/settle-game`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-wallet": liveAccount.toLowerCase(),
          },
          body: JSON.stringify({
            settledBy: liveAccount,
          }),
        }
      );

      const settleRes = await settleHttpRes.json();

      if ((!settleHttpRes.ok || !settleRes.success) && !settleRes.alreadySettled) {
        alert(`Failed to settle game: ${settleRes.error || "Unknown error"}`);
        return;
      }

      if (settleRes.alreadySettled) {
        console.log(`Game ${gameId} already settled on-chain`);
      } else {
        console.log(`Game ${gameId} settled successfully:`, settleRes.txHash);
      }

      if (!postWinnerRes.txHash && !postWinnerRes.alreadyPosted) {
        throw new Error(
          "Awaiting on-chain postWinner and settleGame transaction. Please refresh games shortly."
        );
      }

      await loadGames();
      await loadXpProfile();
    } catch (err) {
      console.error("Manual settle failed:", err);
      alert(err.message || "Manual settle failed");
    }
  },
  [
    account,
    provider,
    connectWallet,
    ensureCorrectNetwork,
    loadGames,
    loadXpProfile,
  ]
);

/// ---------------- XP LEVELS & PROGRESS CALCULATION ----------------
const XP_LEVELS = [
  { level: 1, minXp: 0 },
  { level: 2, minXp: 200 },
  { level: 3, minXp: 500 },
  { level: 4, minXp: 1000 },
  { level: 5, minXp: 1750 },
  { level: 6, minXp: 2750 },
  { level: 7, minXp: 4250 },
  { level: 8, minXp: 6000 },
  { level: 9, minXp: 8000 },
  { level: 10, minXp: 12000 },
];

/// ------------- Calculate XP progress within current level (0-100%) -------------
const getLevelProgress = (xp, level) => {
  const currentIndex = XP_LEVELS.findIndex((l) => l.level === level);
  if (currentIndex === -1) return 0;

  const currentMin = XP_LEVELS[currentIndex].minXp;
  const nextMin = XP_LEVELS[currentIndex + 1]?.minXp;

  if (!nextMin) return 100;

  const span = nextMin - currentMin;
  const progress = ((xp - currentMin) / span) * 100;

  return Math.max(0, Math.min(100, progress));
};

/// ---------------- MODAL STYLES ----------------
const modalOverlayStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0,0,0,0.6)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 1000,
};

const modalBoxStyle = {
  background: "#111",
  padding: 24,
  borderRadius: 12,
  width: 400,
  maxWidth: "90%",
  color: "#fff",
};

  /* ---------------- GAME CARD PROPS ---------------- */
const gameCardProps = {
  account,
  approveTokens,
  joinGame,
  manualSettleGame,
  handleRevealFile,
  cancelUnjoinedGame,
  renderTokenImages,
  downloadRevealBackup,
};

/* ---------------- BACKGROUND PRIORITY ---------------- */
const backgroundPriority = {
  Gold: 0,
  "Rose Gold": 1,
  "Verdant Green": 2,
  "Aether Purple": 3,
  Silver: 4,
};

/* ---------------- FILTERED + SORTED GAMES ---------------- */
const openGames = games
  .filter(
    (g) =>
      (!g.player2 || g.player2 === ethers.ZeroAddress) &&
      !g.settled &&
      !g.cancelled
  )
  .sort((a, b) => b.id - a.id);

const activeGames = games
  .filter(
    (g) =>
      g.player2 &&
      g.player2 !== ethers.ZeroAddress &&
      !g.settled &&
      !g.cancelled
  )
  .sort((a, b) => b.id - a.id);

const isTrue = (v) => v === true || v === "true";

const hasRealPlayer2 = (g) =>
  !!g.player2 && g.player2 !== ethers.ZeroAddress;

const isPreJoinCancelled = (g) =>
  isTrue(g.cancelled) && !hasRealPlayer2(g);

const settledGames = games
  .filter((g) => isTrue(g.settled) && !isPreJoinCancelled(g))
  .sort((a, b) => b.id - a.id);

const cancelledGames = games
  .filter((g) => isTrue(g.cancelled))
  .sort((a, b) => b.id - a.id);

const sortedSettledGames = [...settledGames]
  .filter((g) => g.settledAt)
  .sort((a, b) => new Date(b.settledAt) - new Date(a.settledAt));
  
const latestSettled = sortedSettledGames.slice(0, 10);
const archivedSettled = sortedSettledGames.slice(10);

/* ---------------- LEADERBOARD ---------------- */
const [leaderboardMode, setLeaderboardMode] = useState("alltime"); // "alltime" | "weekly" | "characters" | "xp"
const [showWeekly, setShowWeekly] = useState(false);
const [showWeeklyHistory, setShowWeeklyHistory] = useState(false);

const isAllTimeMode = leaderboardMode === "alltime";
const isWeeklyMode = leaderboardMode === "weekly";
const isCharacterMode = leaderboardMode === "characters";
const isXpMode = leaderboardMode === "xp";

const isXpInactive = (lastClaimed) => {
  if (!lastClaimed) return true;

  const last = new Date(lastClaimed).getTime();
  if (Number.isNaN(last)) return true;

  return Date.now() - last > 3 * 24 * 60 * 60 * 1000;
};

const leaderboard = useMemo(() => {
  const stats = {};

  games
    .filter((g) => g.settled && !g.cancelled)
    .forEach((g) => {
      const p1 = g.player1?.toLowerCase();
      const p2 = g.player2?.toLowerCase();
      const winner = g.winner?.toLowerCase();
      const isTie = g.tie;

      [p1, p2].forEach((player) => {
        if (!player || player === ethers.ZeroAddress.toLowerCase()) return;

        if (!stats[player]) stats[player] = { wins: 0, played: 0 };
        stats[player].played += 1;
      });

      if (!isTie && winner && winner !== ethers.ZeroAddress.toLowerCase()) {
        if (!stats[winner]) stats[winner] = { wins: 0, played: 0 };
        stats[winner].wins += 1;
      }
    });

  return Object.entries(stats)
    .map(([address, data]) => ({
      address,
      wins: data.wins,
      played: data.played,
      winRate: data.played > 0 ? Math.round((data.wins / data.played) * 100) : 0,
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.winRate - a.winRate;
    })
    .slice(0, 10);
}, [games]);

const [characterNameMap, setCharacterNameMap] = useState({});

const resolveCollectionKeyFromAddress = (rawAddr) => {
  const addr = (rawAddr || "").toLowerCase();

  if (addr === VKIN_CONTRACT_ADDRESS.toLowerCase()) return "VKIN";
  if (addr === VQLE_CONTRACT_ADDRESS.toLowerCase()) return "VQLE";
  if (addr === SCIONS_CONTRACT_ADDRESS.toLowerCase()) return "SCIONS";
  if (addr === EVG_CONTRACT_ADDRESS.toLowerCase()) return "EVG";
  return null;
};

const [xpData, setXpData] = useState({ playerXp: {}, xpActions: {} });

useEffect(() => {
  fetch(`${BACKEND_URL}/leaderboard/xp-leaderboard`)
    .then((res) => res.json())
    .then((data) => {
      setXpData({
        playerXp: data.playerXp || {},
        xpActions: data.xpActions || {},
      });
    })
    .catch(console.error);
}, []);

const xpLeaderboard = useMemo(() => {
  const playerXp = xpData?.playerXp || {};
  const xpActions = xpData?.xpActions || {};

  const getLastClaim = (wallet) => {
    const actions = xpActions[wallet];
    if (!actions) return null;

    const dates = [];

    if (actions.dailyLogin?.lastClaimedDate) {
      dates.push(actions.dailyLogin.lastClaimedDate);
    }

    if (actions.ecosystemClicks) {
      Object.values(actions.ecosystemClicks).forEach((d) => {
        if (d) dates.push(d);
      });
    }

    return dates.sort().at(-1) || null;
  };

  return Object.entries(playerXp)
    .map(([wallet, data]) => ({
      address: wallet.toLowerCase(),
      xp: Number(data.xp || 0),
      level: Number(data.level || 0),
      updatedAt: data.updatedAt || null,
      lastClaimed: getLastClaim(wallet.toLowerCase()),
    }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 20);
}, [xpData]);

useEffect(() => {
  const loadCharacterNames = async () => {
    try {
      const needed = new Map();

      games
        .filter((g) => g.settled && !g.cancelled)
        .forEach((g) => {
          [g.player1Reveal, g.player2Reveal].forEach((reveal) => {
            if (!reveal) return;

            const nftContracts = reveal.nftContracts || [];
const tokenURIs = reveal.tokenURIs || [];
const tokenIds = reveal.tokenIds || [];

tokenURIs.forEach((tokenURI, idx) => {
  const collectionKey = resolveCollectionKeyFromAddress(nftContracts[idx]);
  const tokenId = tokenIds[idx];

  if (!collectionKey || tokenId === undefined || tokenId === null) return;

  const key = `${collectionKey}:${tokenURI}`;
  if (!characterNameMap[key]) {
    needed.set(key, { collectionKey, tokenURI, tokenId });
  }
});
          });
        });

      if (needed.size === 0) return;

const entries = await Promise.all(
  [...needed.values()].map(async ({ collectionKey, tokenURI, tokenId }) => {
    try {
      const res = await fetch(`${BACKEND_URL}/metadata/${collectionKey}/${tokenId}`);
      if (!res.ok) throw new Error("metadata fetch failed");

      const meta = await res.json();

      return [`${collectionKey}:${tokenURI}`, meta.name || `${collectionKey} #${tokenId}`];
    } catch {
      return [`${collectionKey}:${tokenURI}`, `${collectionKey} #${tokenId}`];
    }
  })
);

      setCharacterNameMap((prev) => ({
        ...prev,
        ...Object.fromEntries(entries),
      }));
    } catch (err) {
      console.error("Failed to load character names:", err);
    }
  };

  loadCharacterNames();
}, [games, BACKEND_URL]); // eslint-disable-line react-hooks/exhaustive-deps

const characterLeaderboard = useMemo(() => {
  const stats = {};

  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 28); // rolling 4 weeks
  start.setUTCHours(0, 0, 0, 0);

  const addPlayed = (entryKey, label) => {
    if (!stats[entryKey]) {
      stats[entryKey] = {
        label,
        wins: 0,
        played: 0,
        winRate: 0,
      };
    }
    stats[entryKey].played += 1;
  };

  const addWin = (entryKey, label) => {
    if (!stats[entryKey]) {
      stats[entryKey] = {
        label,
        wins: 0,
        played: 0,
        winRate: 0,
      };
    }
    stats[entryKey].wins += 1;
  };

  games
    .filter((g) => g.settled && !g.cancelled)
    .forEach((g) => {
      const resultDate = g.settledAt;
      if (!resultDate) return;

      const gameTime = new Date(resultDate);
      if (Number.isNaN(gameTime.getTime())) return;
      if (gameTime < start) return;

      const player1Reveal = g.player1Reveal;
      const player2Reveal = g.player2Reveal;
      const rounds = Array.isArray(g.roundResults) ? g.roundResults : [];

      if (!player1Reveal || !player2Reveal || rounds.length === 0) return;

const buildTeam = (reveal) => {
  const nftContracts = Array.isArray(reveal?.nftContracts) ? reveal.nftContracts : [];
  const tokenURIs = Array.isArray(reveal?.tokenURIs) ? reveal.tokenURIs : [];
  const backgrounds = Array.isArray(reveal?.backgrounds) ? reveal.backgrounds : [];

  return tokenURIs.map((tokenURI, idx) => {
    const collectionKey = resolveCollectionKeyFromAddress(nftContracts[idx]);
    const nameKey = `${collectionKey}:${tokenURI}`;

    const rawName =
      typeof characterNameMap[nameKey] === "string"
        ? characterNameMap[nameKey]
: collectionKey
? `${collectionKey} #${reveal.tokenIds?.[idx] ?? tokenURI}`
: "Unknown";

    const baseName = String(rawName).replace(/\s*#\d+$/i, "").trim();
const rawBackground =
  typeof backgrounds[idx] === "string" && backgrounds[idx].trim()
    ? backgrounds[idx].trim()
    : "Unknown";

const normalized = rawBackground.toLowerCase();

const rareMatch = RARE_BACKGROUNDS.find(
  (b) => b.toLowerCase() === normalized
);

const background = rareMatch || "Common";

const label = `${baseName} ${background}`;
const entryKey = `${baseName}||${background}`;

    return { entryKey, label };
  });
};

      const p1Team = buildTeam(player1Reveal);
      const p2Team = buildTeam(player2Reveal);

      // Each character played once if present in a settled game
      p1Team.forEach(({ entryKey, label }) => addPlayed(entryKey, label));
      p2Team.forEach(({ entryKey, label }) => addPlayed(entryKey, label));

      // Round winners map to slots 0/1/2
      rounds.forEach((round, idx) => {
        if (round.winner === "player1" && p1Team[idx]) {
          addWin(p1Team[idx].entryKey, p1Team[idx].label);
        } else if (round.winner === "player2" && p2Team[idx]) {
          addWin(p2Team[idx].entryKey, p2Team[idx].label);
        }
      });
    });

  return Object.values(stats)
    .map((entry) => ({
      ...entry,
      winRate: entry.played > 0 ? Math.round((entry.wins / entry.played) * 100) : 0,
    }))
    .sort((a, b) => {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.played - a.played;
    });
}, [games, characterNameMap]);


const leaderboardButtonStyle = (active, isMobile = false, accent = "#18bb1a") => ({
  padding: isMobile ? "8px 12px" : "9px 14px",
  borderRadius: 999,
  border: active ? `1px solid ${accent}` : "1px solid #333",
  background: active ? `${accent}22` : "#111",
  color: active ? accent : "#ddd",
  fontSize: isMobile ? 13 : 15,
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: active ? `0 0 12px ${accent}2e` : "none",
  transition: "all 0.2s ease",
});

const renderXpLeaderboardCard = (compact = false) => (
  <div>
    {xpLeaderboard.length === 0 ? (
      <p style={{ color: "#aaa" }}>No XP data yet.</p>
    ) : (
      xpLeaderboard.map((entry, idx) => {
        const inactive = isXpInactive(entry.lastClaimed);

        return (
          <div
            key={entry.address}
            style={{
              padding: compact ? 10 : 14,
              marginBottom: 10,
              borderRadius: 12,
              background: inactive ? "rgba(90, 0, 0, 0.35)" : "#111",
              border: inactive ? "1px solid #ff4d4d" : "1px solid #333",
              color: "#ddd",
              boxShadow: inactive ? "0 0 10px rgba(255,77,77,0.18)" : "none",
            }}
          >
            <div style={{ fontWeight: 800, color: inactive ? "#ff4d4d" : "#18bb1a" }}>
              #{idx + 1} {entry.address.slice(0, 6)}...{entry.address.slice(-4)}
            </div>

            <div>Level: <b>{entry.level}</b></div>
            <div>XP: <b>{entry.xp}</b></div>
            <div>
              Last XP Claim:{" "}
              <b>{entry.lastClaimed || "Never"}</b>
              {inactive && (
                <span style={{ color: "#ff4d4d", fontWeight: 800 }}>
                  {" "}⚠ Inactive
                </span>
              )}
            </div>
          </div>
        );
      })
    )}
  </div>
);

/* ---------------- WEEKLY LEADERBOARD (LIVE FROM games) ---------------- */
const weeklyHistory = useMemo(() => {
  const stats = {};

  const now = new Date();

  // Monday-start UTC week
  const weekStart = new Date(now);
  const day = weekStart.getUTCDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  weekStart.setUTCDate(weekStart.getUTCDate() + diffToMonday);
  weekStart.setUTCHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  games
    .filter((g) => g.settled && !g.cancelled)
    .forEach((g) => {
      const resultDate = g.settledAt || g.createdAt || g.date;
      if (!resultDate) return;

      const gameTime = new Date(resultDate);
      if (Number.isNaN(gameTime.getTime())) return;

      if (gameTime < weekStart || gameTime >= weekEnd) return;

      const p1 = g.player1?.toLowerCase();
      const p2 = g.player2?.toLowerCase();
      const winner = g.winner?.toLowerCase();
      const isTie = !!g.tie;

      [p1, p2].forEach((player) => {
        if (!player || player === ethers.ZeroAddress.toLowerCase()) return;

        if (!stats[player]) stats[player] = { wins: 0, played: 0 };
        stats[player].played += 1;
      });

      if (!isTie && winner && winner !== ethers.ZeroAddress.toLowerCase()) {
        if (!stats[winner]) stats[winner] = { wins: 0, played: 0 };
        stats[winner].wins += 1;
      }
    });

  const latest = Object.entries(stats)
    .map(([address, data]) => ({
      address,
      wins: data.wins,
      played: data.played,
      winRate: data.played > 0 ? Math.round((data.wins / data.played) * 100) : 0,
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.winRate - a.winRate;
    })
    .slice(0, 3);

  return {
    latest,
    week: weekStart.toISOString().split("T")[0],
  };
}, [games]);

const weeklyLeaderboard = weeklyHistory.latest || [];

const leaderboardTitle = isCharacterMode
  ? "🏆 Character Leaderboard (Rolling 4 Weeks)"
  : isXpMode
  ? "⭐ XP Leaders"
  : isWeeklyMode
  ? `🏆 Weekly Top 3 (${weeklyHistory.week})`
  : "🏆 All-Time Top 10";

const renderActiveLeaderboard = (compact = false) =>
  isCharacterMode
    ? renderCharacterLeaderboardCard(compact)
    : isXpMode
    ? renderXpLeaderboardCard(compact)
    : renderLeaderboardCard(compact);

// Fetch weekly archive from backend on load
useEffect(() => {
  fetch(`${BACKEND_URL}/leaderboard/weekly`)
    .then(res => res.json())
    .then(setWeeklyArchive)
    .catch(console.error);
}, []);

/* --------- TOTAL CORE BURN ---------*/
const [totalGameBurned, setTotalGameBurned] = useState(0);
const [burnPercent, setBurnPercent] = useState(0);
const INITIAL_SUPPLY = 1_000_000;

useEffect(() => {
  let interval;

  const fetchBurn = async () => {
    try {
      // 1️⃣ Always fetch backend total burn
      const res = await fetch(`${BACKEND_URL}/games/burn-total`);
      if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
      const data = await res.json();

      const burnWei = BigInt(data.totalBurnWei);
      const burnFormatted = Number(ethers.formatEther(burnWei));

     // Use default provider if wallet is not connected
      const provider = new ethers.JsonRpcProvider(process.env.REACT_APP_RPC_URL);
      const coreReadContract = new ethers.Contract(CORE_TOKEN, ERC20ABI, provider);
      const supplyWei = await coreReadContract.totalSupply();
      const supplyFormatted = Number(ethers.formatEther(supplyWei));

const percent =
  INITIAL_SUPPLY > 0 ? (burnFormatted / INITIAL_SUPPLY) * 100 : 0;
  
      setTotalGameBurned(burnFormatted);
      setBurnPercent(percent);
    } catch (err) {
      console.error("Burn refresh failed:", err);
    }
  };

  // Run immediately
  fetchBurn();

  // Then run every 30 seconds
  interval = setInterval(fetchBurn, 30000);

  // Cleanup
  return () => clearInterval(interval);
}, []);

//SINGLE WALLET MODAL
const [showWalletModal, setShowWalletModal] = useState(false);

/* ---------------- UI ---------------- */
const isMobile = window.innerWidth < 768;

if (loading) {
  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(circle at center, #123814 0%, #061006 45%, #020402 100%)",
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle, rgba(24,187,26,0.22), transparent 55%)",
          animation: "loadingGlow 3s ease-in-out infinite",
        }}
      />

      {/* Scanlines */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "100% 6px",
          opacity: 0.18,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          minHeight: "100vh",
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#18bb1a",
          textAlign: "center",
          padding: 20,
        }}
      >
        <img
          src={CoreClashLogo}
          alt="Core Clash"
          style={{
            width: "90%",
            maxWidth: 520,
            animation: "logoPulse 2.4s ease-in-out infinite",
            filter: "drop-shadow(0 0 22px rgba(24,187,26,0.65))",
          }}
        />

        <p
          style={{
            marginTop: 18,
            marginBottom: 8,
            fontSize: isMobile ? 13 : 16,
            letterSpacing: 4,
            textTransform: "uppercase",
            opacity: 0.85,
          }}
        >
          Awakening the Core
        </p>

        <div
          style={{
            fontSize: isMobile ? 12 : 14,
            color: "#b9ffbf",
            opacity: 0.75,
            marginBottom: 22,
          }}
        >
          Stake, Reveal, Battle, Win...
        </div>

{/* Loading Bar */}
<div
  style={{
    position: "relative",
    width: "70%",
    maxWidth: 420,
    height: 18,
    backgroundColor: "#071a08",
    border: "1px solid rgba(24,187,26,0.45)",
    borderRadius: 999,
    overflow: "visible",
    boxShadow:
      "0 0 14px rgba(24,187,26,0.45), inset 0 0 10px rgba(0,0,0,0.8)",
  }}
>
  <div
    style={{
      width: `${logoReady ? progress : 0}%`,
      height: "100%",
      borderRadius: 999,
      background: "linear-gradient(90deg, #0f8f11, #18bb1a, #7dff85)",
      transition: "width 50ms linear",
      boxShadow: "0 0 18px rgba(66,255,90,0.9)",
      overflow: "hidden",
    }}
  />

<img
  src={PlanetZephyrosLogo}
  alt="Planet Zephyros"
  onLoad={() => setLogoReady(true)}
  style={{
    position: "absolute",
    left: `calc(${logoReady ? progress : 0}% - 4px)`,
    top: -18,
    transform: "translateX(-15%)",
    height: 56,
    width: "auto",
    display: "block",
    pointerEvents: "none",
    zIndex: 10,
    filter: "drop-shadow(0 0 10px rgba(24,187,26,0.95))",
    animation: "logoPulse 2.4s ease-in-out infinite",
  }}
/>
</div>

        <div
          style={{
            marginTop: 10,
            fontSize: isMobile ? 12 : 13,
            color: "#d8ffdc",
            opacity: 0.75,
            letterSpacing: 1,
          }}
        >
          {logoReady ? Math.round(progress) : 0}%
        </div>

        <p
          style={{
            marginTop: 32,
            marginBottom: 8,
            fontSize: isMobile ? 12 : 14,
            letterSpacing: 3,
            textTransform: "uppercase",
            opacity: 0.65,
          }}
        >
          Powered by
        </p>

        <img
          src={ElectroneumLogo}
          alt="Electroneum"
          style={{
            width: 230,
            maxWidth: "58%",
            filter: "drop-shadow(0 0 12px rgba(255,255,255,0.25))",
          }}
        />
      </div>
    </div>
  );
}

const leaderboardRows = showWeekly ? weeklyLeaderboard : leaderboard;

const sortedWeeklyArchive = Object.entries(weeklyArchive || {})
  .filter(([_, players]) => Array.isArray(players) && players.length > 0)
  .sort((a, b) => new Date(b[0]) - new Date(a[0]));

const previousWeeklyArchive = sortedWeeklyArchive.slice(1, 7);

const renderLeaderboardCard = (mobile = false) => (
  <div
    style={{
      background: "#111",
      padding: mobile ? 16 : 24,
      borderRadius: 12,
      border: "1px solid #333",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}
  >
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 1fr 1fr 1fr",
        fontSize: mobile ? 13 : 16,
        opacity: 0.7,
        borderBottom: "1px solid #333",
        paddingBottom: 6,
        marginBottom: 6,
      }}
    >
      <span>Player</span>
      <span style={{ textAlign: "center" }}>P</span>
      <span style={{ textAlign: "center" }}>W</span>
      <span style={{ textAlign: "center" }}>%</span>
    </div>

    {leaderboardRows.map((entry, index) => {
      const medalColor = ["#FFD700", "#C0C0C0", "#CD7F32"][index] || "#fff";
      const isCurrentUser = entry.address === account?.toLowerCase();

      return (
        <div
          key={`${entry.address}-${showWeekly ? "weekly" : "alltime"}`}
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr",
            padding: mobile ? "6px 0" : "8px 0",
            borderBottom: "1px solid #222",
            fontSize: mobile ? 14 : 16,
            color: isCurrentUser ? "#4da3ff" : medalColor,
            fontWeight: isCurrentUser ? "bold" : "normal",
          }}
        >
          <span>
            #{index + 1} — {entry.address.slice(0, 6)}…{entry.address.slice(-4)}
          </span>
          <span style={{ textAlign: "center" }}>{entry.played}</span>
          <span style={{ textAlign: "center" }}>{entry.wins}</span>
          <span style={{ textAlign: "center" }}>{entry.winRate}%</span>
        </div>
      );
    })}

    {leaderboardRows.length === 0 && (
      <div
        style={{
          opacity: 0.6,
          padding: mobile ? "10px 0" : "12px 0",
          textAlign: "center",
        }}
      >
        No games to display.
      </div>
    )}
  </div>
);

const renderWeeklyHistory = () =>
  showWeekly &&
  previousWeeklyArchive.length > 0 && (
    <div style={{ marginTop: 20 }}>
      <h3
        style={{
          color: "#aaa",
          fontSize: 16,
          marginBottom: 10,
        }}
      >
        Previous Weeks
      </h3>

      {previousWeeklyArchive.map(([week, players]) => (
        <div
          key={week}
          style={{
            background: "#0d0d0d",
            border: "1px solid #222",
            borderRadius: 8,
            padding: 12,
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>
            Week of {week}
          </div>

          {players.map((p, i) => (
            <div
              key={`${week}-${p.address}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 14,
                padding: "2px 0",
              }}
            >
              <span>
                #{i + 1} — {p.address.slice(0, 6)}…{p.address.slice(-4)}
              </span>
              <span>{p.wins}W / {p.played}P</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  const renderCharacterLeaderboardCard = (mobile = false) => (
  <div
    style={{
      background: "#111",
      padding: mobile ? 16 : 24,
      borderRadius: 12,
      border: "1px solid #333",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}
  >
    <div
      style={{
        display: "grid",
        gridTemplateColumns: mobile ? "2.4fr 1fr 1fr 1fr" : "2.8fr 1fr 1fr 1fr",
        fontSize: mobile ? 13 : 16,
        opacity: 0.7,
        borderBottom: "1px solid #333",
        paddingBottom: 6,
        marginBottom: 6,
      }}
    >
      <span>Character</span>
      <span style={{ textAlign: "center" }}>P</span>
      <span style={{ textAlign: "center" }}>W</span>
      <span style={{ textAlign: "center" }}>%</span>
    </div>

    {characterLeaderboard.slice(0, 25).map((entry, index) => {
      const medalColor = ["#FFD700", "#C0C0C0", "#CD7F32"][index] || "#fff";

      return (
        <div
          key={entry.label}
          style={{
            display: "grid",
            gridTemplateColumns: mobile ? "2.4fr 1fr 1fr 1fr" : "2.8fr 1fr 1fr 1fr",
            padding: mobile ? "6px 0" : "8px 0",
            borderBottom: "1px solid #222",
            fontSize: mobile ? 14 : 16,
            color: medalColor,
          }}
        >
          <span>
            #{index + 1} — {entry.label}
          </span>
          <span style={{ textAlign: "center" }}>{entry.played}</span>
          <span style={{ textAlign: "center" }}>{entry.wins}</span>
          <span style={{ textAlign: "center" }}>{entry.winRate}%</span>
        </div>
      );
    })}

    {characterLeaderboard.length === 0 && (
      <div
        style={{
          opacity: 0.6,
          padding: mobile ? "10px 0" : "12px 0",
          textAlign: "center",
        }}
      >
        No character stats to display.
      </div>
    )}
  </div>
);

/* ----------- Ad Component ----------- */
const AdPlaceholder = () => (
  <div
    style={{
      position: "relative",
      width: "100%",
      padding: "18px 16px",
      borderRadius: 16,
      background: "linear-gradient(145deg, #0a0a0a, #141414)",
      border: "1px solid #5ebdde",
      boxShadow:
        "0 0 12px rgba(94,189,222,0.12), inset 0 0 20px rgba(0,0,0,0.6)",
      overflow: "hidden",
    }}
  >
    {/* Glow overlay */}
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "radial-gradient(circle at 50% 0%, #5ebdde, transparent 60%)",
        pointerEvents: "none",
      }}
    />

    {/* Top Bar */}
    <div
      style={{
        position: "absolute",
        top: 8,
        left: 10,
        right: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {/* Sponsored (left) */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: "#5ebdde",
          opacity: 0.6,
        }}
      >
        Sponsored
      </div>

{/* Advertise (right) */}
<a
  href="https://t.me/ETN_Villain"
  target="_blank"
  rel="noopener noreferrer"
  style={{
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "#18bb1a",
    background: "rgba(24,187,26,0.12)",
    border: "1px solid #18bb1a",
    padding: "4px 10px",
    borderRadius: 999,
    textDecoration: "none",
    cursor: "pointer",
    boxShadow: "0 0 6px rgba(24,187,26,0.35)",
    transition: "all 0.2s ease",
  }}
  onMouseEnter={(e) => {
    e.currentTarget.style.background = "#18bb1a";
    e.currentTarget.style.color = "#000";
    e.currentTarget.style.boxShadow = "0 0 10px rgba(24,187,26,0.6)";
  }}
  onMouseLeave={(e) => {
    e.currentTarget.style.background = "rgba(24,187,26,0.12)";
    e.currentTarget.style.color = "#18bb1a";
    e.currentTarget.style.boxShadow = "0 0 6px rgba(24,187,26,0.35)";
  }}
>
  Advertise Here
</a>
    </div>

    {/* Main Content */}
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        marginTop: 28,
      }}
    >
      <img
        src={EtnClubLogo}
        alt="ETN CLUB"
        style={{
          display: "block",
          width: isMobile ? 52 : 64,
          height: "auto",
          filter: "drop-shadow(0 0 8px #5ebdde)",
          opacity: 0.95,
          marginBottom: 10,
        }}
      />

      <div
        style={{
          fontSize: isMobile ? 16 : 18,
          fontWeight: 800,
          color: "#fff",
          letterSpacing: 0.4,
          marginBottom: 6,
        }}
      >
        ETN Club Token
      </div>

      <div
        style={{
          fontSize: isMobile ? 12 : 13,
          color: "#aaa",
          lineHeight: 1.5,
          maxWidth: 260,
          marginBottom: 12,
          textAlign: "center",
        }}
      >
        Deflationary. Community-Owned. ETN Club.
      </div>

      <a
        href="https://planetetn.org/profile/4-etn-club"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          justifyContent: "center",
          fontSize: 12,
          color: "#5ebdde",
          textDecoration: "none",
          marginBottom: 10,
          textAlign: "center",
        }}
      >
        Official Website
      </a>

      <a
        href="https://t.me/ETNclubs"
        onClick={(e) => {
          e.preventDefault();
          handleSponsoredAdClick("sponsoredad1", "https://t.me/ETNclubs");
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 700,
          color: "#fff",
          background: "#5ebdde",
          padding: "6px 12px",
          borderRadius: 6,
          textDecoration: "none",
        }}
      >
        <FaTelegramPlane size={14} />
        Join the CLUB
      </a>
    </div>
  </div>
);

const renderGamesWithSingleAd = (games) => {
  // 🔥 If no games → show ad only
  if (!games || games.length === 0) {
    return (
      <div style={{ width: "100%" }}>
        <AdPlaceholder />
      </div>
    );
  }

  const items = [];

  games.forEach((g, index) => {
    items.push(
      <div key={`game-${g.id}`} style={{ width: "100%" }}>
        <GameCard g={g} {...gameCardProps} roundResults={g.roundResults || []} />
      </div>
    );

    // Insert ad after 2nd game
    if (index === 1) {
      items.push(
        <div key="single-ad-after-second" style={{ width: "100%" }}>
          <AdPlaceholder />
        </div>
      );
    }
  });

  // If fewer than 3 games → add ad at bottom
  if (games.length < 3) {
    items.push(
      <div key="single-ad-bottom" style={{ width: "100%" }}>
        <AdPlaceholder />
      </div>
    );
  }

  return items;
};

const renderGamesWithRepeatingAds = (games, keyPrefix = "settled") => {
  if (!games || games.length === 0) return null;

  const items = [];

  games.forEach((g, index) => {
    items.push(
      <div key={`${keyPrefix}-game-${g.id}`} style={{ width: "100%" }}>
        <GameCard g={g} {...gameCardProps} roundResults={g.roundResults || []} />
      </div>
    );

    // After every 2nd game: 2, 4, 6...
    if ((index + 1) % 2 === 0 && index !== games.length - 1) {
      items.push(
        <div key={`${keyPrefix}-ad-${index}`} style={{ width: "100%" }}>
          <AdPlaceholder />
        </div>
      );
    }
  });

  return items;
};

  /* ---------------- MAIN APP ---------------- */
return (
<div
  style={{
    position: "relative",
    minHeight: "100vh",
    padding: isMobile ? "16px 14px" : 40,
    width: "100%",
    maxWidth: 1100,
    margin: "0 auto",
    boxSizing: "border-box",
    minWidth: 0,
  }}
>
    {/* ---------------- WATERMARK ---------------- */}
<div
  style={{
    position: "fixed",
    inset: 0,
    backgroundColor: "#000",
    backgroundImage: `url(${AppBackground})`,
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
    backgroundPosition: "center",
    opacity: 0.40,
    pointerEvents: "none",
    zIndex: 0,
  }}
 />

    {/* ---------------- APP CONTENT ---------------- */}
    <div style={{ position: "relative", zIndex: 1 }}>

{/* ---------------- HEADER: LOGO + WALLET ---------------- */}
<div
  style={{
    display: "flex",
    alignItems: "center",       // vertical alignment
    justifyContent: "space-between",
    gap: isMobile ? 12 : 24,
    width: "100%",
    padding: 0,
  }}
>
{/* LEFT: Logo */}
<img
  src={CoreClashLogo}
  alt="Core Clash"
  style={{
    height: isMobile ? 80 * 1.2 : 80 * 1.2,
    width: "auto",
    pointerEvents: "none",
    display: "block",
    animation: "logoPulse 2.4s ease-in-out infinite",
  }}
/>

{/* ---------------- WALLET BUTTON ---------------- */}
<div
  style={{
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    alignItems: "center",
    gap: isMobile ? 10 : 16,
  }}
>
{!account ? (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 10,
      width: "100%",
    }}
  >
    <button
      onClick={connectWallet}
      style={{
        backgroundColor: "#18bb1a",
        color: "#fff",
        border: "none",
        padding: isMobile ? "10px 16px" : "14px 28px",
        fontSize: isMobile ? 14 : 16,
        fontWeight: "bold",
        borderRadius: 12,
        cursor: "pointer",
        boxShadow: "0 0 10px rgba(24,187,26,0.6)",
        transition: "all 0.2s ease",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.boxShadow =
          "0 0 20px rgba(24,187,26,0.9)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.boxShadow =
          "0 0 10px rgba(24,187,26,0.6)")
      }
    >
      Connect Wallet
    </button>

    {/* Browser warning */}
    <div
      style={{
        maxWidth: 420,
        background: "rgba(255, 170, 0, 0.08)",
        border: "1px solid rgba(255, 170, 0, 0.25)",
        borderRadius: 12,
        padding: "10px 12px",
        fontSize: isMobile ? 11 : 12,
        color: "#d7d7d7",
        lineHeight: 1.45,
        textAlign: "center",
      }}
    >
      <span style={{ color: "#ffb84d", fontWeight: 700 }}>
        ⚠ Browser Warning:
      </span>{" "}
      Do not play Core Clash inside a wallet’s built-in browser. Reveal
      files must be downloaded to complete games. Please open Core Clash
      using a normal browser like <strong>Chrome</strong>,{" "}
      <strong>Safari</strong>, or <strong>Edge</strong>.
    </div>
  </div>
) : (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isMobile ? "stretch" : "flex-end",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#0f0f0f",
          padding: "6px 12px",
          borderRadius: 12,
          border: "1px solid #333",
          boxShadow: "0 0 8px rgba(0,0,0,0.4)",
        }}
      >
<span
  style={{
    fontSize: isMobile ? 12 : 14,
    fontWeight: 600,
    color: "#fff",
    letterSpacing: 0.3,
  }}
>
  {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : ""}
</span>

        <div style={{ width: 1, height: 16, background: "#333" }} />

        <button
          onClick={disconnectWallet}
          style={{
            background: "transparent",
            border: "none",
            color: "#ff6b6b",
            fontWeight: 600,
            fontSize: isMobile ? 11 : 13,
            cursor: "pointer",
            padding: "2px 6px",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#ff3b3b")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#ff6b6b")}
        >
          Disconnect
        </button>
      </div>

      <WalletXpPanel
        xpProfile={xpProfile}
        xpLoading={xpLoading}
        isMobile={isMobile}
      />
    </div>
  )}
</div>
</div>

<div style={{ marginBottom: 12 }}>
  <EcosystemBlock
    isMobile={isMobile}
    handleEcosystemClick={handleEcosystemClick}
    ElectroSwap={ElectroSwap}
    TelegramLogo={TelegramLogo}
    XLogo={XLogo}
    PlanetZephyrosAE={PlanetZephyrosAE}
    VerdantKinBanner={VerdantKinBanner}
    VerdantQueenBanner={VerdantQueenBanner}
    AetherScionsBanner={AetherScionsBanner}
    EvgBanner={EvgBanner}
  />
</div>

<div
  style={{
    background: "#0f0f0f",
    border: "1px solid #333",
    borderRadius: 14,
    padding: "16px 18px",
    boxShadow: "0 0 10px rgba(0,0,0,0.35)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    minWidth: isMobile ? "100%" : 260,
    marginBottom: 12,
  }}
>
  <div
    style={{
      fontSize: 11,
      color: "#888",
      textTransform: "uppercase",
      letterSpacing: 1.2,
      marginBottom: 8,
      lineHeight: 1.4,
    }}
  >
    Total CORE Burned from Core Clash
  </div>

<div
  style={{
    fontSize: isMobile ? 24 : 28,
    fontWeight: 800,
    color: "#ff8a3d",
    textShadow: "0 0 10px rgba(255,138,61,0.3)",
    marginBottom: 8,
  }}
>
  🔥
  {totalGameBurned.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}
  🔥
</div>
<div
  style={{
    fontSize: 13,
    color: "#ffb37a",
    fontWeight: 600,
    marginBottom: 4,
  }}
>
  {burnPercent.toFixed(2)}% burned of total $CORE supply
</div>

<div
  style={{
    fontSize: 11,
    color: "#888",
    lineHeight: 1.5,
    maxWidth: 240,
  }}
>
  1% of every settled game gets destroyed forever
</div>
</div>

{/* ---------------- CREATE GAME SECTION ---------------- */}
<div
  style={{
    width: "100%",
    flex: 1,
    background: "#111",
    border: "1px solid #333",
    borderRadius: 12,
    padding: isMobile ? "12px 10px" : "16px 16px",
    boxShadow: "0 0 12px rgba(24,187,26,0.15)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    boxSizing: "border-box",
  }}
>

  {/* HEADER ROW */}
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 6,
    }}
  >

    <h2
      style={{
        fontSize: isMobile ? 18 : 22,
        color: "#18bb1a",
        margin: 0,
      }}
    >
      Create Clash
    </h2>

    {/* HELP BUTTONS */}
    <div
      style={{
        display: "flex",
        gap: 6,
      }}
    >
      <button
        onClick={() => setHelpModal("how")}
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid #333",
          background: "#0f0f0f",
          color: "#18bb1a",
          fontSize: 12,
          fontWeight: "bold",
          cursor: "pointer",
        }}
      >
        How To Play
      </button>

      <button
        onClick={() => setHelpModal("info")}
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid #333",
          background: "#0f0f0f",
          color: "#18bb1a",
          fontSize: 12,
          fontWeight: "bold",
          cursor: "pointer",
        }}
      >
        Game Info
      </button>
    </div>

  </div>

  {/* Stake Token */}
  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <label style={{ fontSize: 12, color: "#aaa", fontWeight: 600, textTransform: "uppercase" }}>
      Stake Token
    </label>
    <select
      value={stakeToken}
      onChange={(e) => setStakeToken(e.target.value)}
      style={{
        width: "100%",
        maxWidth: 260,
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid #333",
        background: "#0f0f0f",
        color: "#fff",
        fontSize: 14,
        outline: "none",
        cursor: "pointer",
      }}
    >
      {WHITELISTED_TOKENS.map((t) => (
        <option key={t.address} value={t.address}>
          {t.label}
        </option>
      ))}
    </select>
  </div>

  {/* Stake Amount */}
  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <label style={{ fontSize: 12, color: "#aaa", fontWeight: 600, textTransform: "uppercase" }}>
      Stake Amount
    </label>
    <input
      value={stakeAmount}
      onChange={(e) => setStakeAmount(e.target.value)}
      type="number"
      placeholder="Enter amount"
      style={{
        width: "100%",
        maxWidth: 220,
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid #333",
        background: "#0f0f0f",
        color: "#fff",
        fontSize: 14,
        outline: "none",
      }}
    />
  </div>

  <h3
    style={{
      fontSize: isMobile ? 16 : 18,
      color: "#18bb1a",
      marginTop: 16,
      marginBottom: 8,
    }}
  >
    Build Your Team (Choose 1 from each row)
  </h3>

{/* ---------------- NFT GALLERY ---------------- */}
<div
  style={{
    marginBottom: 12,
    background: "#0f0f0f",
    border: "1px solid #2a2a2a",
    borderRadius: 14,
    boxShadow: "0 0 10px rgba(0,0,0,0.3)",
    overflow: "hidden",
  }}
>
  {/* HEADER */}
  <div
    role="button"
    tabIndex={0}
    onClick={() => setShowNftGallery((prev) => !prev)}
    style={{
      width: "100%",
      background: "transparent",
      border: "none",
      padding: "14px 16px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      cursor: "pointer",
    }}
  >
    <div>
      <div style={{ fontSize: 12, color: "#888" }}>NFT Gallery</div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>
        {selectedNftCount}/3 Selected
      </div>
    </div>

    <div style={{ fontSize: 18 }}>
      {showNftGallery ? "−" : "+"}
    </div>
  </div>

  {/* COLLAPSED VIEW */}
  {!showNftGallery && (
    <div
      style={{
        padding: "0 16px 14px 16px",
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      {nfts
        .filter((slot) => slot?.tokenId)
        .map((slot) => {
          const collectionKey = getCollection(slot.address);
          if (!collectionKey) return null;

const imageSrc =
  imageMapRef.current[`${collectionKey}:${slot.tokenId}`] ||
  "/placeholder.png";
  
          return (
            <div
              key={`collapsed-${slot.address}-${slot.tokenId}`}
              style={{
                width: 64,
                background: "#111",
                border: "1px solid #2a2a2a",
                borderRadius: 10,
                padding: 4,
              }}
            >
              <img
                src={imageSrc}
                style={{
                  width: "100%",
                  height: 48,
                  objectFit: "cover",
                  borderRadius: 6,
                }}
              />
            </div>
          );
        })}
    </div>
  )}

{/* EXPANDED VIEW (stable, UI unchanged) */}
{showNftGallery && (
  <div style={{ padding: "0 16px 16px 16px" }}>
    {nfts.map((slot, i) => (
      <div
        key={`slot-${slot.address?.toLowerCase() || "empty"}-${slot.tokenId || i}`}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: 16,
          minWidth: 0,
        }}
      >
        <label
          style={{
            fontSize: 12,
            color: "#aaa",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Select NFT
        </label>

        <div
          style={{
            display: "flex",
            gap: 10,
            overflowX: "auto",
            overflowY: "hidden",
            WebkitOverflowScrolling: "touch",
            flexWrap: "nowrap",
            paddingBottom: 4,
            maxWidth: "100%",
          }}
        >
          {[...ownedNFTs]
  .sort((a, b) => {
    const aPriority =
      backgroundPriority[a?.background] ?? 999;

    const bPriority =
      backgroundPriority[b?.background] ?? 999;

    // Rare backgrounds first
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // Then alphabetically by name
    const aName = a?.name || "";
    const bName = b?.name || "";

    if (aName !== bName) {
      return aName.localeCompare(bName);
    }

    // Then token ID
    return Number(a?.tokenId || 0) - Number(b?.tokenId || 0);
  })
  .map((nftOption) => {
            const collectionKey = getCollection(nftOption.nftAddress);
            if (!collectionKey) return null;

const imageSrc =
  imageMapRef.current[`${collectionKey}:${nftOption.tokenId}`] ||
  "/placeholder.png";

            const selected =
              nfts[i]?.tokenId === nftOption.tokenId &&
              nfts[i]?.address?.toLowerCase() ===
                nftOption.nftAddress?.toLowerCase();

            return (
              <div
                key={`${nftOption.nftAddress.toLowerCase()}-${String(nftOption.tokenId)}`}
                onClick={() => {
                  setNfts((prev) =>
                    prev.map((s, idx) =>
                      idx === i
                        ? {
                            ...s,
                            tokenId: nftOption.tokenId,
                            address: nftOption.nftAddress,
                            metadata: {
                              name: nftOption.name,
                              background: nftOption.background,
                            },
                          }
                        : s
                    )
                  );
                }}
                style={{
                  flex: "0 0 auto",
                  width: 90,
                  minWidth: 90,
                  cursor: "pointer",
                  borderRadius: 8,
                  border: selected
                    ? "2px solid #3ea6ff"
                    : "1px solid #333",
                  background: "#111",
                  padding: 6,
                  textAlign: "center",
                }}
              >
                <img
                  src={imageSrc}
                  loading="lazy"
                  decoding="async"
                  onError={(e) =>
                    (e.currentTarget.src = "/placeholder.png")
                  }
                  style={{
                    width: "100%",
                    height: 70,
                    objectFit: "cover",
                    borderRadius: 6,
                    marginBottom: 4,
                  }}
                />

                <div
                  style={{
                    fontSize: 11,
                    fontWeight: "bold",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {nftOption.name
                    ? `${nftOption.name} (#${nftOption.tokenId})`
                    : `#${nftOption.tokenId}`}
                </div>

                <div
                  style={{
                    fontSize: 10,
                    opacity: 0.7,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {nftOption.background}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ))}
  </div>
)}
</div>

{/* ---------------- ACTION BUTTONS ---------------- */}
<div
  style={{
    width: "100%",
    marginTop: 12,      // slightly tighter
    marginBottom: 12,   // reduced bottom space
    display: "flex",
    gap: isMobile ? 8 : 12, // smaller gap on mobile
    flexWrap: "wrap",
    justifyContent: isMobile ? "center" : "flex-start",
    boxSizing: "border-box",
  }}
>
{/* NFT OWNERSHIP WARNING */}
<div
  style={{
    border: "1px solid #6b4a00",
    borderRadius: 8,
    background: "#1a1200",
    marginBottom: 8,
    overflow: "hidden",
  }}
>

  {/* Header */}
  <div
    onClick={() => setShowOwnershipWarning(!showOwnershipWarning)}
    style={{
      padding: "8px 10px",
      fontSize: isMobile ? 12 : 13,
      color: "#ffcc66",
      fontWeight: "bold",
      cursor: "pointer",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    }}
  >
    ⚠ NFT Ownership Warning
    <span style={{ opacity: 0.7 }}>
      {showOwnershipWarning ? "▲" : "▼"}
    </span>
  </div>

  {/* Expandable Content */}
  {showOwnershipWarning && (
    <div
      style={{
        padding: "8px 10px",
        fontSize: isMobile ? 11 : 12,
        color: "#ffcc66",
        lineHeight: 1.4,
        borderTop: "1px solid #6b4a00",
      }}
    >
      Remove all playing NFTs from marketplace listings. If you do not own the NFT
      at <strong>Reveal</strong>, your reveal file will fail as you no longer own
      the NFT. This will result in a <strong>forfeited game</strong> and you will
      lose your stake.
    </div>
  )}

</div>

  {/* Validate Team Button */}
  <button
onClick={validateTeam} // <-- THIS IS REQUIRED
    style={{
      flex: isMobile ? "1 1 100%" : "1 1 auto",
      minWidth: isMobile ? 0 : 140,
      maxWidth: 200,
      padding: isMobile ? "10px 0" : "14px 0", // slightly tighter vertical padding
      fontSize: isMobile ? 14 : 16,
      fontWeight: "bold",
      borderRadius: 12,
      border: "none",
      background: validating ? "#555" : "linear-gradient(90deg, #1affb3, #00c6ff)",
      color: "#111",
      cursor: validating ? "not-allowed" : "pointer",
      boxShadow: "0 4px 8px rgba(0,0,0,0.2)",
      transition: "transform 0.1s ease, box-shadow 0.2s ease",
    }}
  >
    {validating ? "Validating..." : "Validate Team"}
  </button>

  {/* Create Game Button */}
  <button
onClick={createGame} // <-- THIS IS REQUIRED    
  style={{
      flex: isMobile ? "1 1 100%" : "1 1 auto",
      minWidth: isMobile ? 0 : 140,
      maxWidth: 200,
      padding: isMobile ? "10px 0" : "14px 0", // slightly tighter vertical padding
      fontSize: isMobile ? 14 : 16,
      fontWeight: "bold",
      borderRadius: 12,
      border: "none",
      background:
        !validated || !stakeToken || !stakeAmount || !provider
          ? "#555"
          : "linear-gradient(90deg, #ff7a00, #ff3d00)",
      color: "#fff",
      cursor:
        !validated || !stakeToken || !stakeAmount || !provider
          ? "not-allowed"
          : "pointer",
      boxShadow: "0 4px 8px rgba(0,0,0,0.2)",
      transition: "transform 0.1s ease, box-shadow 0.2s ease",
    }}
  >
    Create Game
  </button>
</div>

    {account?.toLowerCase() === ADMIN_ADDRESS ? (
      <>
        <button type="button" onClick={loadGames}>🔄 Refresh Games</button>
        <button onClick={async () => {
          await fetch(`${BACKEND_URL}/admin/resync-games`, { method: "POST" });
          await loadGames();
          alert("Resync complete");
        }}>
          🛠 Resync from Chain
        </button>
      </>
    ) : (
      <div style={{ marginBottom: 12 }} />
    )}
  </div>

<div style={{ marginTop: 40, marginBottom: 10 }}>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: isMobile ? "center" : "flex-start",
      gap: 12,
      marginBottom: 8,
    }}
  >
    <img
      src={CoreClashLogo}
      alt="Core Clash"
      style={{
        width: isMobile ? 36 * 1.5 : 36 * 1.5,
        height: "auto",
        filter: "drop-shadow(0 0 6px #18bb1a)",
      }}
    />

    <h2
      style={{
        fontWeight: "bold",
        fontSize: isMobile ? 30 : 36,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: "#18bb1a",
        margin: 0,
        animation: "coreNeonFlicker 2.2s infinite",
      }}
    >
      Core Clashes
    </h2>
    </div>

<button
  type="button"
  onClick={loadGames}
  disabled={loadingGames}
  style={{
    background: "#151515",
    color: "#18bb1a",
    border: "1px solid #2f2f2f",
    padding: isMobile ? "6px 12px" : "8px 16px",
    borderRadius: 10,
    cursor: loadingGames ? "not-allowed" : "pointer",
    fontSize: isMobile ? 13 : 14,
    fontWeight: 700,
    letterSpacing: 0.3,
    opacity: loadingGames ? 0.6 : 1,
    boxShadow: "0 0 8px rgba(0,0,0,0.35)",
    transition: "all 0.2s ease",
  }}
  onMouseEnter={(e) => {
    if (!loadingGames) {
      e.currentTarget.style.borderColor = "#18bb1a";
      e.currentTarget.style.boxShadow =
        "0 0 12px rgba(24,187,26,0.35)";
    }
  }}
  onMouseLeave={(e) => {
    e.currentTarget.style.borderColor = "#2f2f2f";
    e.currentTarget.style.boxShadow =
      "0 0 8px rgba(0,0,0,0.35)";
  }}
>
  {loadingGames ? "Refreshing..." : "🔄 Refresh"}
</button>
</div>

<div
  style={{
    display: "flex",
    flexDirection: "column",
    gap: 20,
  }}
>
  {showDeviceWarning && (
    <div
      style={{
        position: "fixed",
        top: 20,
        left: 20,
        zIndex: 99999,
        maxWidth: "400px",
        width: "90%",
        backgroundColor: "#18bb1a",
        borderRadius: "12px",
        padding: isMobile ? "15px 20px" : "20px 30px",
        boxShadow: "0 0 20px rgba(255, 255, 255, 0.99)",
        fontSize: isMobile ? "14px" : "16px",
      }}
    >
      <h3 style={{ marginTop: 0 }}>⚠ Important: Reveal File Backup</h3>

      <p>
        If you are using <b>MetaMask Mobile</b>, the reveal file will NOT
        automatically download.
      </p>

      <p>
        If the reveal file is not saved, you will be unable to reveal and
        will forfeit the game and your stake.
      </p>

      <p style={{ fontSize: isMobile ? 12 : 14, opacity: 0.8 }}>
        By continuing, you confirm that you understand this risk and have
        ensured your reveal file can be securely saved.
      </p>

      <div style={{ marginTop: 15, display: "flex", gap: "10px" }}>
        <button
          onClick={() => {
            setDeviceConfirmed(true);
            setShowDeviceWarning(false);
            createGame();
          }}
          style={{
            backgroundColor: "#1a75ff",
            color: "#fff",
            border: "none",
            padding: isMobile ? "8px 15px" : "12px 20px",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          I Understand – Continue
        </button>

        <button
          onClick={() => setShowDeviceWarning(false)}
          style={{
            padding: isMobile ? "8px 15px" : "12px 20px",
            borderRadius: 8,
            cursor: "pointer",
            border: "1px solid #ccc",
            backgroundColor: "#f9f9f9",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )}

  {/* ---------------- GAMES GRID CONTAINER ---------------- */}
    <div style={{ width: "100%", minWidth: 0, marginTop: isMobile ? 0 : 40 }}>
      {/* ---------------- TABS (MOBILE ONLY) ---------------- */}
      {isMobile && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 6,
            marginBottom: 16,
          }}
        >
          {[
            { key: "open", label: `Open (${openGames.length})` },
            { key: "active", label: `Active (${activeGames.length})` },
            { key: "settled", label: `Settled (${latestSettled.length})` },
            { key: "leaderboard", label: "Leaderboard" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "8px 6px",
                borderRadius: 8,
                border: "1px solid #333",
                background: activeTab === tab.key ? "#18bb1a" : "#111",
                color: activeTab === tab.key ? "#000" : "#fff",
                fontWeight: "bold",
                cursor: "pointer",
                fontSize: 12,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

{/* ---------------- LEADERBOARD SECTION ---------------- */}
{!isMobile && (
  <div style={{ marginBottom: 30 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => {
          setLeaderboardMode("alltime");
          setShowWeekly(false);
          setShowWeeklyHistory(false);
        }}
        style={leaderboardButtonStyle(isAllTimeMode)}
      >
        {isAllTimeMode ? "✓ " : ""}All-Time
      </button>

      <button
        type="button"
        onClick={() => {
          setLeaderboardMode("weekly");
          setShowWeekly(true);
          setShowWeeklyHistory(false);
        }}
        style={leaderboardButtonStyle(isWeeklyMode)}
      >
        {isWeeklyMode ? "✓ " : ""}Weekly
      </button>

      <button
        type="button"
        onClick={() => {
          setLeaderboardMode("characters");
          setShowWeekly(false);
          setShowWeeklyHistory(false);
        }}
        style={leaderboardButtonStyle(isCharacterMode)}
      >
        {isCharacterMode ? "✓ " : ""}Characters
      </button>

      <button
        type="button"
        onClick={() => {
          setLeaderboardMode("xp");
          setShowWeekly(false);
          setShowWeeklyHistory(false);
        }}
        style={leaderboardButtonStyle(isXpMode)}
      >
        {isXpMode ? "✓ " : ""}XP
      </button>

      {isWeeklyMode && (
        <button
          type="button"
          onClick={() => setShowWeeklyHistory((prev) => !prev)}
          style={leaderboardButtonStyle(showWeeklyHistory, false, "#4da3ff")}
        >
          {showWeeklyHistory ? "✓ " : ""}Prev 6 Weeks
        </button>
      )}
    </div>

    <h2
      style={{
        color: "#18bb1a",
        fontWeight: "bold",
        fontSize: 30,
        textTransform: "uppercase",
        textShadow: "0 0 8px #18bb1a, 0 0 16px #18bb1a",
        marginBottom: 12,
      }}
    >
      {leaderboardTitle}
    </h2>

    {renderActiveLeaderboard(false)}
    {isWeeklyMode && showWeeklyHistory && renderWeeklyHistory()}
  </div>
)}

{isMobile && activeTab === "leaderboard" && (
  <div style={{ marginTop: 20 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => {
          setLeaderboardMode("alltime");
          setShowWeekly(false);
          setShowWeeklyHistory(false);
        }}
        style={leaderboardButtonStyle(isAllTimeMode, true)}
      >
        {isAllTimeMode ? "✓ " : ""}All-Time
      </button>

      <button
        type="button"
        onClick={() => {
          setLeaderboardMode("weekly");
          setShowWeekly(true);
          setShowWeeklyHistory(false);
        }}
        style={leaderboardButtonStyle(isWeeklyMode, true)}
      >
        {isWeeklyMode ? "✓ " : ""}Weekly
      </button>

      <button
        type="button"
        onClick={() => {
          setLeaderboardMode("characters");
          setShowWeekly(false);
          setShowWeeklyHistory(false);
        }}
        style={leaderboardButtonStyle(isCharacterMode, true)}
      >
        {isCharacterMode ? "✓ " : ""}Characters
      </button>

      <button
        type="button"
        onClick={() => {
          setLeaderboardMode("xp");
          setShowWeekly(false);
          setShowWeeklyHistory(false);
        }}
        style={leaderboardButtonStyle(isXpMode, true)}
      >
        {isXpMode ? "✓ " : ""}XP
      </button>

      {isWeeklyMode && (
        <button
          type="button"
          onClick={() => setShowWeeklyHistory((prev) => !prev)}
          style={leaderboardButtonStyle(showWeeklyHistory, true, "#4da3ff")}
        >
          {showWeeklyHistory ? "✓ " : ""}Prev 6 Weeks
        </button>
      )}
    </div>

    <h2
      style={{
        color: "#18bb1a",
        fontWeight: "bold",
        fontSize: 24,
        textTransform: "uppercase",
        textShadow: "0 0 8px #18bb1a, 0 0 16px #18bb1a",
        marginBottom: 12,
      }}
    >
      {leaderboardTitle}
    </h2>

    {renderActiveLeaderboard(true)}
    {isWeeklyMode && showWeeklyHistory && renderWeeklyHistory()}
  </div>
)}

      {/* ---------------- GAMES GRID ---------------- */}
      {(!isMobile || activeTab !== "leaderboard") && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
            gap: 20,
          }}
        >
          {/* OPEN */}
          {(!isMobile || activeTab === "open") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h3>🟢 Open Clashes ({openGames.length})</h3>
            {renderGamesWithSingleAd(openGames)}
            </div>
          )}

          {/* ACTIVE */}
          {(!isMobile || activeTab === "active") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h3>🟡 Active Clashes ({activeGames.length})</h3>
            {renderGamesWithSingleAd(activeGames)}
            </div>
          )}

          {/* SETTLED */}
          {(!isMobile || activeTab === "settled") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

<div
  style={{
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  }}
>
  {/* Settled */}
  <button
    type="button"
    onClick={() => setShowResolved((v) => !v)}
    style={{
      padding: "8px 12px",
      borderRadius: 999,
      border: showResolved ? "1px solid #18bb1a" : "1px solid #333",
      background: showResolved ? "rgba(24,187,26,0.14)" : "#111",
      color: showResolved ? "#18bb1a" : "#ddd",
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer",
      boxShadow: showResolved ? "0 0 10px rgba(24,187,26,0.18)" : "none",
      transition: "all 0.2s ease",
    }}
  >
    {showResolved ? "✓ " : ""}Settled
  </button>

  {/* Cancelled */}
  <button
    type="button"
    onClick={() => setShowCancelled((v) => !v)}
    style={{
      padding: "8px 12px",
      borderRadius: 999,
      border: showCancelled ? "1px solid #ff4d4d" : "1px solid #333",
      background: showCancelled ? "rgba(255,77,77,0.14)" : "#111",
      color: showCancelled ? "#ff4d4d" : "#ddd",
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer",
      boxShadow: showCancelled ? "0 0 10px rgba(255,77,77,0.18)" : "none",
      transition: "all 0.2s ease",
    }}
  >
    {showCancelled ? "✓ " : ""}Cancelled
  </button>

  {/* Archive */}
  <button
    type="button"
    onClick={() => setShowArchive((v) => !v)}
    style={{
      padding: "8px 12px",
      borderRadius: 999,
      border: showArchive ? "1px solid #4da3ff" : "1px solid #333",
      background: showArchive ? "rgba(77,163,255,0.14)" : "#111",
      color: showArchive ? "#4da3ff" : "#aaa",
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer",
      boxShadow: showArchive ? "0 0 10px rgba(77,163,255,0.16)" : "none",
      transition: "all 0.2s ease",
    }}
  >
    {showArchive ? "✓ " : ""}Archive
  </button>
</div>

              {showResolved && latestSettled.length > 0 && (
                <>
                  <h3>🔵 Settled Clashes ({latestSettled.length})</h3>
              {renderGamesWithRepeatingAds(
                [...latestSettled].sort(
                  (a, b) => new Date(b.settledAt).getTime() - new Date(a.settledAt).getTime()
                ),
                "settled"
                )}
                </>
              )}

              {showCancelled && cancelledGames.length > 0 && (
                <>
                  <h3>❌ Cancelled Clashes ({cancelledGames.length})</h3>
                  {cancelledGames.map((g) => (
                    <div key={g.id} style={{ width: "100%" }}>
                      <GameCard g={g} {...gameCardProps} roundResults={g.roundResults || []} />
                    </div>
                  ))}
                </>
              )}

              {showArchive && archivedSettled.length > 0 && (
                <>
                  <h3>📦 Archived Clashes ({archivedSettled.length})</h3>
                  {archivedSettled.map((g) => (
                    <div key={g.id} style={{ width: "100%" }}>
                      <GameCard g={g} {...gameCardProps} roundResults={g.roundResults || []} />
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
    
<div
  style={{
    marginTop: 50,
    padding: "20px 12px",
    textAlign: "center",
    borderTop: "1px solid #222",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  }}
>
{/* Copyright */}
<div
  style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontSize: 13,
    color: "#888",
    letterSpacing: 1,
    textTransform: "uppercase",
    textShadow: "0 0 8px rgba(24,187,26,0.4)",
  }}
>
        <img
          src={PlanetZephyrosLogo}
          alt="Planet Zephyros"
          style={{
            height: 24,
            width: "auto",
            objectFit: "contain",
            filter: "drop-shadow(0 0 6px rgba(24,187,26,0.5))",
          }}
        />

        <span>
          © {new Date().getFullYear()} Planet Zephyros × @ETN_Villain
        </span>
      </div>

  {/* Divider line (subtle polish) */}
  <div
    style={{
      width: 60,
      height: 1,
      background: "linear-gradient(to right, transparent, #333, transparent)",
      margin: "4px auto",
    }}
  />

  {/* Disclaimer */}
  <div
    style={{
      fontSize: 11,
      color: "#555",
      maxWidth: 520,
      marginInline: "auto",
      lineHeight: 1.4,
    }}
  >
    Core Clash is a blockchain-based game. Use at your own risk. No financial advice.
    Users are responsible for their wallets, transactions, and smart contract interactions.
  </div>
</div>

  {/* ---------------- HELP MODAL ---------------- */}
  {helpModal && (
    <div
      onClick={() => setHelpModal(null)}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "80vh",
          overflowY: "auto",
          background: "#111",
          border: "1px solid #333",
          borderRadius: 12,
          padding: 20,
          color: "#ddd",
          boxShadow: "0 0 16px rgba(0,0,0,0.9)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2 style={{ color: "#18bb1a", margin: 0 }}>
            {helpModal === "how" ? "How To Play" : "Game Info"}
          </h2>
          <button
            onClick={() => setHelpModal(null)}
            style={{
              background: "none",
              border: "none",
              color: "#aaa",
              fontSize: 20,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {helpModal === "how" && (
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            <b>CORE CLASH</b>
            <br />
            <br />
            <b>Connect Wallet</b>
            <br />
            <br />
            <b>Create Game</b>
            <br />
            1. Add stake amount
            <br />
            2. Select your Clash Team
            <br />
            3. Press <b>Validate Team</b>
            <br />
            4. Press <b>Create Game</b>
            <br />
            5. Approve wallet transactions
            <br />
            6. Reveal file downloads automatically
            <br />
            <br />
            <b>Join Game</b>
            <br />
            1. Select your Clash Team
            <br />
            2. Press <b>Validate Team</b>
            <br />
            3. Find game in Open
            <br />
            4. Press Join Game
            <br />
            5. Approve wallet transactions
            <br />
            6. Reveal file downloads automatically
            <br />
            <br />
            <b>Reveal & Settle</b>
            <br />
            Auto-reveal will request wallet confirmation.
            <br />
            If it fails, upload your reveal file manually.
            <br />
            Once both players reveal, the game settles automatically.
          </div>
        )}

        {helpModal === "info" && (
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            <b>Your Clash Team</b>
            <br />
            <br />
            • 3 NFTs from approved collections
            <br />
            • Only 1 rare background allowed (Gold, Verdant Green, Aether Purple, Rose Gold, Silver)
            <br />
            • Only 1 of each character
            <br />
            • You must own the NFT
            <br />
            • You cannot join your own game
            <br />
            • Pick 3 from the same faction for 10% attack boost
            <br />
            <br />
            <b>The Clash</b>
            <br />
            <br />
            Slot 1 vs Slot 1
            <br />
            Slot 2 vs Slot 2
            <br />
            Slot 3 vs Slot 3
            <br />
            <br />
            Each round results in a win or tie.
            <br />
            Score difference breaks ties.
            <br />
            <br />
            <b>Fees</b>
            <br />
            <br />
            5% of the pot
            <br />
            • 2% ETN_Villain
            <br />
            • 2% dApp host
            <br />
            • 1% CORE burn
            <br />
            <br />
            <b>Payout</b>
            <br />
            <br />
            Winner receives 95% of the pot.
            <br />
            If tied, 100% returned to players.
          </div>
        )}
      </div>
    </div>
  )}
</div>
</div>
</div>
);
}