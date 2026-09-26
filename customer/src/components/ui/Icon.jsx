// Stroke icons shared by the whole app (same 24px grid/stroke as the
// reference design) — styled via the .ico class in index.css.
const PATHS = {
  home:    <path d="M4 11l8-6.5 8 6.5v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  menu:    <><rect x="4" y="4" width="6.5" height="6.5" rx="2" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="2" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="2" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" /></>,
  orders:  <><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M9 8.5h6M9 12h6M9 15.5h4" /></>,
  offers:  <><path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5L21 12l-9 9z" /><circle cx="8.5" cy="8.5" r="1.6" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6" /></>,
  bars:    <path d="M4 7h16M4 12h16M4 17h16" />,
  bag:     <path d="M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8" />,
  heart:   <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  search:  <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  filter:  <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  plus:    <path d="M12 5v14M5 12h14" />,
  arrow:   <path d="M5 12h14M13 6l6 6-6 6" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  back:    <path d="M15 6l-6 6 6 6" />,
  star:    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
};

export default function Icon({ name, className = "ico", ...rest }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...rest}>
      {PATHS[name]}
    </svg>
  );
}
