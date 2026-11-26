export function SpaceBackground() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
    >
      <div
        className="absolute inset-x-0 top-0 h-[420px]"
        style={{
          background:
            "radial-gradient(ellipse 75% 60% at 50% -10%, rgba(20, 184, 166, 0.08), transparent 72%)",
        }}
      />
    </div>
  );
}
