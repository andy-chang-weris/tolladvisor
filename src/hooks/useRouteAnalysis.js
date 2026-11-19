import { useState, useCallback } from 'react';
import * as Location from 'expo-location';
import { selectRoutes, calculateVerdict, decodePolyline, getDecisionPoint } from '../tollLogic';
import { GOOGLE_API_KEY } from '../config';
import { snapToRoad, getRoadViaGeocode, geocodeAddress, getRoutes } from '../services/googleApi';
import { sendVerdictNotification } from '../services/notifications';
import { saveTripContext, clearTripContext } from '../services/tripContext';
import { GEOFENCE_TASK } from '../tasks/geofenceTask';

export function useRouteAnalysis() {
  const [analysing,        setAnalysing]        = useState(false);
  const [stepStates,       setStepStates]       = useState({ 1: 'waiting', 2: 'waiting', 3: 'waiting' });
  const [roadInfo,         setRoadInfo]         = useState(null);
  const [displayList,      setDisplayList]      = useState([]);
  const [noFreeRoute,      setNoFreeRoute]      = useState(false);
  const [verdict,          setVerdict]          = useState(null);
  const [notificationSent, setNotificationSent] = useState(false);
  const [geofenceArmed,    setGeofenceArmed]    = useState(false);
  const [error,            setError]            = useState('');

  const setStep = useCallback((n, state) => {
    setStepStates(prev => ({ ...prev, [n]: state }));
  }, []);

  const pipelineStarted = stepStates[1] !== 'waiting';
  const allStepsDone     = stepStates[1] === 'done' && stepStates[2] === 'done' && stepStates[3] === 'done';

  function resetAll() {
    setStepStates({ 1: 'waiting', 2: 'waiting', 3: 'waiting' });
    setRoadInfo(null);
    setDisplayList([]);
    setNoFreeRoute(false);
    setVerdict(null);
    setNotificationSent(false);
    setGeofenceArmed(false);
    setError('');
    clearTripContext();
    Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
  }

  async function runAnalysis({
    destination, locationText, locationMode, currentLat, currentLng,
    minTimeSaved, maxToll, annualSalary, urgencyLevel,
    setCurrentLat, setCurrentLng, pushRecentLocation, pushRecentDestination,
  }) {
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

    try {
      if (!v.tollRoute || !v.freeRoute) {
        setAnalysing(false);
        return;
      }

      await saveTripContext({
        destination,
        minTimeSaved: minTimeSavedNum, maxToll: maxTollNum,
        annualSalary: annualSalaryNum, urgencyLevel,
      });

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

  return {
    analysing, stepStates, roadInfo, displayList, noFreeRoute, verdict,
    notificationSent, geofenceArmed, error, pipelineStarted, allStepsDone,
    resetAll, runAnalysis,
  };
}
