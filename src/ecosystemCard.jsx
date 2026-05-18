export default function EcosystemCard({
  onClick,
  imageSrc,
  videoSrc,
  alt,
  label,
  isMobile,
  maxWidth = 140,
  imageScale = 1,
}) {
    return (
    <div
      onClick={onClick}
      style={{
        textDecoration: "none",
        width: "100%",
        maxWidth: isMobile ? maxWidth : 180,
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
      onMouseEnter={(e) => {
        if (!isMobile) {
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.boxShadow = "0 6px 14px rgba(0,0,0,0.6)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isMobile) {
          e.currentTarget.style.transform = "none";
          e.currentTarget.style.boxShadow = "none";
        }
      }}
    >
<div
  style={{
    background: "#0f0f0f",
    border: "1px solid #333",
    borderRadius: 12,
    padding: isMobile ? "12px 8px" : "12px 14px",
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: isMobile ? 6 : 12,
    minHeight: isMobile ? 92 : "auto",
    width: "100%",
    boxShadow: "0 0 8px rgba(0,0,0,0.5)",
    textAlign: "center",
  }}
>
          {videoSrc ? (
          <video
            src={videoSrc}
            autoPlay
            loop
            muted
            playsInline
style={{
  width: isMobile ? 38 : 44,
  height: isMobile ? 38 : 44,
  borderRadius: 6,
  objectFit: "cover",
  transform: `scale(${imageScale})`,
}}
          />
        ) : (
          <img
            src={imageSrc}
            alt={alt}
style={{
  width: isMobile ? 34 : 40,
  height: isMobile ? 34 : 40,
  borderRadius: 6,
  transform: `scale(${imageScale})`,
}}
          />
        )}

        <span
          style={{
            fontSize: isMobile ? 12 : 14,
            fontWeight: 600,
            color: "#fff",
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}