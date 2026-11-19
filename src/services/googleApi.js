export async function snapToRoad(lat, lng, googleKey) {
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

export async function getRoadViaGeocode(lat, lng, googleKey) {
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

export async function geocodeAddress(address, googleKey) {
  const url  = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length)
    throw new Error('Could not find that address. Try being more specific.');
  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

export async function getRoutes(originLat, originLng, destination, googleKey) {
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
