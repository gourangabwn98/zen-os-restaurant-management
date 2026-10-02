// src/pages/admin/dashboard/icons.jsx — line icons in the sidebar's style.
const PATHS = {
  money: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6 10v4M18 10v4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  bag: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  table: <><rect x="4" y="8" width="16" height="6" rx="2" /><path d="M7 14v6M17 14v6" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.5L16 9.5" /></>,
  total: <><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

export default function Ico({ id, size }) {
  return (
    <svg className="zd-ico" viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      {PATHS[id]}
    </svg>
  );
}
