// backend/swapsConfig.js
export const CLUB_TELEGRAM_MESSAGE_THREAD_ID = process.env.CLUB_TELEGRAM_MESSAGE_THREAD_ID;
export const CLUB_TELEGRAM_CHAT_ID = process.env.CLUB_TELEGRAM_CHAT_ID;
export const CLUB_TELEGRAM_BOT_TOKEN = process.env.CLUB_TELEGRAM_BOT_TOKEN;
export const CLUB_ALL_SWAPS_CHAT_ID = process.env.CLUB_ALL_SWAPS_CHAT_ID;
export const CLUB_ALL_SWAPS_MESSAGE_THREAD_ID = process.env.CLUB_ALL_SWAPS_MESSAGE_THREAD_ID;

export const TRACKED_TOKENS = [
  {
    symbol: "CLUB",
    address: process.env.CLUB_TOKEN_ADDRESS,
    animationFileId: "CgACAgQAAxkBAAMTaeVPB28-3Q8V23ze5ubFmPj3_qUAApceAAL9hyhT0dUyofZKLpU7BA",
    pools: [
      {
        address: "0x86566c3c78424e3c3c2aDb274FAB551B7262E0ca",
        dex: "ELECTROV3", // confirm
      },
      {
        address: "0x2132e7c909C4c3338Eda5F0e165A3A43AaDC3FBe",
        dex: "ELECTROV3", // confirm
      },
    ],
  },

    {
    symbol: "BOLT",
    address: process.env.BOLT_TOKEN_ADDRESS,
    animationFileId: "CgACAgQAAxkBAAMSaeVPBzR5WutnD7vfJhtOFjZQ2sYAApYeAAL9hyhT5JKVAWiGYnw7BA",
    pools: [
      {
        address: "0x32ECfC060373e3379A86538A5017b4D89A5A75c1",
        dex: "ELECTROV3", // confirm
      },
      {
        address: "0x2Df6c494B5e96b781b5cB410C4889D4f079bad30",
        dex: "ELECTROV3", // confirm
      },
    ],
  },

{
  symbol: "CORE",
  address: process.env.CORE_TOKEN_ADDRESS,

  // CLUB bot animation
  animationFileId:
    "CgACAgQAAxkBAAMUaeVPB7KE3I4HyzQbVWApm86iGPkAApgeAAL9hyhTxYC3rKcDPdk7BA",

  // Zephyros bot animation
  zephyrosAnimationFileId:
    "CgACAgQAAxkBAAMFageBD-eZV-B_uGg2Y72GurOfNFoAApgeAAL9hyhTCD9skqLLhrY7BA",

  pools: [
    {
      address: "0xc3FE6f98765493aB62AD87C9B5022Ff2FAA2e98D",
      dex: "UNIV2",
    },
  ],
},

  {
    symbol: "USDT",
    address: process.env.USDT_TOKEN_ADDRESS,
    animationFileId: "CgACAgQAAxkBAAMJaeU4VBLQNUqzxjtT8ra4f-UvTpcAAn4eAAL9hyhT43FbidVtvH47BA",
    pools: [
      {
        address: "0x0CC625331C9b22D94fEF29d462aB1c9B26dFF196",
        dex: "ELECTROV3", // confirm
      },
    ],
  },

  {
    symbol: "USDC",
    address: process.env.USDC_TOKEN_ADDRESS,
    animationFileId: "CgACAgQAAxkBAAMIaeU4UuTy0PpBrsvAI-MnyB2n4EEAAn0eAAL9hyhTu76clefTN4c7BA",
    pools: [
      {
        address: "0x2cB2Af7aef7AB4cc3228F9c55EE8542Cb323Ad8A",
        dex: "ELECTROV3", // confirm
      },
    ],
  },

  {
    symbol: "DCNT",
    address: process.env.DCNT_TOKEN_ADDRESS,
    imageFileId: "AgACAgQAAxkBAAMFaeU4UFhJVTHEr7IC5NwI-9hOqQADygxrG_2HKFOUi4Hl8IFWCAEAAwIAA3kAAzsE",    
    pools: [
      {
        address: "0x6cDF9e7c8177BFCEc940E3f195ACf5a9C04ae3CD",
        dex: "ELECTROV3", // confirm
      },
    ],
  },

  {
    symbol: "PDY",
    address: process.env.PDY_TOKEN_ADDRESS,
    pools: [
      {
        address: "0x0d138f0bf5C7Bb25A078F791E5802776656e82D3",
        dex: "UNIV2", // confirm
      },
    ],
  },

  {
    symbol: "MEGA",
    address: process.env.MEGA_TOKEN_ADDRESS,
    pools: [
      {
        address: "0x1c229497104c5DAb8933E0945e9d1E2a2a1cE824",
        dex: "ELECTROV3", // confirm
      },
    ],
  },

  {
    symbol: "DYNO",
    address: process.env.DYNO_TOKEN_ADDRESS,
    animationFileId: "CgACAgQAAxkBAAMVaeVPCEIgpWes0jRUTjz8Q-PM4zcAApkeAAL9hyhTBnHlEs9fAgw7BA",
    pools: [
      {
        address: "0x32ECfC060373e3379A86538A5017b4D89A5A75c1",
        dex: "ELECTROV3", // confirm
      },
      {
        address: "0x806559d60869359CD4Eb4FfD94Ad8F9b668D919C",
        dex: "ELECTROV3", // confirm
      },
      {
        address: "0x2132e7c909C4c3338Eda5F0e165A3A43AaDC3FBe",
        dex: "ELECTROV3", // confirm
      },
    ],
  },

  {
    symbol: "FUGAZI",
    address: process.env.FUGAZI_TOKEN_ADDRESS,
    imageFileId: "AgACAgQAAxkBAAMHaeU4UaFtHkC3sazhaC0LtHq--y8AAssMaxv9hyhToYIPkNKbT0oBAAMCAAN5AAM7BA",    
    pools: [
      {
        address: "0x5F868b7E7345c0D6D4daD376521e6Ac4ac0CC836",
        dex: "UNIV2", // confirm
      },
    ],
  },
];

