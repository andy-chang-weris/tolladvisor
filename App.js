import { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, SafeAreaView, Platform,
  StatusBar, KeyboardAvoidingView,
} from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

// Tell the OS to show notifications as a banner with sound when the app
// is open in the foreground (default behaviour suppresses them)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ── Colour tokens (mirrors the web CSS variables) ──────────────────────────
const C = {
  black:   '#0a0a0a',
  dark:    '#111318',
  panel:   '#181c24',
  border:  'rgba(255,255,255,0.07)',
  border2: 'rgba(255,255,255,0.12)',
  text:    '#e8eaf0',
  muted:   '#6b7280',
  green:   '#22c55e',
  greenD:  'rgba(34,197,94,0.12)',
  greenB:  'rgba(34,197,94,0.25)',
  amber:   '#f59e0b',
  amberD:  'rgba(245,158,11,0.12)',
  red:     '#ef4444',
  redD:    'rgba(239,68,68,0.10)',
  blue:    '#3b82f6',
  blueD:   'rgba(59,130,246,0.10)',
};

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function getTollCost(route) {
  const price = route.travelAdvisory?.tollInfo?.estimatedPrice?.[0];
  if (!price) return 0;
  return parseFloat(price.units || 0) + (price.nanos || 0) / 1e9;
}

function routeHasToll(route) {
  return (route.travelAdvisory?.tollInfo?.estimatedPrice?.length || 0) > 0;
}

// ── Notification helpers ───────────────────────────────────────────────────
async function requestNotificationPermission() {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function buildNotificationContent(verdict, destination) {
  const take = verdict.recommendation === 'TAKE_TOLL';
  const dest = destination.split(',')[0];
  const title = take ? '✓ Take the toll road' : '✕ Skip the toll';

  let body = verdict.reason;
  // Append the key stats so they're visible in the notification tray
  body += ` (${verdict.timeSavedMin} min saved · $${verdict.tollCost.toFixed(2)} toll)`;

  return { title, body };
}

async function sendVerdictNotification(verdict, destination) {
  const granted = await requestNotificationPermission();
  if (!granted) return false;

  const { title, body } = buildNotificationContent(verdict, destination);

  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: null, // null = fire immediately
  });

  return true;
}


async function snapToRoad(lat, lng, googleKey) {
  const url = `https://roads.googleapis.com/v1/snapToRoads?path=${lat},${lng}&interpolate=false&key=${googleKey}`;
  // No CORS issue in React Native — fetch works server-to-server style
  const res  = await fetch(url);
  const data = await res.json();
  if (data.error) {
    const status = data.error.status || '';
    if (status === 'PERMISSION_DENIED' || data.error.code === 403) throw new Error('ROADS_UNAVAILABLE');
    throw new Error(`${status || 'API error'}: ${data.error.message}`);
  }
  if (!data.snappedPoints || data.snappedPoints.length === 0) throw new Error('NO_ROAD');
  return data.snappedPoints[0];
}

async function getRoadViaGeocode(lat, lng, googleKey) {
  const url  = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleKey}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length)
    throw new Error('Could not identify road. Geocoding returned: ' + data.status);
  for (const result of data.results) {
    const route = result.address_components?.find(c => c.types.includes('route'));
    if (route) return { roadName: route.long_name, formatted: result.formatted_address };
  }
  return { roadName: 'Unknown road', formatted: data.results[0].formatted_address };
}

async function getRoutes(originLat, originLng, destination, googleKey) {
  const body = {
    origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
    destination: { address: destination },
    travelMode: 'DRIVE',
    computeAlternativeRoutes: true,
    routeModifiers: { vehicleInfo: { emissionType: 'GASOLINE' } },
    routingPreference: 'TRAFFIC_AWARE',
    extraComputations: ['TOLLS'],
  };
  const res  = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': googleKey,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.description,routes.travelAdvisory.tollInfo,routes.legs.steps.navigationInstruction,routes.routeLabels',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error('Routes API: ' + (data.error.message || JSON.stringify(data.error)));
  if (!data.routes || data.routes.length === 0) throw new Error('No routes found to that destination.');
  return data.routes;
}

