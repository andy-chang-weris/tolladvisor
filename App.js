import { useState, useCallback, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, SafeAreaView, Platform,
  StatusBar, KeyboardAvoidingView, Modal, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import {
  URGENCY_OPTIONS,
  fmtDuration,
  getTollCost,
  selectRoutes,
  calculateVerdict,
  decodePolyline,
  getDecisionPoint,
} from './src/tollLogic';

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY ?? '';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const GEOFENCE_TASK = 'TOLL_DECISION_POINT';

let _tripContext = null;

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) { console.warn('Geofence task error:', error.message); return; }
  if (!data) return;
  const { eventType } = data;
  if (eventType !== Location.GeofencingEventType.Enter) return;
  if (!_tripContext) return;

  const { destination, minTimeSaved, maxToll, annualSalary, urgencyLevel } = _tripContext;
  try {
    const pos      = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const routes   = await getRoutes(pos.coords.latitude, pos.coords.longitude, destination, GOOGLE_API_KEY);
    const selected = selectRoutes(routes);
    const verdict  = calculateVerdict(selected, minTimeSaved, maxToll, annualSalary, urgencyLevel);
    if (!verdict) return;
    const { title, body } = buildNotificationContent(verdict, destination);
    await Notifications.scheduleNotificationAsync({
      content: { title: '📍 Decision point ahead: ' + title, body, sound: true },
      trigger: null,
    });
  } catch (err) {
    console.warn('Geofence background fetch failed:', err.message);
  }
});

const COLORS = {
  dark: {
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
  },
  light: {
    black:   '#f4f5f7',
    dark:    '#ffffff',
    panel:   '#ffffff',
    border:  'rgba(0,0,0,0.08)',
    border2: 'rgba(0,0,0,0.16)',
    text:    '#111318',
    muted:   '#6b7280',
    green:   '#16a34a',
    greenD:  'rgba(22,163,74,0.10)',
    greenB:  'rgba(22,163,74,0.25)',
    amber:   '#b45309',
    amberD:  'rgba(180,83,9,0.10)',
    red:     '#dc2626',
    redD:    'rgba(220,38,38,0.08)',
    blue:    '#2563eb',
    blueD:   'rgba(37,99,235,0.08)',
  },
};

const ThemeContext = createContext({ theme: 'dark', C: COLORS.dark, s: makeStyles(COLORS.dark) });
function useTheme() { return useContext(ThemeContext); }

async function requestNotificationPermission() {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function buildNotificationContent(verdict, destination) {
  const take  = verdict.recommendation === 'TAKE_TOLL';
  const title = take ? '✓ Take the toll road' : '✕ Skip the toll';
  const body  = verdict.reason + ` (${verdict.timeSavedMin} min saved · $${verdict.tollCost.toFixed(2)} toll)`;
  return { title, body };
}

async function sendVerdictNotification(verdict, destination) {
  const granted = await requestNotificationPermission();
  if (!granted) return false;
  const { title, body } = buildNotificationContent(verdict, destination);
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: null,
  });
  return true;
}

async function snapToRoad(lat, lng, googleKey) {
  const url  = `https://roads.googleapis.com/v1/snapToRoads?path=${lat},${lng}&interpolate=false&key=${googleKey}`;
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

async function geocodeAddress(address, googleKey) {
  const url  = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length)
    throw new Error('Could not find that address. Try being more specific.');
  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

async function getRoutes(originLat, originLng, destination, googleKey) {
  const baseRouteModifiers = {
    vehicleInfo: { emissionType: 'GASOLINE' },
  };

  const baseBody = {
    origin:      { location: { latLng: { latitude: originLat, longitude: originLng } } },
    destination: { address: destination },
    travelMode:  'DRIVE',
    computeAlternativeRoutes: false,
    routeModifiers: baseRouteModifiers,
    routingPreference: 'TRAFFIC_AWARE',
    extraComputations: ['TOLLS'],
  };

  const headers = {
    'Content-Type':      'application/json',
    'X-Goog-Api-Key':    googleKey,
    'X-Goog-FieldMask':  'routes.duration,routes.distanceMeters,routes.description,routes.travelAdvisory.tollInfo,routes.legs.steps.startLocation,routes.legs.steps.navigationInstruction,routes.routeLabels,routes.polyline.encodedPolyline',
  };

  const [tollRes, freeRes] = await Promise.all([
    fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', headers,
      body: JSON.stringify(baseBody),
    }),
    fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', headers,
      body: JSON.stringify({
        ...baseBody,
        routeModifiers: { ...baseRouteModifiers, avoidTolls: true },
      }),
    }),
  ]);

  const [tollData, freeData] = await Promise.all([tollRes.json(), freeRes.json()]);

  if (tollData.error) throw new Error('Routes API: ' + (tollData.error.message || JSON.stringify(tollData.error)));

  const routes = [];
  if (tollData.routes?.length) routes.push(...tollData.routes);

  if (freeData.routes?.length) {
    routes.push(freeData.routes[0]);
  }

  if (routes.length === 0) throw new Error('No routes found to that destination.');
  return routes;
}

