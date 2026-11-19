// Phone + OTP login — the same /api/auth/employee/* flow every Zen OS staff app
// uses. Only accounts the restaurant registered as "Delivery partner" get in.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { api, ApiError } from '../api';
import { useStore } from '../store';
import { BUILD } from '../native';
import { radius, space, useTheme } from '../theme';
import { Banner, Button, T } from '../ui';

export function Splash() {
  const t = useTheme();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(a, { toValue: 1, duration: 500, useNativeDriver: true }).start(); }, [a]);
  return (
    <View style={{ flex: 1, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ opacity: a, transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }], alignItems: 'center' }}>
        <View style={s.mark}><T v="h1" color="#fff" style={{ fontSize: 44 }}>Z</T></View>
        <T v="h2" color="#fff" style={{ marginTop: space(4) }}>Zen OS Delivery</T>
        <T v="small" color="rgba(255,255,255,0.75)" style={{ marginTop: 4 }}>Partner app</T>
      </Animated.View>
    </View>
  );
}

export default function Login({ onOpenSettings }: { onOpenSettings: () => void }) {
  const t = useTheme();
  const { login, apiUrl } = useStore();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) {return undefined;}
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const clean = phone.replace(/[^\d+]/g, '');
  const send = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await api<any>('POST', '/auth/employee/send-otp', { phone: clean });
      setSent(true); setWait(30);
      setDevOtp(r?.otp ? String(r.otp) : ''); // only a local test server echoes it
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not send the code');
    } finally { setBusy(false); }
  };
  const verify = async () => {
    setErr(''); setBusy(true);
    try { await login(clean, otp.trim()); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not verify the code'); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior="height">
      <View style={[s.hero, { backgroundColor: t.brand }]}>
        <View style={s.mark}><T v="h1" color="#fff" style={{ fontSize: 36 }}>Z</T></View>
        <T v="h1" color="#fff" style={{ marginTop: space(4) }}>Zen OS Delivery</T>
        <T v="body" color="rgba(255,255,255,0.85)" style={{ marginTop: 6 }}>Sign in with the phone number your restaurant registered</T>
      </View>
      <View style={{ padding: space(5), flex: 1 }}>
        {!apiUrl ? <Banner tone="wait" icon="warn" title="Server not set" body="Open settings and enter your restaurant's server address." /> : null}
        {err ? <Banner tone="bad" icon="warn" title={err} /> : null}
        <T v="tiny" color={t.text3}>PHONE NUMBER</T>
        <TextInput value={phone} onChangeText={setPhone} editable={!sent} keyboardType="phone-pad" placeholder="10-digit mobile number" placeholderTextColor={t.text3}
          autoComplete="tel" textContentType="telephoneNumber" maxLength={15}
          style={[s.input, { color: t.text, backgroundColor: t.surface, borderColor: t.line }]} accessibilityLabel="Phone number" />
        {sent && (
          <>
            <T v="tiny" color={t.text3} style={{ marginTop: space(4) }}>6-DIGIT CODE</T>
            <TextInput value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="••••••" placeholderTextColor={t.text3}
              autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} autoFocus
              style={[s.input, { color: t.text, backgroundColor: t.surface, borderColor: t.line, letterSpacing: 8, fontSize: 22, textAlign: 'center' }]} accessibilityLabel="One-time code" />
            {devOtp ? <T v="small" color={t.wait} style={{ marginTop: 6 }}>Test server code: {devOtp}</T> : null}
          </>
        )}
        <View style={{ marginTop: space(5) }}>
          {!sent
            ? <Button big title="Send code" icon="nav" onPress={send} loading={busy} disabled={clean.length < 10} />
            : <Button big title="Verify & sign in" icon="check" onPress={verify} loading={busy} disabled={otp.length !== 6} />}
          {sent && (
            <View style={[s.rowB, { marginTop: space(3) }]}>
              <Pressable onPress={() => { setSent(false); setOtp(''); setErr(''); }} hitSlop={12}><T v="small" color={t.brand}>Change number</T></Pressable>
              <Pressable onPress={wait > 0 ? undefined : send} hitSlop={12}><T v="small" color={wait > 0 ? t.text3 : t.brand}>{wait > 0 ? `Resend in ${wait}s` : 'Resend code'}</T></Pressable>
            </View>
          )}
        </View>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onOpenSettings} hitSlop={12} style={{ alignSelf: 'center', padding: space(2) }}>
          <T v="small" color={t.text3}>Server: {apiUrl || 'not set'} · v{BUILD.version} · Change</T>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  hero: { paddingTop: space(16), paddingBottom: space(8), paddingHorizontal: space(5), borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  mark: { width: 64, height: 64, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space(4), height: 54, fontSize: 17, fontWeight: '600', marginTop: 6 },
  rowB: { flexDirection: 'row', justifyContent: 'space-between' },
});
