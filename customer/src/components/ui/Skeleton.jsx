export default function Skeleton({ width = "100%", height = 16, radius, style }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />;
}

/** Placeholder matching the product grid while the menu loads. */
export function MenuSkeleton({ withHero = false }) {
  return (
    <div role="status" aria-label="Loading menu">
      {withHero && <Skeleton height={200} radius={28} />}
      {withHero && (
        <div style={{ display: "flex", gap: 14, margin: "22px 0", overflow: "hidden" }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} width={84} height={84} radius="50%" style={{ flex: "none" }} />)}
        </div>
      )}
      <div className="grid">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={240} radius={22} />)}
      </div>
    </div>
  );
}