function selectRoutes(routes) {
  const tollRoutes = routes.filter(routeHasToll);
  const freeRoutes = routes.filter(r => !routeHasToll(r));
  const tollRoute  = tollRoutes.length
    ? tollRoutes.sort((a, b) => getTollCost(a) - getTollCost(b) || parseInt(a.duration) - parseInt(b.duration))[0]
    : null;
  const freeRoute  = freeRoutes.length
    ? freeRoutes.sort((a, b) => parseInt(a.duration) - parseInt(b.duration))[0]
    : null;
  return { tollRoute, freeRoute, tollRoutes, freeRoutes };
}

function calculateVerdict(selected, minTimeSaved, maxToll) {
  let { tollRoute, freeRoute } = selected;
  if (!tollRoute && !freeRoute) return null;

  if (!tollRoute) {
    return {
      tollRoute: null, freeRoute,
      timeSavedMin: 0, tollCost: 0,
      recommendation: 'SKIP_TOLL',
      reason: `No toll routes available — the free route (${fmtDuration(parseInt(freeRoute.duration))}) is your only option.`,
    };
  }

  if (!freeRoute) {
    const others    = selected.tollRoutes.filter(r => r !== tollRoute);
    const altRoute  = others.length ? others.sort((a, b) => parseInt(a.duration) - parseInt(b.duration))[0] : null;
    const cheapCost = getTollCost(tollRoute);

    if (!altRoute) {
      return {
        tollRoute, freeRoute: null,
        timeSavedMin: 0, tollCost: cheapCost,
        recommendation: 'TAKE_TOLL',
        reason: `Every route to this destination has a toll. The only option is $${cheapCost.toFixed(2)} (${fmtDuration(parseInt(tollRoute.duration))}).`,
      };
    }

    const altCost      = getTollCost(altRoute);
    const cheapDurSec  = parseInt(tollRoute.duration);
    const altDurSec    = parseInt(altRoute.duration);
    const timeSavedMin = Math.round((cheapDurSec - altDurSec) / 60);
    const costDiff     = altCost - cheapCost;

    if (timeSavedMin <= 0) {
      return {
        tollRoute, freeRoute: altRoute,
        timeSavedMin: 0, tollCost: cheapCost,
        recommendation: 'TAKE_TOLL',
        reason: `Every route has a toll. The cheapest option ($${cheapCost.toFixed(2)}, ${fmtDuration(cheapDurSec)}) is also the fastest — take it.`,
      };
    }
    if (costDiff > 0 && timeSavedMin >= minTimeSaved) {
      return {
        tollRoute: altRoute, freeRoute: tollRoute,
        timeSavedMin, tollCost: altCost,
        recommendation: 'TAKE_TOLL',
        reason: `Every route has a toll. The faster route saves ${timeSavedMin} min for $${costDiff.toFixed(2)} more — worth it based on your time threshold.`,
      };
    }
    return {
      tollRoute, freeRoute: altRoute,
      timeSavedMin, tollCost: cheapCost,
      recommendation: 'TAKE_TOLL',
      reason: `Every route has a toll. The faster route only saves ${timeSavedMin} min for $${costDiff.toFixed(2)} more — take the cheaper option ($${cheapCost.toFixed(2)}).`,
    };
  }

  const tollDurSec   = parseInt(tollRoute.duration);
  const freeDurSec   = parseInt(freeRoute.duration);
  const timeSavedMin = Math.round((freeDurSec - tollDurSec) / 60);
  const tollCost     = getTollCost(tollRoute);
  let recommendation = 'SKIP_TOLL';
  let reason = '';

  if (timeSavedMin <= 0) {
    reason = `The toll route isn't faster (saves ${timeSavedMin} min) — no reason to pay $${tollCost.toFixed(2)}. Take the free route.`;
  } else if (tollCost > maxToll) {
    reason = `Toll cost ($${tollCost.toFixed(2)}) exceeds your maximum of $${maxToll.toFixed(2)}. Take the free route.`;
  } else if (timeSavedMin < minTimeSaved) {
    reason = `Only saves ${timeSavedMin} min for $${tollCost.toFixed(2)} — below your ${minTimeSaved}-min threshold. Take the free route.`;
  } else {
      recommendation = 'TAKE_TOLL';
      reason = `Saves ${timeSavedMin} min for $${tollCost.toFixed(2)} — worth it based on your preferences. Take the toll road.`;
  }

  return { tollRoute, freeRoute, timeSavedMin, tollCost, recommendation, reason };
}

// ── Small reusable UI pieces ───────────────────────────────────────────────
function Label({ children }) {
  return <Text style={s.label}>{children}</Text>;
}