function Label({ children }) {
  const { s } = useTheme();
  return <Text style={s.label}>{children}</Text>;
}

function FieldInput({ value, onChangeText, placeholder, secureTextEntry, keyboardType, editable = true, onFocus, onBlur }) {
  const { C, s } = useTheme();
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
      onFocus={() => { setFocused(true); onFocus && onFocus(); }}
      onBlur={() => { setFocused(false); onBlur && onBlur(); }}
    />
  );
}

function Card({ children, style }) {
  const { s } = useTheme();
  return <View style={[s.card, style]}>{children}</View>;
}

function CardTitle({ children }) {
  const { s } = useTheme();
  return <Text style={s.cardTitle}>{children}</Text>;
}

// ── AddressInput ─────────────────────────────────────────────────────────
// A text field for a location/destination address, plus a dropdown of
// recently-used addresses that opens when the field is tapped (focused) and
// closes when the user taps away or picks one. The blur handler waits a beat
// before closing the list — otherwise the field loses focus and hides the
// dropdown a moment before a chip's own tap has a chance to register, which
// on some devices cancels the tap entirely.
const BLUR_CLOSE_DELAY_MS = 150;

function AddressInput({ value, onChangeText, placeholder, recents, onSelectRecent, onRemoveRecent, rightSlot }) {
  const { s } = useTheme();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);

  function handleFocus() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  }

  function handleBlur() {
    closeTimer.current = setTimeout(() => setOpen(false), BLUR_CLOSE_DELAY_MS);
  }

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const showRecents = open && recents && recents.length > 0;

  return (
    <View>
      <View style={s.locRow}>
        <View style={{ flex: 1 }}>
          <FieldInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </View>
        {rightSlot}
      </View>
      {showRecents && (
        <View style={s.recentsWrap}>
          <Text style={s.recentsLabel}>Recent</Text>
          {recents.map((addr, i) => (
            <View key={i} style={s.recentChip}>
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => { onSelectRecent(addr); setOpen(false); }}
                activeOpacity={0.7}
              >
                <Text style={s.recentChipText} numberOfLines={1}>{addr}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onRemoveRecent(addr)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={s.recentChipRemove}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function UrgencyPicker({ value, onChange }) {
  const { s } = useTheme();
  const current = URGENCY_OPTIONS.find(o => o.value === value) ?? URGENCY_OPTIONS[1];
  return (
    <View>
      <View style={{ marginBottom: 2 }}>
        <Text style={s.toggleLabel}>Trip urgency</Text>
        <Text style={s.toggleSub}>
          {`${current.description} — weighs your time saved ${current.weight}x`}
        </Text>
      </View>
      <View style={s.passGrid}>
        {URGENCY_OPTIONS.map(opt => {
          const active = opt.value === value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[s.passChip, active && s.passChipActive]}
              onPress={() => onChange(opt.value)}
              activeOpacity={0.7}
            >
              <Text style={[s.passChipText, active && s.passChipTextActive]}>
                {opt.label}
              </Text>
              {active && (
                <Text style={[s.passChipSub, s.passChipTextActive]}>
                  {opt.description}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function StepPill({ state }) {
  const { C, s } = useTheme();
  const color  = state === 'running' ? C.amber : state === 'done' ? C.green : state === 'error' ? C.red : C.muted;
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

function StepCard({ num, title, state, children }) {
  const { C, s } = useTheme();
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
  const { s } = useTheme();
  return <View style={s.connector} />;
}

function RouteCard({ route, isToll, isAlt }) {
  const { C, s } = useTheme();
  const cost      = getTollCost(route);
  const distKm    = (route.distanceMeters / 1000).toFixed(1);
  const label     = isToll ? (isAlt ? 'TOLL ROUTE (ALT)' : 'TOLL ROUTE') : 'FREE ROUTE';
  const bg        = isToll ? C.amberD : C.blueD;
  const border    = isToll ? 'rgba(245,158,11,0.25)' : 'rgba(59,130,246,0.25)';
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

function VerdictCard({ verdict }) {
  const { C, s } = useTheme();
  const take        = verdict.recommendation === 'TAKE_TOLL';
  const bg          = take ? C.greenD : C.blueD;
  const border      = take ? C.greenB : 'rgba(59,130,246,0.25)';
  const accentColor = take ? C.green  : C.blue;
  const delta       = (verdict.worthToPay ?? 0) - verdict.tollCost;
  const deltaColor  = delta >= 0 ? C.green : C.red;
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
          <Text style={[s.verdictStatNum, { color: deltaColor }]}>
            {delta >= 0 ? '+' : ''}${delta.toFixed(2)}
          </Text>
          <Text style={s.verdictStatLabel}>VALUE DELTA</Text>
        </View>
      </View>
    </View>
  );
}

export default function App() {
  const [destination,      setDestination]      = useState('');
  const [minTimeSaved,     setMinTimeSaved]     = useState('10');
  const [maxToll,          setMaxToll]          = useState('10');
  const [annualSalary,     setAnnualSalary]     = useState('');
  const [urgencyLevel,     setUrgencyLevel]     = useState('med');

  const [locationText,     setLocationText]     = useState('');
  const [locationMode,     setLocationMode]     = useState('manual');
  const [currentLat,       setCurrentLat]       = useState(null);
  const [currentLng,       setCurrentLng]       = useState(null);

  const [analysing,        setAnalysing]        = useState(false);
  const [stepStates,       setStepStates]       = useState({ 1: 'waiting', 2: 'waiting', 3: 'waiting' });
  const [roadInfo,         setRoadInfo]         = useState(null);
  const [displayList,      setDisplayList]      = useState([]);
  const [noFreeRoute,      setNoFreeRoute]      = useState(false);
  const [verdict,          setVerdict]          = useState(null);
  const [notificationSent, setNotificationSent] = useState(false);
  const [geofenceArmed,    setGeofenceArmed]    = useState(false);
  const [error,            setError]            = useState('');
  const [settingsOpen,     setSettingsOpen]     = useState(false);
  const [theme,            setTheme]            = useState('dark');
  const [recentLocations,    setRecentLocations]    = useState([]);
  const [recentDestinations, setRecentDestinations] = useState([]);

  const C = COLORS[theme];
  const s = useMemo(() => makeStyles(C), [theme]);

  const setStep = useCallback((n, state) => {
    setStepStates(prev => ({ ...prev, [n]: state }));
  }, []);

  const pipelineStarted = stepStates[1] !== 'waiting';
  const allStepsDone     = stepStates[1] === 'done' && stepStates[2] === 'done' && stepStates[3] === 'done';

  useEffect(() => {
    async function requestStartupPermissions() {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus === 'granted') {
        await Location.requestBackgroundPermissionsAsync();
      }
      await Notifications.requestPermissionsAsync();
    }
    requestStartupPermissions();
  }, []);

  useEffect(() => {
    async function loadSettings() {
      try {
        const saved = await AsyncStorage.getItem('settings');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.minTimeSaved)   setMinTimeSaved(parsed.minTimeSaved);
          if (parsed.maxToll)        setMaxToll(parsed.maxToll);
          if (parsed.annualSalary)   setAnnualSalary(parsed.annualSalary);
          if (parsed.urgencyLevel)   setUrgencyLevel(parsed.urgencyLevel);
        }
        const savedTheme = await AsyncStorage.getItem('theme');
        if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);

        const savedLocations = await AsyncStorage.getItem('recentLocations');
        if (savedLocations) setRecentLocations(JSON.parse(savedLocations));
        const savedDestinations = await AsyncStorage.getItem('recentDestinations');
        if (savedDestinations) setRecentDestinations(JSON.parse(savedDestinations));
      } catch {}
    }
    loadSettings();
  }, []);

  // ── Recent address helpers ─────────────────────────────────────────────
  // Case-insensitive de-dupe, most-recent-first, capped list. Persisted to
  // AsyncStorage separately for locations vs destinations so the two lists
  // don't mix (a "from" address and a "to" address are rarely interchangeable).
  const RECENTS_MAX = 6;

  function upsertRecent(list, entry) {
    const trimmed = (entry || '').trim();
    if (!trimmed) return list;
    const filtered = list.filter(item => item.toLowerCase() !== trimmed.toLowerCase());
    return [trimmed, ...filtered].slice(0, RECENTS_MAX);
  }

  function pushRecentLocation(addr) {
    setRecentLocations(prev => {
      const next = upsertRecent(prev, addr);
      AsyncStorage.setItem('recentLocations', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function pushRecentDestination(addr) {
    setRecentDestinations(prev => {
      const next = upsertRecent(prev, addr);
      AsyncStorage.setItem('recentDestinations', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function removeRecentLocation(addr) {
    setRecentLocations(prev => {
      const next = prev.filter(a => a !== addr);
      AsyncStorage.setItem('recentLocations', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function removeRecentDestination(addr) {
    setRecentDestinations(prev => {
      const next = prev.filter(a => a !== addr);
      AsyncStorage.setItem('recentDestinations', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  useEffect(() => {
    AsyncStorage.setItem('settings', JSON.stringify({
      minTimeSaved, maxToll, annualSalary, urgencyLevel,
    })).catch(() => {});
  }, [minTimeSaved, maxToll, annualSalary, urgencyLevel]);

  useEffect(() => {
    AsyncStorage.setItem('theme', theme).catch(() => {});
  }, [theme]);

  async function detectLocation() {
    setLocationText('Detecting...');
    setLocationMode('detected');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationText('Location permission denied');
        setLocationMode('manual');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setCurrentLat(lat);
      setCurrentLng(lng);
      if (GOOGLE_API_KEY) {
        try {
          const named = await getRoadViaGeocode(lat, lng, GOOGLE_API_KEY);
          setLocationText(named.formatted);
        } catch {
          setLocationText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        }
      } else {
        setLocationText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    } catch {
      setLocationText('Could not detect location');
      setLocationMode('manual');
    }
  }

  function resetAll() {
    setStepStates({ 1: 'waiting', 2: 'waiting', 3: 'waiting' });
    setRoadInfo(null);
    setDisplayList([]);
    setNoFreeRoute(false);
    setVerdict(null);
    setNotificationSent(false);
    setGeofenceArmed(false);
    setError('');
    _tripContext = null;
    Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
  }

  async function runAnalysis() {
    setError('');
    if (!GOOGLE_API_KEY)      { setError('Google API key is not configured. Set EXPO_PUBLIC_GOOGLE_API_KEY in .env and rebuild.'); return; }
    if (!destination)         { setError('Please enter a destination address.'); return; }
    if (!locationText.trim()) { setError('Please enter or detect a starting location.'); return; }

    setAnalysing(true);
    resetAll();

    const minTimeSavedNum = parseInt(minTimeSaved) || 10;
    const maxTollNum      = parseFloat(maxToll) || 10;
    const annualSalaryNum = parseFloat(annualSalary) || 0;

    let originLat = currentLat;
    let originLng = currentLng;
    if (locationMode === 'manual' || !originLat) {
      try {
        const geocoded = await geocodeAddress(locationText, GOOGLE_API_KEY);
        originLat = geocoded.lat;
        originLng = geocoded.lng;
        setCurrentLat(originLat);
        setCurrentLng(originLng);
      } catch (err) {
        setError(err.message);
        setAnalysing(false);
        return;
      }
    }

    setStep(1, 'running');
    try {
      let info;
      try {
        const snapped = await snapToRoad(originLat, originLng, GOOGLE_API_KEY);
        const named   = await getRoadViaGeocode(snapped.location.latitude, snapped.location.longitude, GOOGLE_API_KEY);
        info = { roadName: named.roadName, formatted: named.formatted, method: 'Roads API + Geocoding' };
      } catch (roadsErr) {
        if (['ROADS_UNAVAILABLE', 'NO_ROAD'].includes(roadsErr.message)) {
          const named = await getRoadViaGeocode(originLat, originLng, GOOGLE_API_KEY);
          info = { roadName: named.roadName, formatted: named.formatted, method: 'Geocoding fallback' };
        } else {
          throw roadsErr;
        }
      }
      setRoadInfo(info);
      setStep(1, 'done');
    } catch (err) {
      setStep(1, 'error');
      setError('Step 1: ' + err.message);
      setAnalysing(false);
      return;
    }

    setStep(2, 'running');
    let selectedRoutes;
    try {
      const routes = await getRoutes(originLat, originLng, destination, GOOGLE_API_KEY);
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

      pushRecentLocation(locationText);
      pushRecentDestination(destination);
    } catch (err) {
      setStep(2, 'error');
      setError('Step 2: ' + err.message);
      setAnalysing(false);
      return;
    }

    setStep(3, 'running');
    const v = calculateVerdict(selectedRoutes, minTimeSavedNum, maxTollNum, annualSalaryNum, urgencyLevel);
    if (!v) {
      setStep(3, 'error');
      setError('Step 3: could not determine routes.');
      setAnalysing(false);
      return;
    }
    setVerdict(v);
    setStep(3, 'done');

    const sent = await sendVerdictNotification(v, destination);
    setNotificationSent(sent);

    _tripContext = {
      destination,
      minTimeSaved: minTimeSavedNum, maxToll: maxTollNum,
      annualSalary: annualSalaryNum, urgencyLevel,
    };

    try {
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus === 'granted') {
        const decisionPt = getDecisionPoint(v.tollRoute, v.freeRoute, originLat, originLng);

        const tollPtCount = v.tollRoute?.polyline?.encodedPolyline
          ? decodePolyline(v.tollRoute.polyline.encodedPolyline).length : 0;
        const freePtCount = v.freeRoute?.polyline?.encodedPolyline
          ? decodePolyline(v.freeRoute.polyline.encodedPolyline).length : 0;

        console.log('[DecisionPoint] lat:', decisionPt.latitude, 'lng:', decisionPt.longitude);
        console.log('[DecisionPoint] Google Maps link: https://www.google.com/maps?q=' + decisionPt.latitude + ',' + decisionPt.longitude);
        console.log('[DecisionPoint] Toll polyline points decoded:', tollPtCount);
        console.log('[DecisionPoint] Free polyline points decoded:', freePtCount);

        await Location.startGeofencingAsync(GEOFENCE_TASK, [{
          latitude:      decisionPt.latitude,
          longitude:     decisionPt.longitude,
          radius:        500,
          notifyOnEnter: true,
          notifyOnExit:  false,
        }]);
        setGeofenceArmed(true);
      }
    } catch (geoErr) {
      console.warn('Could not arm geofence:', geoErr.message);
    }

    setAnalysing(false);
  }

  return (
    <ThemeContext.Provider value={{ theme, C, s }}>
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.dark} />

        <View style={[s.topbar, s.topbarRow]}>
          <Text style={s.logoText}>TOLL ADVISOR</Text>
          <View style={s.topbarRight}>
            <View style={s.themeToggle}>
              <Text style={s.themeIcon}>☀️</Text>
              <Switch
                value={theme === 'dark'}
                onValueChange={v => setTheme(v ? 'dark' : 'light')}
                trackColor={{ false: '#d1d5db', true: C.green }}
                thumbColor="#ffffff"
                ios_backgroundColor="#d1d5db"
              />
              <Text style={s.themeIcon}>🌙</Text>
            </View>
            <TouchableOpacity style={s.settingsBtn} onPress={() => setSettingsOpen(true)} activeOpacity={0.7}>
              <Text style={s.settingsBtnText}>⚙︎</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={s.configSummary} onPress={() => setSettingsOpen(true)} activeOpacity={0.7}>
          <Text style={s.configSummaryText}>
            {`Save ${minTimeSaved || 0}+ min · pay up to $${maxToll || 0} · ${(URGENCY_OPTIONS.find(o => o.value === urgencyLevel) ?? URGENCY_OPTIONS[1]).label} urgency`}
          </Text>
          <Text style={s.configSummaryEdit}>Edit</Text>
        </TouchableOpacity>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">

            <Card>
              <CardTitle>Route</CardTitle>
              <Label>Starting Location</Label>
              <AddressInput
                value={locationText}
                onChangeText={t => { setLocationText(t); setLocationMode('manual'); }}
                placeholder='e.g. 1600 Pennsylvania Ave, Washington DC'
                recents={recentLocations}
                onSelectRecent={addr => { setLocationText(addr); setLocationMode('manual'); }}
                onRemoveRecent={removeRecentLocation}
                rightSlot={
                  <TouchableOpacity style={s.locBtn} onPress={detectLocation} activeOpacity={0.8}>
                    <Text style={s.locBtnIcon}>📍</Text>
                  </TouchableOpacity>
                }
              />
              <Label>Destination</Label>
              <AddressInput
                value={destination}
                onChangeText={setDestination}
                placeholder='e.g. 1600 Pennsylvania Ave, Washington DC'
                recents={recentDestinations}
                onSelectRecent={setDestination}
                onRemoveRecent={removeRecentDestination}
              />
            </Card>

            {pipelineStarted && !allStepsDone && (
              <>
                <Text style={s.sectionLabel}>Analysis Pipeline</Text>

                <StepCard num={1} title="Identify current road" state={stepStates[1]}>
                  {roadInfo && (
                    <View>
                      <View style={s.roadBadge}>
                        <View style={s.roadDot} />
                        <Text style={s.roadBadgeText}>{roadInfo.roadName}</Text>
                      </View>
                      <Text style={s.roadFormatted}>{roadInfo.formatted}</Text>
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
                    <Text style={s.noFreeNote}>No toll-free route exists, comparing toll options.</Text>
                  )}
                </StepCard>

                <Connector />

                <StepCard num={3} title="Calculate cost efficiency verdict" state={stepStates[3]}>
                  {verdict && <VerdictCard verdict={verdict} />}
                </StepCard>
              </>
            )}

            {allStepsDone && (
              <>
                <Text style={s.sectionLabel}>Result</Text>

                <View style={s.compactSummary}>
                  <View style={s.compactSummaryRow}>
                    <View style={s.roadDot} />
                    <Text style={s.compactSummaryText}>{roadInfo?.roadName}</Text>
                  </View>
                  <Text style={s.compactSummarySub}>{roadInfo?.formatted}</Text>
                </View>

                <View style={s.routesGrid}>
                  {displayList.map(({ route, isToll, isAlt }, i) => (
                    <RouteCard key={i} route={route} isToll={isToll} isAlt={isAlt} />
                  ))}
                </View>
                {noFreeRoute && (
                  <Text style={s.noFreeNote}>No toll-free route exists, comparing toll options.</Text>
                )}

                {verdict && <View style={{ marginTop: 12 }}><VerdictCard verdict={verdict} /></View>}
              </>
            )}

            {notificationSent && (
              <View style={s.notifBar}>
                <Text style={s.notifText}>🔔 Advisory notification sent</Text>
              </View>
            )}

            {geofenceArmed && (
              <View style={s.geofenceBar}>
                <Text style={s.geofenceText}>📍 Watching for decision point. Notification fires automatically as you approach</Text>
              </View>
            )}

            {error ? (
              <View style={s.errorBar}>
                <Text style={s.errorText}>⚠ {error}</Text>
              </View>
            ) : null}

            <View style={s.btnRow}>
              <TouchableOpacity
                style={[s.primaryBtn, analysing && s.btnDisabled]}
                onPress={runAnalysis}
                disabled={analysing}
                activeOpacity={0.8}
              >
                {analysing
                  ? <ActivityIndicator color="#000" />
                  : <Text style={s.primaryBtnText}>Analyse Route</Text>
                }
              </TouchableOpacity>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>

        <Modal
          visible={settingsOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setSettingsOpen(false)}
        >
          <View style={s.modalOverlay}>
            <View style={s.modalPanel}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Settings</Text>
                <TouchableOpacity onPress={() => setSettingsOpen(false)} activeOpacity={0.7}>
                  <Text style={s.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
                <Card>
                  <CardTitle>Configuration</CardTitle>

                  <Label>Minimum time saved to take the toll</Label>
                  <Text style={s.hint}>Only recommend the toll road if it saves at least this many minutes</Text>
                  <FieldInput value={minTimeSaved} onChangeText={setMinTimeSaved} keyboardType="numeric" placeholder="10" />

                  <Label>Most you're willing to pay in tolls</Label>
                  <Text style={s.hint}>Won't recommend a toll that costs more than this</Text>
                  <FieldInput value={maxToll} onChangeText={setMaxToll} keyboardType="numeric" placeholder="10" />

                  <Label>Your annual salary</Label>
                  <Text style={s.hint}>Used to estimate what your time is worth per minute</Text>
                  <FieldInput value={annualSalary} onChangeText={setAnnualSalary} keyboardType="numeric" placeholder="50000" />

                  <View style={s.divider} />
                  <UrgencyPicker value={urgencyLevel} onChange={setUrgencyLevel} />
                </Card>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </ThemeContext.Provider>
  );
}

function makeStyles(C) {
  return StyleSheet.create({
    safe:           { flex: 1, backgroundColor: C.black },
    topbar:         { backgroundColor: C.dark, paddingHorizontal: 20, paddingTop: 56, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
    topbarRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    logoText:       { fontSize: 18, fontWeight: '800', color: C.text, letterSpacing: 2 },
    logoSub:        { fontSize: 10, color: C.muted, letterSpacing: 1.5, marginTop: 2 },

    topbarRight:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
    themeToggle:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
    themeIcon:       { fontSize: 12 },

    settingsBtn:     { width: 34, height: 34, borderRadius: 8, backgroundColor: C.panel, borderWidth: 1, borderColor: C.border2, alignItems: 'center', justifyContent: 'center' },
    settingsBtnText: { fontSize: 16, color: C.text },

    configSummary:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.dark, paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
    configSummaryText: { fontSize: 11, color: C.muted, flex: 1, marginRight: 8 },
    configSummaryEdit: { fontSize: 11, color: C.green, fontWeight: '600' },

    modalOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalPanel:     { backgroundColor: C.dark, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '85%' },
    modalHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    modalTitle:     { fontSize: 16, fontWeight: '700', color: C.text },
    modalClose:     { fontSize: 18, color: C.muted, padding: 4 },

    scroll:         { flex: 1 },
    scrollContent:  { padding: 16 },

    card:           { backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 16, marginBottom: 12 },
    cardTitle:      { fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 },

    label:          { fontSize: 11, color: C.muted, marginBottom: 4, marginTop: 10, letterSpacing: 0.5 },
    hint:           { fontSize: 11, color: C.muted, opacity: 0.7, marginBottom: 6, lineHeight: 14 },
    input:          { backgroundColor: C.black, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
    inputFocused:   { borderColor: C.border2 },
    inputDisabled:  { opacity: 0.5 },

    locRow:         { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    locBtn:         { width: 42, height: 42, backgroundColor: C.border2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    locBtnIcon:     { fontSize: 16 },

    recentsWrap:       { marginTop: 6 },
    recentsLabel:      { fontSize: 9, color: C.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
    recentChip:        { flexDirection: 'row', alignItems: 'center', backgroundColor: C.black, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 4 },
    recentChipText:    { fontSize: 12, color: C.text },
    recentChipRemove:  { fontSize: 12, color: C.muted, paddingLeft: 10 },

    divider:        { height: 1, backgroundColor: C.border, marginTop: 16, marginBottom: 4 },

    toggleLabel:    { fontSize: 13, color: C.text, fontWeight: '600' },
    toggleSub:      { fontSize: 11, color: C.muted, marginTop: 2 },

    passGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
    passChip:       { borderWidth: 1, borderColor: C.border2, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
    passChipActive: { borderColor: C.green, backgroundColor: C.greenD },
    passChipText:   { fontSize: 11, color: C.muted },
    passChipTextActive: { color: C.green, fontWeight: '600' },
    passChipSub:    { fontSize: 9, marginTop: 1 },

    sectionLabel:   { fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, marginTop: 4 },

    compactSummary:     { marginBottom: 10 },
    compactSummaryRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
    compactSummaryText: { fontSize: 13, color: C.text, fontWeight: '600' },
    compactSummarySub:  { fontSize: 11, color: C.muted, marginTop: 2, marginLeft: 13 },

    step:           { backgroundColor: C.panel, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 2 },
    stepRow:        { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepIcon:       { width: 32, height: 32, borderRadius: 8, backgroundColor: C.black, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
    stepIconText:   { fontSize: 10, fontWeight: '700', color: C.muted },
    stepTitle:      { flex: 1, fontSize: 13, fontWeight: '600', color: C.text },
    stepBody:       { marginTop: 12 },
    pill:           { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
    pillText:       { fontSize: 9, fontWeight: '600', letterSpacing: 0.5 },

    connector:      { width: 1, height: 16, backgroundColor: C.border, marginLeft: 30, marginVertical: 1 },

    roadBadge:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.border2, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', marginBottom: 6 },
    roadDot:        { width: 7, height: 7, borderRadius: 4, backgroundColor: C.green },
    roadBadgeText:  { fontSize: 12, color: C.text },
    roadFormatted:  { fontSize: 12, color: C.muted, marginTop: 2 },

    routesGrid:     { flexDirection: 'row', gap: 8 },
    routeCard:      { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10 },
    routeType:      { fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
    routeName:      { fontSize: 12, fontWeight: '600', color: C.text, marginBottom: 8, lineHeight: 16 },
    routeStat:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.border },
    routeStatLast:  { borderBottomWidth: 0 },
    routeStatLabel: { fontSize: 11, color: C.muted },
    routeStatValue: { fontSize: 11, color: C.text, fontWeight: '500' },
    noFreeNote:     { fontSize: 11, color: C.amber, marginTop: 8 },

    verdictCard:      { borderWidth: 1, borderRadius: 10, padding: 14 },
    verdictLabel:     { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
    verdictText:      { fontSize: 13, color: C.text, lineHeight: 20, marginBottom: 12 },
    verdictStats:     { flexDirection: 'row', gap: 6 },
    verdictStat:      { flex: 1, alignItems: 'center', backgroundColor: C.black, borderRadius: 8, padding: 10 },
    verdictStatNum:   { fontSize: 20, fontWeight: '800', marginBottom: 4 },
    verdictStatLabel: { fontSize: 9, color: C.muted, letterSpacing: 1 },

    notifBar:       { backgroundColor: 'rgba(34,197,94,0.1)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)', borderRadius: 8, padding: 12, marginTop: 12 },
    notifText:      { fontSize: 12, color: C.green, textAlign: 'center' },

    geofenceBar:    { backgroundColor: 'rgba(59,130,246,0.1)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)', borderRadius: 8, padding: 12, marginTop: 8 },
    geofenceText:   { fontSize: 12, color: C.blue, textAlign: 'center' },

    errorBar:       { backgroundColor: C.redD, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 8, padding: 12, marginTop: 12 },
    errorText:      { fontSize: 12, color: C.red },

    btnRow:         { marginTop: 16 },
    primaryBtn:     { backgroundColor: C.green, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
    primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#000', letterSpacing: 0.5 },
    btnDisabled:    { opacity: 0.5 },
  });
}