// In-app map overview. Needs a Google Maps SDK key in the build (googleMapsKey);
// without one we don't render a broken grey map — we say so, and the
// "Navigate" buttons still hand off to the Google Maps app (no key needed).
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { BUILD } from '../native';
import { LatLng, isPoint } from '../geo';
import { radius, useTheme } from '../theme';
import { Banner } from '../ui';

export type MapStop = { id: string; point: LatLng; title: string; kind: 'restaurant' | 'drop'; n?: number };

export default function DeliveryMap({ stops, me, route, height = 260 }: { stops: MapStop[]; me: LatLng | null; route?: LatLng[] | null; height?: number }) {
  const t = useTheme();
  const ref = useRef<MapView>(null);
  const pts = [...stops.map((s) => s.point), ...(me ? [me] : [])].filter(isPoint);

  useEffect(() => {
    if (pts.length > 1) {ref.current?.fitToCoordinates(pts, { edgePadding: { top: 48, right: 48, bottom: 48, left: 48 }, animated: true });}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops.length, !!me]);

  if (!BUILD.mapsKeyConfigured) {
    return <Banner tone="info" icon="pin" title="Map view needs a Google Maps key" body="This build has no Maps SDK key. Use Navigate to open each stop in Google Maps." />;
  }
  if (!pts.length) {return null;}
  return (
    <View style={{ height, borderRadius: radius.lg, overflow: 'hidden', marginBottom: 12, borderWidth: 1, borderColor: t.line }}>
      <MapView ref={ref} provider={PROVIDER_GOOGLE} style={{ flex: 1 }} showsUserLocation={false} toolbarEnabled={false}
        initialRegion={{ ...pts[0], latitudeDelta: 0.05, longitudeDelta: 0.05 }} userInterfaceStyle={t.mode}>
        {stops.filter((s) => isPoint(s.point)).map((s) => (
          <Marker key={s.id} coordinate={s.point} title={s.title} pinColor={s.kind === 'restaurant' ? '#7C3AED' : '#E1460E'}
            description={s.n ? `Stop ${s.n}` : undefined} />
        ))}
        {me && <Marker coordinate={me} title="You" pinColor="#0E9F6E" />}
        {route && route.length > 1 && <Polyline coordinates={route} strokeColor={t.brand} strokeWidth={5} />}
      </MapView>
    </View>
  );
}
