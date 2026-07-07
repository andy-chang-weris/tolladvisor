// src/tollLogic.js

export const URGENCY_OPTIONS = [
  { label: 'Low', value: 'low', weight: 0.5 },
  { label: 'Medium', value: 'med', weight: 1.0 },
  { label: 'High', value: 'high', weight: 1.5 },
];

export function urgencyWeight(level) {
  return URGENCY_OPTIONS.find(o => o.value === level)?.weight ?? 1.0;
}

export const VOT_FRACTION = 0.5;
export const ANNUAL_WORK_HOURS = 2000;

export function valueOfTimeSaved(timeSavedMin, annualSalary, urgencyLevel) {
  const salary = Number(annualSalary) || 0;
  const hourlyWage = salary / ANNUAL_WORK_HOURS;
  const perHour = hourlyWage * VOT_FRACTION * urgencyWeight(urgencyLevel);
  return (timeSavedMin / 60) * perHour;
}

export function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

export function getTollCost(route) {
  const price = route.travelAdvisory?.tollInfo?.estimatedPrice?.[0];
  if (!price) return 0;
  return parseFloat(price.units || 0) + (price.nanos || 0) / 1e9;
}

export function routeHasToll(route) {
  return (route.travelAdvisory?.tollInfo?.estimatedPrice?.length || 0) > 0;
}

export function selectRoutes(routes) {
  const tollRoutes = routes.filter(routeHasToll);
  const freeRoutes = routes.filter(r => !routeHasToll(r));

  const tollRoute = tollRoutes.length
    ? tollRoutes.sort(
        (a, b) =>
          getTollCost(a) - getTollCost(b) ||
          parseInt(a.duration) - parseInt(b.duration)
      )[0]
    : null;

  const freeRoute = freeRoutes.length
    ? freeRoutes.sort((a, b) => parseInt(a.duration) - parseInt(b.duration))[0]
    : null;

  return { tollRoute, freeRoute, tollRoutes, freeRoutes };
}

