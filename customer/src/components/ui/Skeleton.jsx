export default function Skeleton({ width = "100%", height = 16, radius = 8, style }) {
  return (
    <div
      className="skeleton"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

export function MenuCardSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Skeleton height={160} radius={16} />
      <Skeleton height={14} width="70%" />
      <Skeleton height={12} width="40%" />
    </div>
  );
}
