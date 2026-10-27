import Icon from "./Icon.jsx";

/** Orange pill −/qty/+ stepper. size "lg" for the item sheet. */
export default function QtyStepper({ qty, onInc, onDec, size, label = "Quantity", incDisabled = false, decDisabled = false }) {
  return (
    <div
      className={`stepper${size === "lg" ? " lg" : ""}`}
      role="group" aria-label={label}
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" onClick={onDec} aria-label="Remove one" disabled={decDisabled}>−</button>
      <b aria-live="polite">{qty}</b>
      <button type="button" onClick={onInc} aria-label="Add one" disabled={incDisabled}>+</button>
    </div>
  );
}

/** Round "+" add button — swaps to a QtyStepper once the item is in the cart. */
export function AddButton({ onClick, label = "Add to cart" }) {
  return (
    <button
      type="button" className="plus" aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
    >
      <Icon name="plus" />
    </button>
  );
}