export const PRICING_POOLS = [
  // Stables (keep these as $1 anchors)
  {
    address: "0x0CC625331C9b22D94fEF29d462aB1c9B26dFF196", // USDT pool
    dex: "ELECTROV3",
  },
  {
    address: "0x2cB2Af7aef7AB4cc3228F9c55EE8542Cb323Ad8A", // USDC pool
    dex: "ELECTROV3",
  },

  // === HIGH PRIORITY: Direct WETN pairs (most reliable) ===
  {
    address: "0x2Df6c494B5e96b781b5cB410C4889D4f079bad30", // BOLT / WETN
    dex: "ELECTROV3",
  },
  {
    address: "0x806559d60869359CD4Eb4FfD94Ad8F9b668D919C", // DYNO / WETN
    dex: "ELECTROV3",
  },
  {
    address: "0x86566c3c78424e3c3c2aDb274FAB551B7262E0ca", // CLUB / WETN (one of the V3 pools)
    dex: "ELECTROV3",
  },

  // Optional but helpful for better connectivity
  {
    address: "0x32ECfC060373e3379A86538A5017b4D89A5A75c1", // DYNO / BOLT (very liquid)
    dex: "ELECTROV3",
  },
  {
    address: "0x2132e7c909C4c3338Eda5F0e165A3A43AaDC3FBe", // CLUB / DYNO or another CLUB pool
    dex: "ELECTROV3",
  },

  {
     address: "0xc3FE6f98765493aB62AD87C9B5022Ff2FAA2e98D", // CORE / WETN
     dex: "UNIV2",
   },

  {
    address: "0x0d138f0bf5C7Bb25A078F791E5802776656e82D3", // PDY / WETN
    dex: "UNIV2",
  },

  {
    address: "0x1c229497104c5DAb8933E0945e9d1E2a2a1cE824", // MEGA / WETN
    dex: "ELECTROV3",
  }
];

// backend/swapsConfig.js  ← add this at the end

export const TOKEN_SYMBOL_MAP = {
  // WETN / native wrapped token (common input)
  "0x138dafbda0ccb3d8e39c19edb0510fc31b7c1c77": "WETN",

  // Your tracked tokens + common intermediates
  [process.env.CLUB_TOKEN_ADDRESS?.toLowerCase()]: "CLUB",
  [process.env.BOLT_TOKEN_ADDRESS?.toLowerCase()]: "BOLT",
  [process.env.DYNO_TOKEN_ADDRESS?.toLowerCase()]: "DYNO",
  [process.env.CORE_TOKEN_ADDRESS?.toLowerCase()]: "CORE",
  [process.env.USDT_TOKEN_ADDRESS?.toLowerCase()]: "USDT",
  [process.env.USDC_TOKEN_ADDRESS?.toLowerCase()]: "USDC",
  [process.env.DCNT_TOKEN_ADDRESS?.toLowerCase()]: "DCNT",
  [process.env.PDY_TOKEN_ADDRESS?.toLowerCase()]: "PDY",
  [process.env.MEGA_TOKEN_ADDRESS?.toLowerCase()]: "MEGA",
  [process.env.FUGAZI_TOKEN_ADDRESS?.toLowerCase()]: "FUGAZI",

  // Add any other common tokens here if they appear in routes
};

export const ROUTER_ADDRESS = "0x2c12c8f15637b7a182dec202816148a5e767dcec"; // the Universal Router you see in traces