import React from "react";
import EcosystemCard from "./ecosystemCard";
import EcosystemBanner from "./ecosystemBanner";

export default function EcosystemBlock({
  isMobile,
  handleEcosystemClick,
  ElectroSwap,
  TelegramLogo,
  XLogo,
  PlanetZephyrosAE,
  VerdantKinBanner,
  VerdantQueenBanner,
  AetherScionsBanner,
  EvgBanner,
}) {
  const ecosystemItems = [
    {
      type: "card",
      linkKey: "staking",
      label: "Staking",
      alt: "Core Ascension",
      videoSrc: PlanetZephyrosAE,
      imageScale: 1.10, // 👈 add this
      url: "https://staking.planetzephyros.xyz",
    },
    {
      type: "card",
      linkKey: "electroswap",
      label: "Buy",
      alt: "Buy CORE",
      imageSrc: ElectroSwap,
      url: "https://app.electroswap.io/explore/tokens/electroneum/0x309b916b3a90cb3e071697ea9680e9217a30066f?inputCurrency=ETN",
    },
    {
      type: "card",
      linkKey: "telegram",
      label: "TG",
      alt: "Planet Zephyros Telegram",
      imageSrc: TelegramLogo,
      imageScale: 1,
      url: "https://t.me/PlanetZephyros",
    },
    {
      type: "card",
      linkKey: "website",
      label: "Website",
      alt: "Zephyros Planet ETN",
      videoSrc: PlanetZephyrosAE,
      imageScale: 1.10, // 👈 add this
      url: "https://planetetn.org/zephyros",
    },
    {
      type: "card",
      linkKey: "x",
      label: "X",
      alt: "Planet Zephyros X",
      imageSrc: XLogo,
      imageScale: 1,
      url: "https://x.com/PlanetZephyros",
    },
{
  type: "banner",
  linkKey: "vkin",
  alt: "Verdant Kin",
  imageSrc: VerdantKinBanner,
  objectFit: "contain",
  desktopMaxWidth: 320,
  desktopHeight: 78,
  imageScale: 1,
  imageTranslateY: 0,
  url: "https://app.electroswap.io/nfts/collection/0x3fc7665B1F6033FF901405CdDF31C2E04B8A2AB4",
},
{
  type: "banner",
  linkKey: "vqle",
  alt: "Verdant Queen",
  imageSrc: VerdantQueenBanner,
  objectFit: "contain",
  desktopMaxWidth: 320,
  desktopHeight: 78,
  imageScale: 0.94,
  imageTranslateY: 0,
  url: "https://panth.art/collections/0x8cFBB04c54d35e2e8471Ad9040D40D73C08136f0",
},
{
  type: "banner",
  linkKey: "scions",
  alt: "Aether Scions",
  imageSrc: AetherScionsBanner,
  objectFit: "contain",
  desktopMaxWidth: 320,
  desktopHeight: 78,
  imageScale: 0.92,
  imageTranslateY: 0,
  url: "https://app.electroswap.io/nfts/collection/0xAc620b1A3dE23F4EB0A69663613baBf73F6C535D",
},
{
  type: "banner",
  linkKey: "evg",
  alt: "Guardians of Erevos",
  imageSrc: EvgBanner,
  objectFit: "cover",
  desktopMaxWidth: 416,
  desktopHeight: 78,
  imageScale: 1,
  imageTranslateY: 0,
  url: "https://panth.art/collections/0x5C81a5609EaeEF7962F1D089D6343F9790387901",
},
  ];

return (
  <div style={{ marginTop: 16, width: "100%" }}>
{/* Top links */}
<div
  style={{
    width: "100%",
    display: "flex",
    gap: 10,
    overflowX: isMobile ? "auto" : "visible",
    WebkitOverflowScrolling: "touch",
    justifyContent: isMobile ? "flex-start" : "center",
    paddingBottom: isMobile ? 4 : 0,
    marginBottom: 14,
    scrollbarWidth: "none",
  }}
>
  {ecosystemItems
    .filter((item) => item.type === "card")
    .map((item) => (
      <div
        key={item.linkKey}
        style={{
          flex: isMobile ? "0 0 110px" : "1",
          minWidth: isMobile ? 110 : undefined,
          maxWidth: isMobile ? 110 : 180,
        }}
      >
        <EcosystemCard
          isMobile={isMobile}
          label={item.label}
          alt={item.alt}
          imageSrc={item.imageSrc}
          videoSrc={item.videoSrc}
          imageScale={item.imageScale}
          onClick={() =>
            handleEcosystemClick(item.linkKey, item.url)
          }
        />
      </div>
    ))}
</div>

    {/* NFT banners */}
    <div
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr 1fr",
        gap: isMobile ? 10 : 14,
        alignItems: "center",
        justifyItems: "center",
      }}
    >
      {ecosystemItems
        .filter((item) => item.type === "banner")
        .map((item) => (
          <EcosystemBanner
            key={item.linkKey}
            isMobile={isMobile}
            imageSrc={item.imageSrc}
            alt={item.alt}
            objectFit={item.objectFit}
            desktopMaxWidth={item.desktopMaxWidth}
            desktopHeight={item.desktopHeight}
            imageScale={item.imageScale}
            imageTranslateY={item.imageTranslateY}
            onClick={() => handleEcosystemClick(item.linkKey, item.url)}
          />
        ))}
    </div>
  </div>
);
}