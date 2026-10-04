// MNU-06 — category icons. Keys match restaurant-server/utils/menuCategories.js
// CATEGORY_ICONS (the server picks: admin's choice → smart default → a guess
// from the name → "plate"), so a category always has a proper icon and never
// a blank disc or a stray emoji. Same glyphs as customer/src/components/CategoryIcon.jsx.
const G = {
  plate:    <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.5" /></>,
  star:     <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z" />,
  chef:     <><path d="M7 20h10M8 20v-5h8v5" /><path d="M6 12a3 3 0 0 1 1-5.8A3.5 3.5 0 0 1 12 4a3.5 3.5 0 0 1 5 2.2A3 3 0 0 1 18 12z" /></>,
  bolt:     <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />,
  flame:    <path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.9 3.6-5.4 4-9.4 2.8 1.6 4.2 4.1 4 6.6 1-.6 1.7-1.6 2-2.8 1.4 1.4 2 3.2 2 5.6 0 3.2-2.4 5.6-6 5.6z" />,
  thumbs:   <><path d="M7 11v9H4v-9zM7 11l4-7c1.4 0 2.2 1 2 2.4L12.5 10H18a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7" /></>,
  trend:    <><path d="M4 17l5-5 4 3 7-8" /><path d="M15 7h5v5" /></>,
  tea:      <><path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" /><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3c0 1.5 1 1.5 1 3M11.5 3c0 1.5 1 1.5 1 3" /></>,
  coffee:   <><path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 9h1.5a2.5 2.5 0 0 1 0 5H16" /><path d="M4 21h14" /></>,
  drink:    <><path d="M7 4h10l-1.5 16h-7z" /><path d="M7.5 9h9M13 4l2-2" /></>,
  breakfast:<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 4v2M20 12h-2" /></>,
  rice:     <><path d="M3 12h18a9 9 0 0 1-18 0z" /><path d="M8 9c0-2 1-3 2-3M12 8c0-2 1-3 2-3M16 9c0-1.5.8-2.5 1.5-2.5" /></>,
  curry:    <><path d="M3 11h18a9 7 0 0 1-18 0z" /><path d="M7 11c1-2 3-2 4 0M13 11c1-2 3-2 4 0" /></>,
  fish:     <><path d="M3 12c3-5 9-6 13-2l4-3v10l-4-3c-4 4-10 3-13-2z" /><circle cx="8" cy="11" r=".8" /></>,
  chicken:  <><path d="M14 4a5 5 0 0 1 4 8l-6 6-3-3 6-6a2 2 0 0 0-3-3" /><path d="M8 15l-3 3a1.6 1.6 0 1 0 2 2l3-3" /></>,
  mutton:   <><path d="M15 3a6 6 0 0 1 3 10l-7 7-5-5 7-7a6 6 0 0 1 2-5z" /><circle cx="14.5" cy="8.5" r="1.5" /></>,
  egg:      <path d="M12 3c3.5 0 6 5.2 6 9.5A6 6 0 0 1 6 12.5C6 8.2 8.5 3 12 3z" />,
  veg:      <><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z" /><path d="M5 19l8-8" /></>,
  bread:    <><path d="M5 10a4 4 0 0 1 3-6h8a4 4 0 0 1 3 6v9H5z" /><path d="M9 13v3M12 12v4M15 13v3" /></>,
  noodles:  <><path d="M3 12h18a9 7 0 0 1-18 0z" /><path d="M7 12V4M11 12V3M17 4l-4 8" /></>,
  roll:     <><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-25 12 12)" /><path d="M8 14l2-1M12 12l2-1" /></>,
  tandoor:  <><path d="M6 21l1-10h10l1 10z" /><path d="M9 8c0-2 1.5-2 1.5-4M13.5 8c0-2 1.5-2 1.5-4" /></>,
  soup:     <><path d="M3 11h18a9 7 0 0 1-18 0zM7 21h10" /><path d="M9 7c0-1.5 1-1.5 1-3M14 7c0-1.5 1-1.5 1-3" /></>,
  salad:    <><path d="M3 12h18a9 7 0 0 1-18 0z" /><path d="M8 12c-1-3 1-5 3-5M12 12c0-3 2-5 5-4M10 12c1-2 3-2 4 0" /></>,
  snack:    <><path d="M4 18L12 4l8 14z" /><path d="M9 14h.01M12 10h.01M14.5 15h.01" /></>,
  dessert:  <><path d="M6 11h12l-1.5 9h-9zM6 11a6 6 0 0 1 12 0" /><path d="M12 5V3" /></>,
  sweet:    <><circle cx="12" cy="13" r="7" /><path d="M8 11c2 1.5 6 1.5 8 0M12 3v3" /></>,
  icecream: <><path d="M8 11l4 10 4-10" /><path d="M7 11a5 5 0 0 1 10 0z" /></>,
  pizza:    <><path d="M12 21L3 6a14 14 0 0 1 18 0z" /><circle cx="10" cy="10" r="1" /><circle cx="14" cy="13" r="1" /></>,
  burger:   <><path d="M4 11a8 6 0 0 1 16 0zM4 15h16M5 15v1a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-1" /><path d="M4 13h16" /></>,
  thali:    <><circle cx="12" cy="12" r="9" /><circle cx="9" cy="10" r="2" /><circle cx="15" cy="10" r="2" /><circle cx="12" cy="15" r="2" /></>,
  combo:    <><rect x="3" y="7" width="8" height="12" rx="2" /><path d="M14 9h7l-1 10h-5z" /><path d="M7 7V4" /></>,
};

export default function CategoryIcon({ name, size = 26 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="cat-ico">
      {G[name] || G.plate}
    </svg>
  );
}
