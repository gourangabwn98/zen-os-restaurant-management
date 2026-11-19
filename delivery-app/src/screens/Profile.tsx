// Profile: who I am, cash I'm holding (COD not yet handed in), app settings
// (theme, server address, permissions), notifications log and sign out.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { api } from '../api';
import { useStore } from '../store';
import { BUILD, Zen } from '../native';
import { rupees, fmtTime } from '../geo';
import { radius, space, useTheme } from '../theme';
import { Banner, Button, Card, Empty, Icon, IconBubble, Pill, Screen, Section, T, styles } from '../ui';

export function Settings({ compact }: { compact?: boolean }) {
  const t = useTheme();
  const { apiUrl, setApiUrl, themeMode, setThemeMode, session } = useStore();
  const [url, setUrl] = useState(apiUrl);
  const [perm, setPerm] = useState<{ permission: boolean } | null>(null);
  const [battery, setBattery] = useState<boolean | null>(null);
  useEffect(() => {
    Zen.trackingStatus().then(setPerm).catch(() => null);
    Zen.batteryOptimized().then(setBattery).catch(() => null);
  }, []);
  const urlOk = /^https?:\/\/[^\s]+\/api$/.test(url.trim().replace(/\/+$/, ''));
  return (
    <>
      <Section title="Appearance" />
      <Card>
        <View style={[styles.row, { gap: space(2) }]}>
          {(['system', 'light', 'dark'] as const).map((m) => (
            <Pressable key={m} onPress={() => setThemeMode(m)} style={{ flex: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center', backgroundColor: themeMode === m ? t.brand : t.surface2 }}
              accessibilityRole="radio" accessibilityState={{ selected: themeMode === m }}>
              <T v="small" color={themeMode === m ? '#fff' : t.text2}>{m === 'system' ? 'Auto' : m === 'light' ? 'Light' : 'Dark'}</T>
            </Pressable>
          ))}
        </View>
      </Card>
      {!compact && (
        <>
          <Section title="Permissions" />
          <Card>
            <View style={styles.rowB}><T v="body">Location</T><Pill label={perm?.permission ? 'Allowed' : 'Not allowed'} tone={perm?.permission ? 'go' : 'bad'} /></View>
            <T v="small" color={t.text3} style={{ marginTop: 4 }}>Used only while you have an active delivery.</T>
            <View style={[styles.rowB, { marginTop: space(3) }]}><T v="body">Battery optimisation</T><Pill label={battery ? 'On (may delay updates)' : 'Off'} tone={battery ? 'wait' : 'go'} /></View>
            <Button kind="ghost" title="Open app settings" style={{ marginTop: space(3) }} onPress={() => Zen.openAppSettings()} />
          </Card>
        </>
      )}
      <Section title="Server" />
      <Card>
        <T v="small" color={t.text3}>Your restaurant's Zen OS address (ends in /api)</T>
        <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://…/api" placeholderTextColor={t.text3}
          style={{ marginTop: 8, borderWidth: 1, borderColor: t.line, borderRadius: radius.md, paddingHorizontal: space(3), height: 48, color: t.text, backgroundColor: t.surface2 }} />
        {!urlOk && url ? <T v="small" color={t.bad} style={{ marginTop: 6 }}>Use the full address, e.g. https://example.com/api</T> : null}
        {BUILD.buildType === 'release' && url.startsWith('http://') ? <T v="small" color={t.bad} style={{ marginTop: 6 }}>Release builds only connect over https.</T> : null}
        <Button kind="secondary" title="Save address" style={{ marginTop: space(3) }} disabled={!urlOk || url.trim() === apiUrl}
          onPress={() => (session
            ? Alert.alert('Change server?', 'You will need to sign in again.', [{ text: 'Cancel' }, { text: 'Change', onPress: () => setApiUrl(url) }])
            : setApiUrl(url))} />
      </Card>
      <T v="small" color={t.text3} style={{ textAlign: 'center', marginTop: space(4) }}>Zen OS Delivery v{BUILD.version} ({BUILD.buildType}) · Maps {BUILD.mapsKeyConfigured ? 'on' : 'off'}</T>
    </>
  );
}

export default function Profile({ openNotifications }: { openNotifications: () => void }) {
  const t = useTheme();
  const { snapshot, session, logout, unread } = useStore();
  const [cash, setCash] = useState<{ total: number; collections: any[] } | null>(null);
  const loadCash = useCallback(() => { api<any>('GET', '/delivery/me/cash').then(setCash).catch(() => setCash(null)); }, []);
  useEffect(() => { loadCash(); }, [loadCash, snapshot?.today.delivered]);

  return (
    <Screen onRefresh={loadCash}>
      <Card style={{ backgroundColor: t.brand, borderColor: t.brand }}>
        <View style={styles.row}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
            <T v="h2" color="#fff">{(snapshot?.partner.name || session?.name || 'P').charAt(0).toUpperCase()}</T>
          </View>
          <View style={{ marginLeft: 14, flex: 1 }}>
            <T v="h2" color="#fff">{snapshot?.partner.name || session?.name}</T>
            <T v="small" color="rgba(255,255,255,0.85)">{session?.phone} · Delivery partner</T>
            {snapshot?.restaurant.name ? <T v="small" color="rgba(255,255,255,0.85)">{snapshot.restaurant.name}</T> : null}
          </View>
        </View>
      </Card>

      {snapshot?.state.suspended && <Banner tone="bad" icon="warn" title="Account suspended" body={snapshot.state.suspendedReason} />}

      <Section title="Cash in hand (COD)" />
      <Card>
        <View style={styles.rowB}>
          <View style={styles.row}><IconBubble name="cash" tone={cash?.total ? 'wait' : 'muted'} /><T v="num" style={{ marginLeft: 12 }} color={cash?.total ? t.wait : t.text3}>{rupees(cash?.total)}</T></View>
          {cash?.collections.length ? <Pill label={`${cash.collections.length} order${cash.collections.length > 1 ? 's' : ''}`} tone="wait" /> : null}
        </View>
        <T v="small" color={t.text3} style={{ marginTop: 6 }}>Hand this to the restaurant. It clears once they verify it.</T>
        {cash?.collections.map((c) => (
          <View key={c.id} style={[styles.rowB, { marginTop: 8 }]}>
            <T v="small">#{c.orderNo} · {fmtTime(c.collectedAt)}</T>
            <T v="small" color={c.status === 'DISPUTED' ? t.bad : t.text2}>{rupees(c.amount)}{c.status === 'DISPUTED' ? ' · disputed' : ''}</T>
          </View>
        ))}
        {!cash && <Empty icon="cash" title="Couldn't load cash" />}
      </Card>

      <Section title="Today" />
      <Card>
        <View style={styles.rowB}>
          <T v="body">Delivered</T><T v="h3" color={t.go}>{snapshot?.today.delivered ?? '—'}</T>
        </View>
        <View style={[styles.rowB, { marginTop: 8 }]}>
          <T v="body">Average delivery time</T><T v="h3">{snapshot?.today.avgDeliveryMinutes != null ? `${snapshot.today.avgDeliveryMinutes} min` : '—'}</T>
        </View>
        <View style={[styles.rowB, { marginTop: 8 }]}>
          <T v="body">Average ride (pickup → door)</T><T v="h3">{snapshot?.today.avgRideMinutes != null ? `${snapshot.today.avgRideMinutes} min` : '—'}</T>
        </View>
      </Card>

      <Card onPress={openNotifications}>
        <View style={styles.rowB}>
          <View style={styles.row}><IconBubble name="bell" tone="info" size={34} /><T v="body" style={{ marginLeft: 12 }}>Notifications</T></View>
          <View style={styles.row}>{unread > 0 && <Pill label={`${unread} new`} tone="bad" />}<Icon name="chevron" size={22} color={t.text3} /></View>
        </View>
      </Card>

      <Settings />

      <Button kind="danger" title="Sign out" icon="power" style={{ marginTop: space(5) }}
        onPress={() => Alert.alert('Sign out?', snapshot?.activeJobs.length ? 'You still have active deliveries. Location sharing will stop.' : '', [{ text: 'Cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => logout() }])} />
    </Screen>
  );
}

export function Notifications({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const { log, markLogRead } = useStore();
  useEffect(() => { markLogRead(); }, [markLogRead, log.length]);
  const tone = { info: 'info', good: 'go', warn: 'wait', bad: 'bad' } as const;
  return (
    <Screen>
      <Pressable onPress={onBack} hitSlop={12} style={[styles.row, { marginBottom: space(3) }]} accessibilityRole="button" accessibilityLabel="Back">
        <Icon name="back" size={26} color={t.brand} /><T v="body" color={t.brand} style={{ marginLeft: 4 }}>Back</T>
      </Pressable>
      <T v="h1">Notifications</T>
      <T v="small" color={t.text3} style={{ marginTop: 4, marginBottom: space(3) }}>Activity on this phone since you opened the app</T>
      {log.length === 0 ? <Card><Empty icon="bell" title="No notifications yet" /></Card> : log.map((l) => (
        <Card key={l.id}>
          <View style={styles.row}>
            <IconBubble name={l.tone === 'bad' || l.tone === 'warn' ? 'warn' : l.tone === 'good' ? 'check' : 'bell'} tone={tone[l.tone]} size={34} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <T v="body">{l.title}</T>
              {l.body ? <T v="small" color={t.text3}>{l.body}</T> : null}
            </View>
            <T v="tiny" color={t.text3}>{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</T>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
