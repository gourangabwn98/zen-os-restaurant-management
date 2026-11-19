// Zen OS Delivery UI kit — no UI library; one consistent look in light & dark.
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator, Animated, Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle,
} from 'react-native';
import { Palette, radius, space, type, useTheme } from './theme';

// ── icons: tintable symbol glyphs (not emoji) so they follow the theme colour ──
const GLYPH = {
  home: '⌂', list: '☰', history: '◷', user: '◉', bell: '♪', pin: '⚲', nav: '➤', phone: '✆', check: '✓', close: '✕',
  cash: '₹', clock: '◔', store: '▣', bike: '⇶', warn: '!', info: 'i', refresh: '⟳', back: '‹', chevron: '›', route: '⇢', power: '⏻',
} as const;
export type IconName = keyof typeof GLYPH;
export const Icon = ({ name, size = 18, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) => {
  const t = useTheme();
  return <Text allowFontScaling={false} style={[{ fontSize: size, color: color || t.text, fontWeight: '700', lineHeight: size * 1.15, textAlign: 'center', minWidth: size }, style]}>{GLYPH[name]}</Text>;
};
export const IconBubble = ({ name, tone = 'brand', size = 40 }: { name: IconName; tone?: Tone; size?: number }) => {
  const t = useTheme();
  const c = tones(t)[tone];
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={name} size={size * 0.48} color={c.fg} /></View>;
};

export type Tone = 'brand' | 'go' | 'wait' | 'bad' | 'info' | 'muted';
export const tones = (t: Palette) => ({
  brand: { fg: t.brand, bg: t.brandSoft }, go: { fg: t.go, bg: t.goSoft }, wait: { fg: t.wait, bg: t.waitSoft },
  bad: { fg: t.bad, bg: t.badSoft }, info: { fg: t.info, bg: t.infoSoft }, muted: { fg: t.text2, bg: t.surface2 },
});

export const T = ({ v = 'body', color, style, children, numberOfLines }: { v?: keyof typeof type; color?: string; style?: StyleProp<TextStyle>; children: React.ReactNode; numberOfLines?: number }) => {
  const t = useTheme();
  return <Text numberOfLines={numberOfLines} style={[type[v], { color: color || t.text }, style]}>{children}</Text>;
};

export const Screen = ({ children, refreshing, onRefresh, padded = true, scroll = true }: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; padded?: boolean; scroll?: boolean }) => {
  const t = useTheme();
  if (!scroll) {return <View style={{ flex: 1, backgroundColor: t.bg, padding: padded ? space(4) : 0 }}>{children}</View>;}
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: padded ? space(4) : 0, paddingBottom: space(28) }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[t.brand]} progressBackgroundColor={t.surface} /> : undefined}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
};

