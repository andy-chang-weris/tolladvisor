import {
  urgencyWeight,
  valueOfTimeSaved,
  fmtDuration,
  getTollCost,
  routeHasToll,
  selectRoutes,
  calculateVerdict,
  decodePolyline,
  getDecisionPoint,
} from '../src/tollLogic';

// ── Helpers ──────────────────────────────────────────────────────────────

// Builds a route shaped like a Google Routes API response.
// toll: dollar amount, or undefined for a toll-free route.
function route(durationSec, toll, extra = {}) {
  const travelAdvisory = toll === undefined
    ? {}
    : {
        tollInfo: {
          estimatedPrice: [{
            currencyCode: 'USD',
            units: String(Math.floor(toll)),
            nanos: Math.round((toll % 1) * 1e9),
          }],
        },
      };
  return { duration: `${durationSec}s`, travelAdvisory, ...extra };
}

// Standard Google encoded-polyline encoder (inverse of decodePolyline).
function encodeValue(v) {
  v = v < 0 ? ~(v << 1) : v << 1;
  let s = '';
  while (v >= 0x20) {
    s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return s + String.fromCharCode(v + 63);
}

function encodePolyline(points) {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const p of points) {
    const lat = Math.round(p.latitude * 1e5);
    const lng = Math.round(p.longitude * 1e5);
    out += encodeValue(lat - prevLat) + encodeValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

// n points heading due north from (0,0), 0.001° apart (~111 m each).
function northLine(n) {
  return Array.from({ length: n }, (_, i) => ({ latitude: i * 0.001, longitude: 0 }));
}

function step(pt, maneuver, instructions = '') {
  return {
    startLocation: { latLng: { latitude: pt.latitude, longitude: pt.longitude } },
    navigationInstruction: { maneuver, instructions },
  };
}

// ── Time value ───────────────────────────────────────────────────────────

describe('urgencyWeight', () => {
  it('maps each urgency level to its weight', () => {
    expect(urgencyWeight('low')).toBe(0.5);
    expect(urgencyWeight('med')).toBe(1.0);
    expect(urgencyWeight('high')).toBe(1.5);
  });

  it('defaults to 1.0 for an unknown level', () => {
    expect(urgencyWeight('nope')).toBe(1.0);
    expect(urgencyWeight(undefined)).toBe(1.0);
  });
});

describe('valueOfTimeSaved', () => {
  // $100k / 2000 h = $50/h, × 0.5 = $25/h at medium urgency.
  it('values an hour at half the hourly wage at medium urgency', () => {
    expect(valueOfTimeSaved(60, 100000, 'med')).toBeCloseTo(25);
  });

  it('scales with urgency', () => {
    expect(valueOfTimeSaved(60, 100000, 'low')).toBeCloseTo(12.5);
    expect(valueOfTimeSaved(60, 100000, 'high')).toBeCloseTo(37.5);
  });

  it('scales with minutes saved', () => {
    expect(valueOfTimeSaved(30, 100000, 'med')).toBeCloseTo(12.5);
  });

  it('treats a missing or non-numeric salary as zero', () => {
    expect(valueOfTimeSaved(60, '', 'med')).toBe(0);
    expect(valueOfTimeSaved(60, 'abc', 'med')).toBe(0);
  });

  it('accepts salary as a string, as it comes from the text field', () => {
    expect(valueOfTimeSaved(60, '100000', 'med')).toBeCloseTo(25);
  });
});

// ── Formatting & route helpers ───────────────────────────────────────────

describe('fmtDuration', () => {
  it('shows minutes under an hour', () => {
    expect(fmtDuration(1500)).toBe('25 min');
  });

  it('shows hours and minutes from an hour up', () => {
    expect(fmtDuration(3600)).toBe('1h 0m');
    expect(fmtDuration(3720)).toBe('1h 2m');
  });

  it('never shows 60 minutes when rounding up', () => {
    expect(fmtDuration(3599)).toBe('1h 0m');
    expect(fmtDuration(7170)).toBe('2h 0m');
  });
});

describe('getTollCost / routeHasToll', () => {
  it('combines units and nanos into dollars', () => {
    expect(getTollCost(route(100, 5.5))).toBeCloseTo(5.5);
  });

  it('handles a price with only nanos', () => {
    const r = { travelAdvisory: { tollInfo: { estimatedPrice: [{ nanos: 750000000 }] } } };
    expect(getTollCost(r)).toBeCloseTo(0.75);
  });

  it('returns 0 and no toll for a free route', () => {
    expect(getTollCost(route(100))).toBe(0);
    expect(routeHasToll(route(100))).toBe(false);
    expect(routeHasToll(route(100, 2))).toBe(true);
  });

  // Google returns an empty tollInfo when a route has no known toll price.
  it('treats an empty tollInfo as no toll', () => {
    const r = { duration: '100s', travelAdvisory: { tollInfo: {} } };
    expect(getTollCost(r)).toBe(0);
    expect(routeHasToll(r)).toBe(false);
  });
});

describe('selectRoutes', () => {
  it('picks the cheapest toll route and the fastest free route', () => {
    const pricey = route(1800, 5);
    const cheap = route(2000, 3);
    const slowFree = route(2400);
    const fastFree = route(2200);
    const out = selectRoutes([pricey, cheap, slowFree, fastFree]);
    expect(out.tollRoute).toBe(cheap);
    expect(out.freeRoute).toBe(fastFree);
    expect(out.tollRoutes).toHaveLength(2);
    expect(out.freeRoutes).toHaveLength(2);
  });

  it('breaks a toll-price tie by duration', () => {
    const slow = route(2000, 3);
    const fast = route(1800, 3);
    expect(selectRoutes([slow, fast]).tollRoute).toBe(fast);
  });

  it('returns null for a missing category', () => {
    expect(selectRoutes([route(100)]).tollRoute).toBeNull();
    expect(selectRoutes([route(100, 2)]).freeRoute).toBeNull();
  });
});

// ── Verdict ──────────────────────────────────────────────────────────────

describe('calculateVerdict: toll vs free', () => {
  // Defaults: min 10 min saved, max $10 toll, $100k salary, medium urgency.
  function verdict(tollRoute, freeRoute, { min = 10, max = 10, salary = 100000, urgency = 'med' } = {}) {
    return calculateVerdict(
      { tollRoute, freeRoute, tollRoutes: tollRoute ? [tollRoute] : [], freeRoutes: freeRoute ? [freeRoute] : [] },
      min, max, salary, urgency
    );
  }

  it('returns null when there are no routes at all', () => {
    expect(calculateVerdict(selectRoutes([]), 10, 10, 100000, 'med')).toBeNull();
  });

  it('skips the toll when only a free route exists', () => {
    const free = route(1800);
    const v = verdict(null, free);
    expect(v.recommendation).toBe('SKIP_TOLL');
    expect(v.tollRoute).toBeNull();
    expect(v.freeRoute).toBe(free);
    expect(v.tollCost).toBe(0);
  });

  it('skips when the toll route is not faster', () => {
    const v = verdict(route(2400, 3), route(2400));
    expect(v.recommendation).toBe('SKIP_TOLL');
    expect(v.timeSavedMin).toBe(0);
    expect(v.reason).toMatch(/isn't faster/);
  });

  it('skips when the toll is over the hard limit', () => {
    const v = verdict(route(1800, 15), route(3600), { max: 10 });
    expect(v.recommendation).toBe('SKIP_TOLL');
    expect(v.reason).toMatch(/hard limit/);
  });

  // $20k salary → $5/h → 30 min is worth $2.50, less than a $5 toll.
  it('skips when the toll costs more than the time is worth', () => {
    const v = verdict(route(1800, 5), route(3600), { salary: 20000 });
    expect(v.recommendation).toBe('SKIP_TOLL');
    expect(v.worthToPay).toBeCloseTo(2.5);
    expect(v.reason).toMatch(/more than the 30 min saved is worth/);
  });

  // $200k salary → $50/h → 5 min is worth $4.17, above a $2 toll,
  // but 5 min is under the 10-min threshold.
  it('skips when time saved is under the minimum', () => {
    const v = verdict(route(1800, 2), route(2100), { salary: 200000 });
    expect(v.recommendation).toBe('SKIP_TOLL');
    expect(v.timeSavedMin).toBe(5);
    expect(v.reason).toMatch(/below your 10-min threshold/);
  });

  // $100k → $25/h → 30 min is worth $12.50, more than a $5 toll.
  it('takes the toll when it passes every check', () => {
    const toll = route(1800, 5);
    const v = verdict(toll, route(3600));
    expect(v.recommendation).toBe('TAKE_TOLL');
    expect(v.tollRoute).toBe(toll);
    expect(v.timeSavedMin).toBe(30);
    expect(v.tollCost).toBeCloseTo(5);
    expect(v.worthToPay).toBeCloseTo(12.5);
  });

  it('takes the toll when time saved exactly equals the minimum', () => {
    const v = verdict(route(1800, 2), route(2400), { salary: 200000 });
    expect(v.timeSavedMin).toBe(10);
    expect(v.recommendation).toBe('TAKE_TOLL');
  });

  // 30 min at $100k: low urgency is worth $6.25, medium $12.50; toll is $8.
  it('lets urgency flip the decision', () => {
    expect(verdict(route(1800, 8), route(3600), { urgency: 'low' }).recommendation).toBe('SKIP_TOLL');
    expect(verdict(route(1800, 8), route(3600), { urgency: 'med' }).recommendation).toBe('TAKE_TOLL');
  });
});

describe('calculateVerdict: every route has a toll', () => {
  function verdictFrom(routes, min = 10) {
    return calculateVerdict(selectRoutes(routes), min, 10, 100000, 'med');
  }

  it('takes the only route when there is just one', () => {
    const only = route(1800, 4);
    const v = verdictFrom([only]);
    expect(v.recommendation).toBe('TAKE_TOLL');
    expect(v.tollRoute).toBe(only);
    expect(v.freeRoute).toBeNull();
    expect(v.reason).toMatch(/only option/);
  });

  it('takes the cheapest when it is also the fastest', () => {
    const cheap = route(1800, 3);
    const pricey = route(2000, 6);
    const v = verdictFrom([pricey, cheap]);
    expect(v.tollRoute).toBe(cheap);
    expect(v.timeSavedMin).toBe(0);
    expect(v.reason).toMatch(/also the fastest/);
  });

  it('takes the pricier route when it saves enough time', () => {
    const cheap = route(2400, 3);
    const fast = route(1800, 6);
    const v = verdictFrom([cheap, fast]);
    expect(v.tollRoute).toBe(fast);
    expect(v.freeRoute).toBe(cheap);
    expect(v.timeSavedMin).toBe(10);
    expect(v.tollCost).toBeCloseTo(6);
  });

  it('takes the cheaper route when the faster one does not save enough', () => {
    const cheap = route(2100, 3);
    const fast = route(1800, 6);
    const v = verdictFrom([cheap, fast]);
    expect(v.tollRoute).toBe(cheap);
    expect(v.timeSavedMin).toBe(5);
    expect(v.reason).toMatch(/only saves 5 min/);
  });
});

// ── Polyline ─────────────────────────────────────────────────────────────

describe('decodePolyline', () => {
  // The worked example from Google's encoded polyline documentation.
  it("decodes Google's documented example", () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toHaveLength(3);
    expect(pts[0].latitude).toBeCloseTo(38.5, 5);
    expect(pts[0].longitude).toBeCloseTo(-120.2, 5);
    expect(pts[1].latitude).toBeCloseTo(40.7, 5);
    expect(pts[1].longitude).toBeCloseTo(-120.95, 5);
    expect(pts[2].latitude).toBeCloseTo(43.252, 5);
    expect(pts[2].longitude).toBeCloseTo(-126.453, 5);
  });

  it('returns no points for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });

  it('round-trips with the test encoder', () => {
    const pts = [{ latitude: 38.89768, longitude: -77.03653 }, { latitude: 38.9, longitude: -77.1 }];
    const out = decodePolyline(encodePolyline(pts));
    out.forEach((p, i) => {
      expect(p.latitude).toBeCloseTo(pts[i].latitude, 5);
      expect(p.longitude).toBeCloseTo(pts[i].longitude, 5);
    });
  });
});

// ── Decision point ───────────────────────────────────────────────────────

describe('getDecisionPoint', () => {
  // 0.001° of latitude ≈ 111.195 m, so 800 m back ≈ 0.0071946°.
  const BACK_800M = 0.0071946;

  function tollRouteWithEntry(pts, entryIdx, prevManeuver) {
    return {
      polyline: { encodedPolyline: encodePolyline(pts) },
      legs: [{
        steps: [
          step(pts[0], 'DEPART'),
          step(pts[entryIdx - 1], prevManeuver),
          step(pts[entryIdx], 'STRAIGHT', 'Continue onto VA-267\nToll road'),
        ],
      }],
    };
  }

  it('places the point 800 m before the ramp onto the toll road', () => {
    const pts = northLine(20);
    const toll = tollRouteWithEntry(pts, 16, 'RAMP_RIGHT');
    const p = getDecisionPoint(toll, null, 9, 9);
    // Anchored on the ramp step at point 15 (lat 0.015).
    expect(p.latitude).toBeCloseTo(0.015 - BACK_800M, 4);
    expect(p.longitude).toBeCloseTo(0, 5);
  });

  it('anchors on the toll step itself when the step before is not a ramp', () => {
    const pts = northLine(20);
    const toll = tollRouteWithEntry(pts, 16, 'STRAIGHT');
    const p = getDecisionPoint(toll, null, 9, 9);
    expect(p.latitude).toBeCloseTo(0.016 - BACK_800M, 4);
  });

  it('uses the route start when the toll road begins under 800 m away', () => {
    const pts = northLine(20);
    const toll = tollRouteWithEntry(pts, 4, 'RAMP_RIGHT');
    const p = getDecisionPoint(toll, null, 9, 9);
    expect(p.latitude).toBeCloseTo(0, 5);
    expect(p.longitude).toBeCloseTo(0, 5);
  });

  it('falls back to where the toll and free routes split', () => {
    // Both head north for 10 points, then toll turns east and free turns west.
    const shared = northLine(10);
    const tollPts = [...shared, { latitude: 0.009, longitude: 0.001 }, { latitude: 0.009, longitude: 0.002 }];
    const freePts = [...shared, { latitude: 0.009, longitude: -0.001 }, { latitude: 0.009, longitude: -0.002 }];
    const toll = { polyline: { encodedPolyline: encodePolyline(tollPts) }, legs: [{ steps: [] }] };
    const free = { polyline: { encodedPolyline: encodePolyline(freePts) }, legs: [{ steps: [] }] };
    const p = getDecisionPoint(toll, free, 9, 9);
    expect(p.latitude).toBeCloseTo(0.009, 5);
    expect(p.longitude).toBeCloseTo(0, 5);
  });

  it("uses the second step's start for a single route without polylines", () => {
    const pts = northLine(3);
    const only = { legs: [{ steps: [step(pts[0], 'DEPART'), step(pts[2], 'TURN_LEFT')] }] };
    const p = getDecisionPoint(null, only, 9, 9);
    expect(p).toEqual({ latitude: 0.002, longitude: 0 });
  });

  it('falls back to the origin when nothing else is available', () => {
    expect(getDecisionPoint(null, null, 1.5, 2.5)).toEqual({ latitude: 1.5, longitude: 2.5 });
  });
});
