// Full-screen "new delivery request" sheet over any screen, for the most
// urgent open offer. Accept/Reject go to the server; the first valid accept
// anywhere wins (atomic on the backend) — a loser sees "taken" here.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, View } from 'react-native';
import { ApiError } from '../api';
import { useStore } from '../store';
import { fmtKm } from '../geo';
import { radius, space, useTheme } from '../theme';
import { Button, IconBubble, Pill, T, styles } from '../ui';
import { Countdown } from './Home';

export default function OfferOverlay({ onAccepted }: { onAccepted: (jobId: string) => void }) {
  const t = useTheme();
  const { offers, accept, reject, dismissedOffers, dismissOffer, snapshot } = useStore();
  const offer = offers.find((o) => !dismissedOffers.has(o.jobId));
  const [busy, setBusy] = useState<'' | 'a' | 'r'>('');
  const [err, setErr] = useState('');
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setErr('');
    if (offer) { slide.setValue(0); Animated.spring(slide, { toValue: 1, useNativeDriver: true, friction: 8 }).start(); }
  }, [offer?.jobId, slide, offer]);

  if (!offer) {return null;}
  const full = !!snapshot && snapshot.state.activeCount >= snapshot.state.capacity;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => dismissOffer(offer.jobId)} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,8,20,0.55)', justifyContent: 'flex-end' }}>
        <Animated.View style={{ backgroundColor: t.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: space(5), paddingBottom: space(8),
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }] }} accessibilityViewIsModal>
          <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: t.line, alignSelf: 'center', marginBottom: space(4) }} />
          <View style={styles.rowB}>
            <View style={styles.row}><IconBubble name="bike" tone="brand" size={48} />
              <View style={{ marginLeft: 12 }}><T v="tiny" color={t.brand}>NEW DELIVERY REQUEST</T><T v="h1">#{offer.orderNo}</T></View>
            </View>
            {offer.cod ? <Pill label="CASH" tone="wait" /> : <Pill label="PREPAID" tone="go" />}
          </View>
          <View style={{ marginTop: space(5), padding: space(4), borderRadius: radius.lg, backgroundColor: t.surface2 }}>
            <View style={styles.row}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.brand }} /><T v="body" style={{ marginLeft: 10 }}>{offer.pickup?.name || 'Restaurant'}</T></View>
            <View style={{ width: 2, height: 18, backgroundColor: t.line, marginLeft: 4, marginVertical: 4 }} />
            <View style={styles.row}><View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: t.bad }} /><T v="body" style={{ marginLeft: 10 }}>Customer · {fmtKm(offer.distanceMeters)} away</T></View>
            <T v="small" color={t.text3} style={{ marginTop: 8 }}>Exact address and contact appear after you accept.</T>
          </View>
          <View style={{ marginTop: space(4) }}><Countdown until={offer.expiresAt} /></View>
          {full && <T v="small" color={t.wait} style={{ marginTop: 8 }}>You're at your delivery limit — finish one to accept more.</T>}
          {err ? <T v="small" color={t.bad} style={{ marginTop: 8 }}>{err}</T> : null}
          <View style={[styles.row, { gap: space(3), marginTop: space(5) }]}>
            <Button kind="ghost" title="Reject" style={{ flex: 1 }} loading={busy === 'r'} disabled={!!busy}
              onPress={async () => { setBusy('r'); await reject(offer.jobId); setBusy(''); }} />
            <Button big kind="go" title="Accept" icon="check" style={{ flex: 1.8 }} loading={busy === 'a'} disabled={!!busy || full}
              onPress={async () => {
                setErr(''); setBusy('a');
                try { const j = await accept(offer.jobId); onAccepted(j.jobId); }
                catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not accept'); setTimeout(() => dismissOffer(offer.jobId), 1800); }
                finally { setBusy(''); }
              }} />
          </View>
          <Button kind="ghost" title="Decide later" style={{ marginTop: space(3), borderWidth: 0 }} onPress={() => dismissOffer(offer.jobId)} />
        </Animated.View>
      </View>
    </Modal>
  );
}