export const Card = ({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) => {
  const t = useTheme();
  const s = [styles.card, { backgroundColor: t.surface, borderColor: t.line, shadowColor: t.shadow }, style];
  return onPress
    ? <Pressable onPress={onPress} android_ripple={{ color: t.brandSoft }} style={({ pressed }) => [s, pressed && { opacity: 0.92 }]}>{children}</Pressable>
    : <View style={s}>{children}</View>;
};

export const Button = ({ title, onPress, kind = 'primary', loading, disabled, icon, style, big }: {
  title: string; onPress?: () => void; kind?: 'primary' | 'go' | 'danger' | 'secondary' | 'ghost'; loading?: boolean; disabled?: boolean; icon?: IconName; style?: StyleProp<ViewStyle>; big?: boolean;
}) => {
  const t = useTheme();
  const bg = { primary: t.brand, go: t.go, danger: t.bad, secondary: t.brandSoft, ghost: 'transparent' }[kind];
  const fg = kind === 'secondary' ? t.brand : kind === 'ghost' ? t.text2 : t.onBrand;
  const off = disabled || loading;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!loading }} onPress={off ? undefined : onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, minHeight: big ? 58 : 50, opacity: off ? 0.5 : pressed ? 0.88 : 1, borderWidth: kind === 'ghost' ? 1 : 0, borderColor: t.line }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : (
        <View style={styles.rowC}>
          {icon && <Icon name={icon} size={big ? 19 : 16} color={fg} style={{ marginRight: 8 }} />}
          <Text style={{ color: fg, fontSize: big ? 17 : 15.5, fontWeight: '800' }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
};

export const Pill = ({ label, tone = 'brand', dot }: { label: string; tone?: Tone; dot?: boolean }) => {
  const t = useTheme();
  const c = tones(t)[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      {dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.fg, marginRight: 6 }} />}
      <Text style={{ color: c.fg, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </View>
  );
};

export const Stat = ({ label, value, tone = 'brand', icon }: { label: string; value: string | number; tone?: Tone; icon?: IconName }) => {
  const t = useTheme();
  return (
    <Card style={{ flex: 1, padding: space(3.5), marginBottom: 0 }}>
      <View style={styles.rowB}>
        <T v="tiny" color={t.text3}>{label.toUpperCase()}</T>
        {icon && <Icon name={icon} size={14} color={tones(t)[tone].fg} />}
      </View>
      <T v="num" color={tones(t)[tone].fg} style={{ marginTop: 6 }}>{value}</T>
    </Card>
  );
};

export const Skeleton = ({ h = 18, w = '100%', r = 8, style }: { h?: number; w?: number | `${number}%`; r?: number; style?: StyleProp<ViewStyle> }) => {
  const t = useTheme();
  const a = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(a, { toValue: 0.45, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [a]);
  return <Animated.View style={[{ height: h, width: w, borderRadius: r, backgroundColor: t.surface2, opacity: a }, style]} />;
};
export const SkeletonCard = () => (
  <Card><Skeleton w="45%" /><Skeleton h={14} style={{ marginTop: 12 }} /><Skeleton h={14} w="70%" style={{ marginTop: 8 }} /></Card>
);

export const Empty = ({ icon = 'list', title, sub, action }: { icon?: IconName; title: string; sub?: string; action?: React.ReactNode }) => {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space(8), paddingHorizontal: space(6) }}>
      <IconBubble name={icon} tone="muted" size={64} />
      <T v="h3" style={{ marginTop: space(4), textAlign: 'center' }}>{title}</T>
      {sub && <T v="small" color={t.text3} style={{ marginTop: 6, textAlign: 'center', lineHeight: 19 }}>{sub}</T>}
      {action && <View style={{ marginTop: space(4), alignSelf: 'stretch' }}>{action}</View>}
    </View>
  );
};

export const Banner = ({ tone = 'info', icon = 'info', title, body, action }: { tone?: Tone; icon?: IconName; title: string; body?: string; action?: React.ReactNode }) => {
  const t = useTheme();
  const c = tones(t)[tone];
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: c.bg }]}>
      <Icon name={icon} size={16} color={c.fg} style={{ marginRight: 10, marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.fg, fontWeight: '800', fontSize: 14 }}>{title}</Text>
        {body ? <Text style={{ color: t.text2, fontSize: 13, marginTop: 2, lineHeight: 18 }}>{body}</Text> : null}
      </View>
      {action}
    </View>
  );
};

export const Section = ({ title, right }: { title: string; right?: React.ReactNode }) => {
  const t = useTheme();
  return (
    <View style={[styles.rowB, { marginTop: space(5), marginBottom: space(2.5) }]}>
      <T v="tiny" color={t.text3}>{title.toUpperCase()}</T>
      {right}
    </View>
  );
};

export const Divider = () => { const t = useTheme(); return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: space(3) }} />; };

export const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space(4), marginBottom: space(3), borderWidth: StyleSheet.hairlineWidth, elevation: 2, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  btn: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space(5) },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, alignSelf: 'flex-start' },
  banner: { flexDirection: 'row', alignItems: 'flex-start', padding: space(3.5), borderRadius: radius.md, marginBottom: space(3) },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowC: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  rowB: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

// Status words — mirror restaurant-server/utils/deliveryStateMachine.js.
export const JOB_LABEL: Record<string, { label: string; tone: Tone }> = {
  ASSIGNED: { label: 'Go to restaurant', tone: 'brand' },
  AT_RESTAURANT: { label: 'At restaurant', tone: 'wait' },
  PICKED_UP: { label: 'On the way', tone: 'info' },
  AT_CUSTOMER: { label: 'At customer', tone: 'info' },
  DELIVERED: { label: 'Delivered', tone: 'go' },
  FAILED: { label: 'Failed', tone: 'bad' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
};