function FieldInput({ value, onChangeText, placeholder, secureTextEntry, keyboardType, editable = true }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[s.input, focused && s.inputFocused, !editable && s.inputDisabled]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={C.muted}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      editable={editable}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

function CardTitle({ children }) {
  return <Text style={s.cardTitle}>{children}</Text>;
}

// Step pill badge
function StepPill({ state }) {
  const color = state === 'running' ? C.amber : state === 'done' ? C.green : state === 'error' ? C.red : C.muted;
  const border = state === 'running' ? 'rgba(245,158,11,0.3)' : state === 'done' ? 'rgba(34,197,94,0.3)' : state === 'error' ? 'rgba(239,68,68,0.3)' : C.border;
  return (
    <View style={[s.pill, { borderColor: border }]}>
      {state === 'running'
        ? <ActivityIndicator size={10} color={C.amber} />
        : <Text style={[s.pillText, { color }]}>{state}</Text>
      }
    </View>
  );
}

// Individual pipeline step card
function StepCard({ num, title, state, children }) {
  const borderColor = state === 'running' ? 'rgba(59,130,246,0.5)' : state === 'done' ? 'rgba(34,197,94,0.4)' : state === 'error' ? 'rgba(239,68,68,0.4)' : C.border;
  return (
    <View style={[s.step, { borderColor }]}>
      <View style={s.stepRow}>
        <View style={s.stepIcon}><Text style={s.stepIconText}>{String(num).padStart(2, '0')}</Text></View>
        <Text style={s.stepTitle}>{title}</Text>
        <StepPill state={state} />
      </View>
      {(state === 'running' || state === 'done' || state === 'error') && children
        ? <View style={s.stepBody}>{children}</View>
        : null}
    </View>
  );
}

function Connector() {
  return <View style={s.connector} />;
}

// Route card shown inside step 2
function RouteCard({ route, isToll, isAlt }) {
  const cost   = getTollCost(route);
  const distKm = (route.distanceMeters / 1000).toFixed(1);
  const label  = isToll ? (isAlt ? 'TOLL ROUTE (ALT)' : 'TOLL ROUTE') : 'FREE ROUTE';
  const bg     = isToll ? C.amberD : C.blueD;
  const border = isToll ? 'rgba(245,158,11,0.25)' : 'rgba(59,130,246,0.25)';
  const typeColor = isToll ? C.amber : C.blue;

  return (
    <View style={[s.routeCard, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[s.routeType, { color: typeColor }]}>{label}</Text>
      <Text style={s.routeName}>{route.description ?? 'Route'}</Text>
      <View style={s.routeStat}>
        <Text style={s.routeStatLabel}>Duration</Text>
        <Text style={s.routeStatValue}>{fmtDuration(parseInt(route.duration))}</Text>
      </View>
      <View style={s.routeStat}>
        <Text style={s.routeStatLabel}>Distance</Text>
        <Text style={s.routeStatValue}>{distKm} km</Text>
      </View>
      <View style={[s.routeStat, s.routeStatLast]}>
        <Text style={s.routeStatLabel}>Toll cost</Text>
        <Text style={s.routeStatValue}>{isToll ? `$${cost.toFixed(2)}` : 'Free'}</Text>
      </View>
    </View>
  );
}

// Verdict card shown inside step 3
function VerdictCard({ verdict }) {
  const take = verdict.recommendation === 'TAKE_TOLL';
  const bg     = take ? C.greenD : C.blueD;
  const border = take ? C.greenB : 'rgba(59,130,246,0.25)';
  const accentColor = take ? C.green : C.blue;

  return (
    <View style={[s.verdictCard, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[s.verdictLabel, { color: accentColor }]}>
        {take ? '✓ TAKE THE TOLL ROAD' : '✕ SKIP THE TOLL'}
      </Text>
      <Text style={s.verdictText}>{verdict.reason}</Text>
      <View style={s.verdictStats}>
        <View style={s.verdictStat}>
          <Text style={[s.verdictStatNum, { color: accentColor }]}>{verdict.timeSavedMin}m</Text>
          <Text style={s.verdictStatLabel}>TIME SAVED</Text>
        </View>
        <View style={s.verdictStat}>
          <Text style={[s.verdictStatNum, { color: C.amber }]}>${verdict.tollCost.toFixed(2)}</Text>
          <Text style={s.verdictStatLabel}>TOLL COST</Text>
        </View>
        <View style={s.verdictStat}>
          <Text style={[s.verdictStatNum, { color: C.text }]}>
            {verdict.tollCost > 0 ? (verdict.timeSavedMin / verdict.tollCost).toFixed(1) : '—'}
          </Text>
          <Text style={s.verdictStatLabel}>MINS / $</Text>
        </View>
      </View>
    </View>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  // Form state
  const [googleKey,    setGoogleKey]    = useState('');
  const [destination,  setDestination]  = useState('');
  const [minTimeSaved, setMinTimeSaved] = useState('10');
  const [maxToll,      setMaxToll]      = useState('5');

  // Location state
  const [locationText, setLocationText] = useState('Tap to detect location');
  const [currentLat,   setCurrentLat]   = useState(null);
  const [currentLng,   setCurrentLng]   = useState(null);

  // Pipeline state
  const [analysing,        setAnalysing]        = useState(false);
  const [stepStates,       setStepStates]       = useState({ 1: 'waiting', 2: 'waiting', 3: 'waiting' });
  const [roadInfo,         setRoadInfo]         = useState(null);
  const [displayList,      setDisplayList]      = useState([]);
  const [noFreeRoute,      setNoFreeRoute]      = useState(false);
  const [verdict,          setVerdict]          = useState(null);
  const [notificationSent, setNotificationSent] = useState(false);
  const [error,            setError]            = useState('');

  const setStep = useCallback((n, state) => {
    setStepStates(prev => ({ ...prev, [n]: state }));
  }, []);

  // Auto-detect location on mount
  useEffect(() => { detectLocation(); }, []);

  async function detectLocation() {
    setLocationText('Detecting...');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationText('Location permission denied');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCurrentLat(pos.coords.latitude);
      setCurrentLng(pos.coords.longitude);
      setLocationText(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
    } catch {
      setLocationText('Could not detect location');
    }
  }

  function resetAll() {
    setStepStates({ 1: 'waiting', 2: 'waiting', 3: 'waiting' });
    setRoadInfo(null);
    setDisplayList([]);
    setNoFreeRoute(false);
    setVerdict(null);
    setNotificationSent(false);
    setError('');
  }

  async function runAnalysis() {
    setError('');
    if (!googleKey)   { setError('Google API key is required.'); return; }
    if (!destination) { setError('Please enter a destination address.'); return; }
    if (!currentLat)  { setError('Please detect your location first.'); return; }

    setAnalysing(true);
    resetAll();

    const minTimeSavedNum = parseInt(minTimeSaved) || 10;
    const maxTollNum      = parseFloat(maxToll) || 5;

    // ── Step 1 ──
    setStep(1, 'running');
    try {
      let info;
      try {
        const snapped = await snapToRoad(currentLat, currentLng, googleKey);
        const named   = await getRoadViaGeocode(snapped.location.latitude, snapped.location.longitude, googleKey);
        info = { roadName: named.roadName, formatted: named.formatted, method: 'Roads API + Geocoding' };
      } catch (roadsErr) {
        if (['ROADS_UNAVAILABLE', 'NO_ROAD'].includes(roadsErr.message)) {
          const named = await getRoadViaGeocode(currentLat, currentLng, googleKey);
          info = { roadName: named.roadName, formatted: named.formatted, method: 'Geocoding fallback' };
        } else {
          throw roadsErr;
        }
      }
      setRoadInfo(info);
      setStep(1, 'done');
    } catch (err) {
      setStep(1, 'error');
      setError('Step 1 — ' + err.message);
      setAnalysing(false);
      return;
    }

    // ── Step 2 ──
    setStep(2, 'running');
    let selectedRoutes;
    try {
      const routes  = await getRoutes(currentLat, currentLng, destination, googleKey);
      selectedRoutes = selectRoutes(routes);

      const list = [];
      if (selectedRoutes.tollRoute) list.push({ route: selectedRoutes.tollRoute, isToll: true });
      if (selectedRoutes.freeRoute) list.push({ route: selectedRoutes.freeRoute, isToll: false });

      if (!selectedRoutes.freeRoute && selectedRoutes.tollRoutes.length > 1) {
        const secondToll = selectedRoutes.tollRoutes
          .filter(r => r !== selectedRoutes.tollRoute)
          .sort((a, b) => parseInt(a.duration) - parseInt(b.duration))[0];
        if (secondToll) list.push({ route: secondToll, isToll: true, isAlt: true });
      }

      if (list.length === 0) throw new Error('No usable routes returned.');

      setDisplayList(list);
      setNoFreeRoute(!selectedRoutes.freeRoute);
      setStep(2, 'done');
    } catch (err) {
      setStep(2, 'error');
      setError('Step 2 — ' + err.message);
      setAnalysing(false);
      return;
    }

    // ── Step 3 ──
    setStep(3, 'running');
    const v = calculateVerdict(selectedRoutes, minTimeSavedNum, maxTollNum);
    if (!v) {
      setStep(3, 'error');
      setError('Step 3 — could not determine routes.');
      setAnalysing(false);
      return;
    }
    setVerdict(v);
    setStep(3, 'done');

    // Fire the verdict as a local notification
    const sent = await sendVerdictNotification(v, destination);
    setNotificationSent(sent);

    setAnalysing(false);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.dark} />

      {/* Top bar */}
      <View style={s.topbar}>
        <View style={s.logoDot} />
        <Text style={s.logoText}>TOLL ADVISOR</Text>
        <Text style={s.logoSub}>AI ROUTE INTELLIGENCE</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={s.scroll} contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

          {/* API Key */}
          <Card>
            <CardTitle>API Keys</CardTitle>
            <Label>Google API Key</Label>
            <FieldInput
              value={googleKey}
              onChangeText={setGoogleKey}
              placeholder="AIza..."
              secureTextEntry
            />
          </Card>

          {/* Driver Profile */}
          <Card>
            <CardTitle>Driver Profile</CardTitle>
            <View style={s.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Label>Min time saved (mins)</Label>
                <FieldInput
                  value={minTimeSaved}
                  onChangeText={setMinTimeSaved}
                  keyboardType="numeric"
                  placeholder="10"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Label>Max toll ($)</Label>
                <FieldInput
                  value={maxToll}
                  onChangeText={setMaxToll}
                  keyboardType="numeric"
                  placeholder="5"
                />
              </View>
            </View>
          </Card>

          {/* Journey */}
          <Card>
            <CardTitle>Journey</CardTitle>
            <Label>Current location</Label>
            <FieldInput value={locationText} editable={false} />
            <TouchableOpacity style={s.ghostBtn} onPress={detectLocation} activeOpacity={0.7}>
              <Text style={s.ghostBtnText}>⟳ Detect my location</Text>
            </TouchableOpacity>
            <Label>Destination address</Label>
            <FieldInput
              value={destination}
              onChangeText={setDestination}
              placeholder="e.g. 1600 Pennsylvania Ave, Washington DC"
            />
          </Card>

          {/* Pipeline */}
          <Text style={s.sectionLabel}>Analysis Pipeline</Text>

          <StepCard num={1} title="Identify current road" state={stepStates[1]}>
            {roadInfo && (
              <View>
                <View style={s.roadBadge}>
                  <View style={s.roadDot} />
                  <Text style={s.roadBadgeText}>{roadInfo.roadName}</Text>
                </View>
                <Text style={s.roadFormatted}>{roadInfo.formatted}</Text>
                <Text style={s.roadMethod}>via {roadInfo.method}</Text>
              </View>
            )}
          </StepCard>

          <Connector />

          <StepCard num={2} title="Fetch toll vs free routes" state={stepStates[2]}>
            <View style={s.routesGrid}>
              {displayList.map(({ route, isToll, isAlt }, i) => (
                <RouteCard key={i} route={route} isToll={isToll} isAlt={isAlt} />
              ))}
            </View>
            {noFreeRoute && (
              <Text style={s.noFreeNote}>No toll-free route exists — comparing toll options.</Text>
            )}
          </StepCard>

          <Connector />

          <StepCard num={3} title="Calculate cost efficiency verdict" state={stepStates[3]}>
            {verdict && <VerdictCard verdict={verdict} />}
          </StepCard>

          {/* Notification status */}
          {notificationSent && (
            <View style={s.notifBar}>
              <Text style={s.notifText}>🔔 Verdict sent as notification</Text>
            </View>
          )}

          {/* Error bar */}
          {error ? (
            <View style={s.errorBar}>
              <Text style={s.errorText}>⚠ {error}</Text>
            </View>
          ) : null}

          {/* Buttons */}
          <View style={s.btnRow}>
            <TouchableOpacity
              style={[s.primaryBtn, analysing && s.btnDisabled]}
              onPress={runAnalysis}
              disabled={analysing}
              activeOpacity={0.8}
            >
              {analysing
                ? <ActivityIndicator color={C.green} size="small" />
                : <Text style={s.primaryBtnText}>→ Analyse route</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={s.ghostBtn} onPress={resetAll} activeOpacity={0.7}>
              <Text style={s.ghostBtnText}>Reset</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: C.dark },
  scroll:     { flex: 1, backgroundColor: C.black },
  container:  { padding: 16, paddingBottom: 60 },

  // Top bar
  topbar:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.dark },
  logoDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: C.green },
  logoText:   { fontSize: 13, fontWeight: '700', color: C.text, letterSpacing: 1 },
  logoSub:    { marginLeft: 'auto', fontSize: 9, color: C.muted, letterSpacing: 1.5 },

  // Cards
  card:       { backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle:  { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 12 },

  // Labels & inputs
  label:      { fontSize: 10, color: C.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5, marginTop: 10 },
  input:      { backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: C.border2, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9, color: C.text, fontSize: 13 },
  inputFocused: { borderColor: C.green },
  inputDisabled: { color: C.muted },
  row:        { flexDirection: 'row', marginTop: 4 },

  // Section label
  sectionLabel: { fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10, marginTop: 4 },

  // Pipeline step
  step:       { backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14 },
  stepRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepIcon:   { width: 28, height: 28, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  stepIconText: { fontSize: 11, fontWeight: '700', color: C.muted },
  stepTitle:  { fontSize: 13, fontWeight: '500', color: C.text, flex: 1 },
  stepBody:   { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  pill:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: C.border },
  pillText:   { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  connector:  { width: 1, height: 18, backgroundColor: C.border, alignSelf: 'center', marginVertical: 2 },

  // Road badge
  roadBadge:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: C.border2, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', marginBottom: 6 },
  roadDot:        { width: 7, height: 7, borderRadius: 4, backgroundColor: C.green },
  roadBadgeText:  { fontSize: 12, color: C.text },
  roadFormatted:  { fontSize: 12, color: C.muted, marginTop: 2 },
  roadMethod:     { fontSize: 10, color: C.muted, opacity: 0.7, marginTop: 3 },

  // Route cards
  routesGrid:     { flexDirection: 'row', gap: 8 },
  routeCard:      { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10 },
  routeType:      { fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  routeName:      { fontSize: 12, fontWeight: '600', color: C.text, marginBottom: 8, lineHeight: 16 },
  routeStat:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.border },
  routeStatLast:  { borderBottomWidth: 0 },
  routeStatLabel: { fontSize: 11, color: C.muted },
  routeStatValue: { fontSize: 11, color: C.text, fontWeight: '500' },
  noFreeNote:     { fontSize: 11, color: C.amber, marginTop: 8 },

  // Verdict card
  verdictCard:      { borderWidth: 1, borderRadius: 10, padding: 14 },
  verdictLabel:     { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  verdictText:      { fontSize: 13, color: C.text, lineHeight: 20, marginBottom: 12 },
  verdictStats:     { flexDirection: 'row', gap: 6 },
  verdictStat:      { flex: 1, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 6, paddingVertical: 8 },
  verdictStatNum:   { fontSize: 20, fontWeight: '700' },
  verdictStatLabel: { fontSize: 9, color: C.muted, letterSpacing: 1, marginTop: 2 },

  // Notification status
  notifBar:  { backgroundColor: C.greenD, borderWidth: 1, borderColor: C.greenB, borderRadius: 8, padding: 10, marginTop: 10, alignItems: 'center' },
  notifText: { fontSize: 12, color: C.green },

  // Error
  errorBar:   { backgroundColor: C.redD, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 8, padding: 12, marginTop: 12 },
  errorText:  { fontSize: 13, color: '#fca5a5' },

  // Buttons
  btnRow:       { flexDirection: 'row', gap: 10, marginTop: 20, justifyContent: 'center' },
  primaryBtn:   { backgroundColor: C.greenD, borderWidth: 1, borderColor: 'rgba(34,197,94,0.4)', borderRadius: 8, paddingHorizontal: 24, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minWidth: 140 },
  primaryBtnText: { color: C.green, fontSize: 13, fontWeight: '600' },
  ghostBtn:     { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border2, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { color: C.muted, fontSize: 13 },
  btnDisabled:  { opacity: 0.35 },
});