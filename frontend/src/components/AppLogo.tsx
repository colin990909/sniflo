/**
 * App logo — renders the Sniflo icon from the static asset.
 */
export function AppLogo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/app-icon.png"
      alt="Sniflo"
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}
