import AsyncStorage from '@react-native-async-storage/async-storage';

const TRIP_CONTEXT_KEY = 'tripContext';
let _tripContext = null;

export async function saveTripContext(ctx) {
  _tripContext = ctx;
  try { await AsyncStorage.setItem(TRIP_CONTEXT_KEY, JSON.stringify(ctx)); } catch {}
}

export async function clearTripContext() {
  _tripContext = null;
  try { await AsyncStorage.removeItem(TRIP_CONTEXT_KEY); } catch {}
}

export async function loadTripContext() {
  if (_tripContext) return _tripContext;
  try {
    const saved = await AsyncStorage.getItem(TRIP_CONTEXT_KEY);
    if (saved) _tripContext = JSON.parse(saved);
  } catch {}
  return _tripContext;
}
