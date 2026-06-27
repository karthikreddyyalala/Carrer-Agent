// Fixed grain overlay. Kept pointer-events-none and out of scroll containers
// so it never triggers repaint storms on scroll.
export function Atmosphere() {
  return <div className="atmosphere" aria-hidden="true" />;
}
