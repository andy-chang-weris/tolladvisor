import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { selectRoutes, calculateVerdict } from '../tollLogic';
import { GOOGLE_API_KEY } from '../config';
import { getRoutes } from '../services/googleApi';
import { buildNotificationContent } from '../services/notifications';
import { loadTripContext } from '../services/tripContext';

export const GEOFENCE_TASK = 'TOLL_DECISION_POINT';

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) { console.warn('Geofence task error:', error.message); return; }
  if (!data) return;
  const { eventType } = data;
  if (eventType !== Location.GeofencingEventType.Enter) return;
  const ctx = await loadTripContext();
  if (!ctx) return;

  const { destination, minTimeSaved, maxToll, annualSalary, urgencyLevel } = ctx;
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
