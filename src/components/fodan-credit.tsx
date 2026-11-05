// Fixed maintainer credit. Rendered on every public page; intentionally not editable
// from the backend so the maintainer attribution and support line cannot be removed.
export function FodanCredit({ className = "" }: { className?: string }) {
  return (
    <p
      className={className}
      style={{ margin: 0, padding: "10px 16px", textAlign: "center", fontSize: 12, lineHeight: 1.5, opacity: 0.85 }}
    >
      Powered and Maintained by{" "}
      <a href="https://wa.me/2348067578112" target="_blank" rel="noopener" style={{ fontWeight: 600, textDecoration: "underline" }}>
        Fodan Softnet
      </a>{" "}
      (<a href="tel:+2348067578112" style={{ textDecoration: "underline" }}>+2348067578112</a>)
    </p>
  );
}
