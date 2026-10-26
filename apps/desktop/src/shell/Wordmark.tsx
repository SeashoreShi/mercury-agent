import { useThemeStore } from "@/stores/theme";

/** The Mercury wordmark with its breathing glow (first-run hero, board 01). */
export function Wordmark({ size = 300, breathe = true }: { size?: number; breathe?: boolean }) {
  const resolved = useThemeStore((s) => s.resolved);
  return (
    <div className="relative flex items-center justify-center" style={{ width: size * 1.6, height: size * 0.55 }}>
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute rounded-full ${breathe ? "mercury-breathe" : ""}`}
        style={{
          width: size * 1.6,
          height: size * 0.8,
          background: "radial-gradient(closest-side, rgba(52,225,161,.22), rgba(52,225,161,0))",
        }}
      />
      <img
        src={resolved === "dark" ? "/logo-full-dark.png" : "/logo-full-light.png"}
        alt="Mercury Agent"
        className={`relative ${breathe ? "mercury-wordmark" : ""}`}
        style={{ width: size, height: "auto" }}
        draggable={false}
      />
    </div>
  );
}
