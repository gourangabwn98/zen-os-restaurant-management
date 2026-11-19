// Zen OS Delivery — app shell: theme, session gate, bottom tabs
// (Home · Deliveries · History · Profile), pushed screens (delivery detail,
// notifications, settings) and the global "new request" sheet.
// No navigation library: a small explicit stack keeps the APK lean.
import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, StatusBar, Text, useColorScheme, View } from 'react-native';
import { StoreProvider, useStore } from './src/store';
import { DARK, LIGHT, ThemeContext, useTheme, space } from './src/theme';
import { Icon, IconName, Screen, T } from './src/ui';
import Login, { Splash } from './src/screens/Login';
import Home from './src/screens/Home';
import Deliveries from './src/screens/Deliveries';
import JobDetail from './src/screens/JobDetail';
import History from './src/screens/History';
import Profile, { Notifications, Settings } from './src/screens/Profile';
import OfferOverlay from './src/screens/OfferOverlay';

type Tab = 'home' | 'deliveries' | 'history' | 'profile';
type Pushed = { kind: 'job'; id: string } | { kind: 'notifications' } | { kind: 'settings' };

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'deliveries', label: 'Deliveries', icon: 'bike' },
  { key: 'history', label: 'History', icon: 'history' },
  { key: 'profile', label: 'Profile', icon: 'user' },
];

function TabBar({ tab, onTab, badge }: { tab: Tab; onTab: (t: Tab) => void; badge: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.line, paddingBottom: 6, paddingTop: 6 }} accessibilityRole="tablist">
      {TABS.map((x) => {
        const on = tab === x.key;
        return (
          <Pressable key={x.key} onPress={() => onTab(x.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 6, minHeight: 52 }}
            accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={x.label} android_ripple={{ color: t.brandSoft, borderless: true }}>
            <View style={{ paddingHorizontal: 18, paddingVertical: 3, borderRadius: 16, backgroundColor: on ? t.brandSoft : 'transparent' }}>
              <Icon name={x.icon} size={20} color={on ? t.brand : t.text3} />
              {x.key === 'deliveries' && badge > 0 && (
                <View style={{ position: 'absolute', right: 8, top: -2, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '800' }}>{badge}</Text>
                </View>
              )}
            </View>
            <Text style={{ fontSize: 11.5, fontWeight: on ? '800' : '600', color: on ? t.brand : t.text3, marginTop: 3 }}>{x.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Main() {
  const t = useTheme();
  const { ready, session, snapshot, focusJobId, setFocusJobId } = useStore();
  const [tab, setTab] = useState<Tab>('home');
  const [stack, setStack] = useState<Pushed[]>([]);
  const [showSplash, setShowSplash] = useState(true);
  useEffect(() => { const id = setTimeout(() => setShowSplash(false), 900); return () => clearTimeout(id); }, []);

  const push = (p: Pushed) => setStack((s) => [...s, p]);
  const pop = () => setStack((s) => s.slice(0, -1));
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length) { pop(); return true; }
      if (tab !== 'home') { setTab('home'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, tab]);
  useEffect(() => { if (focusJobId) { push({ kind: 'job', id: focusJobId }); setFocusJobId(null); } }, [focusJobId, setFocusJobId]);
  useEffect(() => { if (!session) { setStack([]); setTab('home'); } }, [session]);

  if (!ready || showSplash) {return <Splash />;}
  const top = stack[stack.length - 1];

  if (!session) {
    if (top?.kind === 'settings') {
      return (
        <Screen>
          <Pressable onPress={pop} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space(3) }}>
            <Icon name="back" size={26} color={t.brand} /><T v="body" color={t.brand}> Back</T>
          </Pressable>
          <T v="h1">Settings</T>
          <Settings compact />
        </Screen>
      );
    }
    return <Login onOpenSettings={() => push({ kind: 'settings' })} />;
  }

  const openJob = (id: string) => push({ kind: 'job', id });
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1 }}>
        {top?.kind === 'job' ? <JobDetail jobId={top.id} onBack={pop} />
          : top?.kind === 'notifications' ? <Notifications onBack={pop} />
          : tab === 'home' ? <Home openJob={openJob} openNotifications={() => push({ kind: 'notifications' })} />
          : tab === 'deliveries' ? <Deliveries openJob={openJob} />
          : tab === 'history' ? <History />
          : <Profile openNotifications={() => push({ kind: 'notifications' })} />}
      </View>
      {!top && <TabBar tab={tab} onTab={setTab} badge={snapshot?.activeJobs.length || 0} />}
      <OfferOverlay onAccepted={(id) => { setStack([{ kind: 'job', id }]); }} />
    </View>
  );
}

function Themed() {
  const system = useColorScheme();
  const { themeMode } = useStore();
  const palette = (themeMode === 'system' ? system : themeMode) === 'dark' ? DARK : LIGHT;
  return (
    <ThemeContext.Provider value={palette}>
      <StatusBar barStyle="light-content" backgroundColor={palette.brandDeep} />
      <Main />
    </ThemeContext.Provider>
  );
}

export default function App() {
  return <StoreProvider><Themed /></StoreProvider>;
}
