// Zen OS Delivery design tokens — violet brand (shared with the Zen OS admin),
// mint for "go / online", amber for waiting, red for problems. Light + dark.
import { createContext, useContext } from 'react';

export type Palette = {
  mode: 'light' | 'dark';
  bg: string; surface: string; surface2: string; line: string;
  text: string; text2: string; text3: string;
  brand: string; brandDeep: string; brandSoft: string; onBrand: string;
  go: string; goSoft: string; wait: string; waitSoft: string; bad: string; badSoft: string; info: string; infoSoft: string;
  shadow: string;
};

export const LIGHT: Palette = {
  mode: 'light',
  bg: '#F6F5FB', surface: '#FFFFFF', surface2: '#F1EFF9', line: '#E6E3F2',
  text: '#16131F', text2: '#4B4760', text3: '#8A86A0',
  brand: '#5B3FE0', brandDeep: '#4338CA', brandSoft: '#ECE8FF', onBrand: '#FFFFFF',
  go: '#0E9F6E', goSoft: '#DDF6EC', wait: '#B7791F', waitSoft: '#FDF1D9', bad: '#D93636', badSoft: '#FDE4E4', info: '#2563EB', infoSoft: '#E0EAFF',
  shadow: '#2B1B6B',
};

export const DARK: Palette = {
  mode: 'dark',
  bg: '#0F0E17', surface: '#1A1826', surface2: '#232033', line: '#2F2B45',
  text: '#F4F2FF', text2: '#C2BDDC', text3: '#8A86A0',
  brand: '#8B73FF', brandDeep: '#6D56F0', brandSoft: '#2A2450', onBrand: '#FFFFFF',
  go: '#34D399', goSoft: '#123A2E', wait: '#F6C453', waitSoft: '#3A2F12', bad: '#F87171', badSoft: '#3D1B1F', info: '#7AA2FF', infoSoft: '#1B2747',
  shadow: '#000000',
};

export const space = (n: number) => n * 4;
export const radius = { sm: 10, md: 14, lg: 20, pill: 999 };
export const type = {
  h1: { fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.5 },
  h2: { fontSize: 20, fontWeight: '800' as const, letterSpacing: -0.3 },
  h3: { fontSize: 16, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '500' as const },
  small: { fontSize: 13, fontWeight: '500' as const },
  tiny: { fontSize: 11.5, fontWeight: '600' as const, letterSpacing: 0.3 },
  num: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.8 },
};

export const ThemeContext = createContext<Palette>(LIGHT);
export const useTheme = () => useContext(ThemeContext);
