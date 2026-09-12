import { GLASS_BG, GLASS_BORDER, RADIUS_MD, SHADOW_GLASS, BLUR } from "../../theme.js";

export default function GlassCard({
  children,
  onClick,
  style,
  radius = RADIUS_MD,
  padding,
  soft = false,
  as = "div",
  ...rest
}) {
  const Tag = as;
  return (
    <Tag
      onClick={onClick}
      style={{
        background: soft ? "rgba(255,255,255,0.05)" : GLASS_BG,
        border: `1px solid ${GLASS_BORDER}`,
        borderRadius: radius,
        backdropFilter: BLUR,
        WebkitBackdropFilter: BLUR,
        boxShadow: SHADOW_GLASS,
        padding,
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
