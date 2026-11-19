import { useState, useEffect, useMemo } from 'react';
import {
  Text, View, TouchableOpacity, ScrollView, ActivityIndicator,
  SafeAreaView, Platform, StatusBar, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { URGENCY_OPTIONS } from './src/tollLogic';
import { GOOGLE_API_KEY } from './src/config';
import { COLORS } from './src/theme/colors';
import { makeStyles } from './src/theme/styles';
import { ThemeContext } from './src/theme/ThemeContext';
import { getRoadViaGeocode } from './src/services/googleApi';
import { useStoredPreferences } from './src/hooks/useStoredPreferences';
import { useRouteAnalysis } from './src/hooks/useRouteAnalysis';
import { Label } from './src/components/Label';
import { Card } from './src/components/Card';
import { SkeuButton } from './src/components/SkeuButton';
import { AddressInput } from './src/components/AddressInput';
import { StepCard, Connector } from './src/components/StepCard';
import { RouteCard } from './src/components/RouteCard';
import { VerdictCard } from './src/components/VerdictCard';
import { SettingsModal } from './src/components/SettingsModal';

export default function App() {
  const [destination,      setDestination]      = useState('');
  const [locationText,     setLocationText]     = useState('');
  const [locationMode,     setLocationMode]     = useState('manual');
  const [currentLat,       setCurrentLat]       = useState(null);
  const [currentLng,       setCurrentLng]       = useState(null);
  const [settingsOpen,     setSettingsOpen]     = useState(false);

  const {
    minTimeSaved, setMinTimeSaved, maxToll, setMaxToll,
    annualSalary, setAnnualSalary, urgencyLevel, setUrgencyLevel,
    theme, setTheme,
    recentLocations, recentDestinations,
    pushRecentLocation, pushRecentDestination,
    removeRecentLocation, removeRecentDestination,
  } = useStoredPreferences();

  const {
    analysing, stepStates, roadInfo, displayList, noFreeRoute, verdict,
    notificationSent, geofenceArmed, error, pipelineStarted, allStepsDone,
    runAnalysis,
  } = useRouteAnalysis();

  const C = COLORS[theme];
  const s = useMemo(() => makeStyles(C), [theme]);

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

  function analyse() {
    runAnalysis({
      destination, locationText, locationMode, currentLat, currentLng,
      minTimeSaved, maxToll, annualSalary, urgencyLevel,
      setCurrentLat, setCurrentLng, pushRecentLocation, pushRecentDestination,
    });
  }

  return (
    <ThemeContext.Provider value={{ theme, C, s }}>
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.dark} />

        <View style={[s.topbar, s.topbarRow]}>
          <Text style={s.logoText}>TOLL ADVISOR</Text>
          <View style={s.topbarRight}>
            <SkeuButton
              size="icon"
              onPress={() => setSettingsOpen(true)}
              accessibilityLabel="Open settings"
            >
              <Ionicons name="settings-outline" size={18} color="#ffffff" />
            </SkeuButton>
          </View>
        </View>

        <TouchableOpacity
          style={s.configSummary}
          onPress={() => setSettingsOpen(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Current settings: save ${minTimeSaved || 0} or more minutes, pay up to $${maxToll || 0}, ${(URGENCY_OPTIONS.find(o => o.value === urgencyLevel) ?? URGENCY_OPTIONS[1]).label} urgency. Double tap to edit.`}
        >
          <Text style={s.configSummaryText}>
            {`Save ${minTimeSaved || 0}+ min · pay up to $${maxToll || 0} · ${(URGENCY_OPTIONS.find(o => o.value === urgencyLevel) ?? URGENCY_OPTIONS[1]).label} urgency`}
          </Text>
          <Text style={s.configSummaryEdit}>Edit</Text>
        </TouchableOpacity>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">

            <Card>
              <Label large style={{ marginTop: 0 }}>Starting Location</Label>
              <AddressInput
                large
                label="Starting location"
                value={locationText}
                onChangeText={t => { setLocationText(t); setLocationMode('manual'); }}
                placeholder='Enter starting location'
                recents={recentLocations}
                onSelectRecent={addr => { setLocationText(addr); setLocationMode('manual'); }}
                onRemoveRecent={removeRecentLocation}
                rightSlot={
                  <SkeuButton
                    size="icon"
                    tone="subtle"
                    onPress={detectLocation}
                    style={{ width: 50, height: 50 }}
                    accessibilityLabel="Detect current location"
                  >
                    <Ionicons name="location-outline" size={20} color="#ffffff" />
                  </SkeuButton>
                }
              />
              <Label large>Destination</Label>
              <AddressInput
                large
                label="Destination"
                value={destination}
                onChangeText={setDestination}
                placeholder='Enter destination'
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
                        <View style={[s.roadDot, { backgroundColor: C.posGreen }]} />
                        <Text style={s.roadBadgeText}>{roadInfo.roadName}</Text>
                      </View>
                      <Text style={s.roadFormatted}>{roadInfo.formatted}</Text>
                    </View>
                  )}
                  {!roadInfo && stepStates[1] === 'error' && (
                    <View style={s.roadBadge}>
                      <View style={[s.roadDot, { backgroundColor: C.negRed }]} />
                      <Text style={s.roadBadgeText}>Could not identify road</Text>
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
                    <View style={[s.roadDot, { backgroundColor: C.posGreen }]} />
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
              <View style={s.notifBar} accessibilityLiveRegion="polite">
                <Text style={s.notifText}>🔔 Advisory notification sent</Text>
              </View>
            )}

            {geofenceArmed && (
              <View style={s.geofenceBar} accessibilityLiveRegion="polite">
                <Text style={s.geofenceText}>📍 Watching for decision point. Notification fires automatically as you approach</Text>
              </View>
            )}

            {error ? (
              <View style={s.errorBar} accessibilityLiveRegion="assertive" accessibilityRole="alert">
                <Text style={s.errorText}>⚠ {error}</Text>
              </View>
            ) : null}

            <View style={s.btnRow}>
              <SkeuButton
                onPress={analyse}
                disabled={analysing}
                style={{ width: '100%' }}
                accessibilityLabel={analysing ? 'Analyzing route, please wait' : 'Analyze route'}
              >
                {analysing
                  ? <ActivityIndicator color="#ffffff" />
                  : <Text style={s.primaryBtnText}>Analyze Route</Text>
                }
              </SkeuButton>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>

        <SettingsModal
          visible={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          minTimeSaved={minTimeSaved}
          setMinTimeSaved={setMinTimeSaved}
          maxToll={maxToll}
          setMaxToll={setMaxToll}
          annualSalary={annualSalary}
          setAnnualSalary={setAnnualSalary}
          urgencyLevel={urgencyLevel}
          setUrgencyLevel={setUrgencyLevel}
          theme={theme}
          setTheme={setTheme}
        />
      </SafeAreaView>
    </ThemeContext.Provider>
  );
}