export function calculateVerdict(
  selected,
  minTimeSaved,
  maxToll,
  annualSalary,
  urgencyLevel
) {
  let { tollRoute, freeRoute } = selected;

  if (!tollRoute && !freeRoute) return null;

  if (!tollRoute) {
    return {
      tollRoute: null,
      freeRoute,
      timeSavedMin: 0,
      tollCost: 0,
      worthToPay: 0,
      recommendation: 'SKIP_TOLL',
      reason: `No toll routes available. The free route (${fmtDuration(
        parseInt(freeRoute.duration)
      )}) is your only option.`,
    };
  }

  if (!freeRoute) {
    const others = selected.tollRoutes.filter(r => r !== tollRoute);

    const altRoute = others.length
      ? others.sort((a, b) => parseInt(a.duration) - parseInt(b.duration))[0]
      : null;

    const cheapCost = getTollCost(tollRoute);

    if (!altRoute) {
      return {
        tollRoute,
        freeRoute: null,
        timeSavedMin: 0,
        tollCost: cheapCost,
        worthToPay: 0,
        recommendation: 'TAKE_TOLL',
        reason: `Every route to this destination has a toll. The only option is $${cheapCost.toFixed(
          2
        )} (${fmtDuration(parseInt(tollRoute.duration))}).`,
      };
    }

    const altCost = getTollCost(altRoute);
    const cheapDurSec = parseInt(tollRoute.duration);
    const altDurSec = parseInt(altRoute.duration);
    const timeSavedMin = Math.round((cheapDurSec - altDurSec) / 60);
    const costDiff = altCost - cheapCost;

    if (timeSavedMin <= 0) {
      return {
        tollRoute,
        freeRoute: altRoute,
        timeSavedMin: 0,
        tollCost: cheapCost,
        worthToPay: 0,
        recommendation: 'TAKE_TOLL',
        reason: `Every route has a toll. The cheapest option ($${cheapCost.toFixed(
          2
        )}, ${fmtDuration(cheapDurSec)}) is also the fastest, so take it.`,
      };
    }

    if (costDiff > 0 && timeSavedMin >= minTimeSaved) {
      return {
        tollRoute: altRoute,
        freeRoute: tollRoute,
        timeSavedMin,
        tollCost: altCost,
        worthToPay: valueOfTimeSaved(
          timeSavedMin,
          annualSalary,
          urgencyLevel
        ),
        recommendation: 'TAKE_TOLL',
        reason: `Every route has a toll. The faster route saves ${timeSavedMin} min for $${costDiff.toFixed(
          2
        )} more, which is worth it based on your time threshold.`,
      };
    }

    return {
      tollRoute,
      freeRoute: altRoute,
      timeSavedMin,
      tollCost: cheapCost,
      worthToPay: valueOfTimeSaved(timeSavedMin, annualSalary, urgencyLevel),
      recommendation: 'TAKE_TOLL',
      reason: `Every route has a toll. The faster route only saves ${timeSavedMin} min for $${costDiff.toFixed(
        2
      )} more, so take the cheaper option ($${cheapCost.toFixed(2)}).`,
    };
  }

  const tollDurSec = parseInt(tollRoute.duration);
  const freeDurSec = parseInt(freeRoute.duration);
  const timeSavedMin = Math.round((freeDurSec - tollDurSec) / 60);
  const tollCost = getTollCost(tollRoute);
  const weight = urgencyWeight(urgencyLevel);
  const worthToPay = valueOfTimeSaved(
    timeSavedMin,
    annualSalary,
    urgencyLevel
  );

  let recommendation = 'SKIP_TOLL';
  let reason = '';

  if (timeSavedMin <= 0) {
    reason = `The toll route isn't faster (saves ${timeSavedMin} min), so there's no reason to pay $${tollCost.toFixed(
      2
    )}. Take the free route.`;
  } else if (tollCost > maxToll) {
    reason = `Toll ($${tollCost.toFixed(
      2
    )}) exceeds your hard limit of $${maxToll.toFixed(
      2
    )}. Take the free route.`;
  } else if (tollCost > worthToPay) {
    reason = `Toll ($${tollCost.toFixed(
      2
    )}) is more than the ${timeSavedMin} min saved is worth to you ($${worthToPay.toFixed(
      2
    )} at ${weight}x urgency). Take the free route.`;
  } else if (timeSavedMin < minTimeSaved) {
    reason = `Only saves ${timeSavedMin} min, below your ${minTimeSaved}-min threshold. Not worth $${tollCost.toFixed(
      2
    )}. Take the free route.`;
  } else {
    recommendation = 'TAKE_TOLL';
    reason = `Saves ${timeSavedMin} min worth $${worthToPay.toFixed(
      2
    )} to you; toll is only $${tollCost.toFixed(2)}. Take the toll road.`;
  }

  return {
    tollRoute,
    freeRoute,
    timeSavedMin,
    tollCost,
    worthToPay,
    recommendation,
    reason,
  };
}

export function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return points;
}

export function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getDecisionPoint(tollRoute, freeRoute, originLat, originLng) {
  if (tollRoute && freeRoute) {
    const tollEncoded = tollRoute.polyline?.encodedPolyline;
    const freeEncoded = freeRoute.polyline?.encodedPolyline;

    if (tollEncoded && freeEncoded) {
      const tollPts = decodePolyline(tollEncoded);
      const freePts = decodePolyline(freeEncoded);

      if (tollPts.length > 0 && freePts.length > 0) {
        const DIVERGENCE_METRES = 25;
        let lastSharedTollPt = tollPts[0];
        let diverged = false;

        for (const tollPt of tollPts) {
          const closestFreeDist = Math.min(
            ...freePts.map(fp =>
              haversineMetres(
                tollPt.latitude,
                tollPt.longitude,
                fp.latitude,
                fp.longitude
              )
            )
          );

          if (closestFreeDist > DIVERGENCE_METRES) {
            diverged = true;
            break;
          }

          lastSharedTollPt = tollPt;
        }

        if (diverged) {
          return {
            latitude: lastSharedTollPt.latitude,
            longitude: lastSharedTollPt.longitude,
          };
        }

        if (tollPts.length >= 2) {
          return {
            latitude: tollPts[1].latitude,
            longitude: tollPts[1].longitude,
          };
        }
      }
    }
  }

  const singleRoute = tollRoute ?? freeRoute;

  if (singleRoute) {
    const steps = singleRoute?.legs?.[0]?.steps ?? [];

    if (steps.length >= 2) {
      const loc = steps[1].startLocation?.latLng;

      if (loc?.latitude && loc?.longitude) {
        return {
          latitude: loc.latitude,
          longitude: loc.longitude,
        };
      }
    }
  }

  return {
    latitude: originLat + 0.005,
    longitude: originLng + 0.005,
  };
}