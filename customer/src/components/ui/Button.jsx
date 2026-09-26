/** Pill button — variant: "primary" | "ghost" | "danger". Extra classes
 * (e.g. "btn-sm") go through `className`. */
export default function Button({
  children, variant = "primary", className = "", type = "button", loading, disabled, ...rest
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${className}`.trim()}
      disabled={disabled || loading}
      {...rest}
    >
      {children}
    </button>
  );
}
