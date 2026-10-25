/** Garmin read-only aggregations. Missing/unknown values are always null. */
export type JsonRecord = Record<string, unknown>;
export function obj(v: unknown): JsonRecord | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as JsonRecord : null;
}
export function numberAt(v: unknown, names: string[]): number | null {
  const r = obj(v); if (!r) return null;
  for (const name of names) {
    const val = r[name];
    if (typeof val === 'number' && Number.isFinite(val)) return val;
  }
  return null;
}
export function pick(v: unknown, names: string[]): unknown {
  const r = obj(v); if (!r) return null;
  for (const name of names) if (r[name] !== undefined && r[name] !== null) return r[name];
  return null;
}
export function arr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  const r = obj(v); if (!r) return [];
  for (const key of ['data','items','results','activities','activityList','summaries','dailySummaries','dailyHrvSummaries','dailySleepSummaries']) {
    if (Array.isArray(r[key])) return r[key] as unknown[];
  }
  return [];
}
const rounded = (v: number, places = 2) => Number(v.toFixed(places));
export function mean(values: number[]): number | null {
  return values.length ? rounded(values.reduce((a,b)=>a+b,0)/values.length) : null;
}
export function sum(values: number[]): number | null {
  return values.length ? rounded(values.reduce((a,b)=>a+b,0)) : null;
}
export function dailySeries(raw: unknown, candidates: string[], dateKeys: string[] = ['calendarDate','date','summaryDate','measurementDate']): unknown {
  const source = arr(raw);
  const rows = source.map(item => ({ date: pick(item,dateKeys), value: numberAt(item,candidates) }));
  return summarizeDailyRows(rows, candidates, source.length);
}
export function summarizeDailyRows(rows: Array<{date: unknown; value: number | null}>, candidates: string[], returned = rows.length): unknown {
  const valid = rows.filter((r): r is {date:unknown;value:number} => r.value !== null);
  const values = valid.map(r=>r.value);
  const window = Math.min(7, Math.floor(values.length/2));
  const first = values.slice(0,window), last = window ? values.slice(-window) : [];
  return {
    observations_returned: returned,
    numeric_observations: values.length,
    missing_observations: rows.length - values.length,
    candidate_fields: candidates,
    average: mean(values), minimum: values.length ? Math.min(...values) : null,
    maximum: values.length ? Math.max(...values) : null, sum: sum(values),
    first_window_average: mean(first), last_window_average: mean(last),
    last_minus_first: window ? rounded((mean(last) ?? 0) - (mean(first) ?? 0)) : null,
    daily_values: rows.slice(0,100),
    note: 'Null is unavailable, never zero. Trend windows compare up to seven valid observations at each end; missing dates can make those windows nonconsecutive.'
  };
}

function activityTypeName(d: JsonRecord): string | null {
  const direct = pick(d, ['activityType','activityTypeDTO','sportTypeId']);
  if (typeof direct === 'string') return direct.toLowerCase();
  const nested = obj(direct);
  const key = nested ? pick(nested,['typeKey','typeName','sportTypeKey','parentTypeId']) : null;
  return typeof key === 'string' ? key.toLowerCase() : null;
}
function isRunLike(type: string | null): boolean {
  return !!type && /(running|trail_running|treadmill|walking|hiking)/.test(type);
}
function isSpeedSport(type: string | null): boolean {
  return !!type && /(cycling|biking|bike|running|walking|hiking|skiing|rowing)/.test(type);
}
export function activityDigest(raw: unknown, limit: number): unknown {
  const items = arr(raw).slice(0,limit);
  const rows = items.map(entry => {
    const d = obj(entry) ?? {};
    const type = activityTypeName(d);
    const distM = numberAt(d,['distance','distanceMeters']);
    // Garmin reports these as distinct fields, often with very different values.
    const duration = numberAt(d,['duration','timerDuration']);
    const moving = numberAt(d,['movingDuration']);
    const elapsed = numberAt(d,['elapsedDuration']);
    const distKm = distM === null ? null : rounded(distM/1000);
    const validDistance = distM !== null && distM > 0;
    const validDuration = duration !== null && duration > 0;
    // Display pace on run/walk sessions only. Never imply swimming/strength pace.
    const pace = isRunLike(type) && validDistance && validDuration
      ? Math.round((duration as number) * 1000 / (distM as number)) : null;
    const speed = isSpeedSport(type) && validDistance && validDuration
      ? rounded((distM as number) / (duration as number) * 3.6) : null;
    return {
      activity_id: pick(d,['activityId','activity_id','id']),
      name: pick(d,['activityName','name']),
      start: pick(d,['startTimeLocal','startTimeGMT','startTime']),
      activity_type: type,
      distance_km: distKm,
      duration_seconds: duration, duration_minutes: duration === null ? null : rounded(duration/60),
      moving_duration_seconds: moving, moving_duration_minutes: moving === null ? null : rounded(moving/60),
      elapsed_duration_seconds: elapsed, elapsed_duration_minutes: elapsed === null ? null : rounded(elapsed/60),
      avg_pace_sec_per_km: pace, avg_speed_kmh: speed,
      avg_hr_bpm: numberAt(d,['averageHR','averageHeartRate','avgHr']),
      max_hr_bpm: numberAt(d,['maxHR','maxHeartRate']),
      elevation_gain_m: numberAt(d,['elevationGain','totalAscent']),
      training_effect_aerobic: numberAt(d,['aerobicTrainingEffect']),
    };
  });
  const distances = rows.map(r=>r.distance_km).filter((v):v is number=>v!==null);
  const durations = rows.map(r=>r.duration_minutes).filter((v):v is number=>v!==null);
  const movingDurations = rows.map(r=>r.moving_duration_minutes).filter((v):v is number=>v!==null);
  const elapsedDurations = rows.map(r=>r.elapsed_duration_minutes).filter((v):v is number=>v!==null);
  return {
    activities_returned: items.length,
    total_distance_km: sum(distances), average_distance_km: mean(distances),
    total_duration_minutes: sum(durations),
    total_moving_duration_minutes: sum(movingDurations),
    total_elapsed_duration_minutes: sum(elapsedDurations),
    duration_fields_available: {duration:durations.length,moving_duration:movingDurations.length,elapsed_duration:elapsedDurations.length},
    activities: rows,
    caveats: [
      'Duration is Garmin duration/timerDuration, never silently substituted by movingDuration or elapsedDuration.',
      'Moving and elapsed durations are separately reported. Different totals may exclude activities with null values.',
      'Pace is reported only for running/walking/hiking, using Garmin duration. Speed is reported only for applicable sports.',
      'Totals apply only to returned activities, not necessarily the entire training period.'
    ]
  };
}

function stageDuration(sleep: JsonRecord, detail: JsonRecord, aliases: string[]): number | null {
  return numberAt(detail,aliases) ?? numberAt(sleep,aliases);
}
/**
 * Garmin Body Battery reports may be an object, an array of daily reports,
 * or a nested response. Descriptor fields may vary by API version.
 * We only infer the level column without a descriptor for *two-element*
 * [timestamp, level] tuples, and label that inference in the output.
 */
function batterySummary(raw: unknown): unknown {
  type Candidate = { report: JsonRecord; points: unknown[]; path: string; levelIndex: number; method: string };
  const candidates: Candidate[] = [];
  const inspected = new WeakSet<object>();
  const aliases = ['bodyBatteryValuesArray', 'bodyBatteryValues', 'bodyBatteryValueArray', 'batteryValues'];
  const descriptorAliases = ['bodyBatteryValueDescriptorDTOList', 'bodyBatteryValueDescriptors'];

  function columnName(entry: unknown): string | null {
    if (typeof entry === 'string') return entry;
    const r = obj(entry);
    if (!r) return null;
    const name = pick(r, ['key', 'name', 'fieldName', 'field', 'type', 'descriptor', 'valueKey', 'description', 'valueName']);
    return typeof name === 'string' ? name : null;
  }

  function levelColumn(report: JsonRecord, points: unknown[]): { index: number; method: string } {
    const rawDescriptors = pick(report, descriptorAliases);
    const descriptors = Array.isArray(rawDescriptors) ? rawDescriptors : [];
    const index = descriptors.findIndex(d => {
      const name = columnName(d);
      return !!name && /body.?battery.?level/i.test(name.replace(/[_\s-]+/g, ''));
    });
    if (index >= 0) {
      const descriptor = obj(descriptors[index]);
      const explicitIndex = descriptor ? numberAt(descriptor, ['index', 'arrayIndex', 'columnIndex']) : null;
      return { index: explicitIndex !== null && Number.isInteger(explicitIndex) && explicitIndex >= 0 ? explicitIndex : index, method: 'descriptor' };
    }
    // Safe structural fallback only if ALL tuple samples are exactly
    // [timestamp, level] pairs. This prevents selecting a random field
    // from a wider descriptor-indexed response.
    const tuples = points.filter(Array.isArray);
    if (tuples.length > 0 && tuples.every(p => p.length === 2)) {
      return { index: 1, method: 'two_column_tuple_fallback' };
    }
    return { index: -1, method: 'unrecognized_columns' };
  }

  function walk(value: unknown, path: string, depth: number, parent: JsonRecord | null): void {
    if (depth > 7 || value === null || typeof value !== 'object' || inspected.has(value)) return;
    inspected.add(value);
    if (Array.isArray(value)) {
      for (let n = 0; n < Math.min(value.length, 100); n++) {
        // The sample arrays themselves are handled by the parent.
        if (obj(value[n]) || (Array.isArray(value[n]) && !Array.isArray(value[n][0]))) {
          walk(value[n], `${path}[${n}]`, depth + 1, parent);
        }
      }
      return;
    }
    const record = obj(value);
    if (!record) return;
    for (const alias of aliases) {
      const points = record[alias];
      if (Array.isArray(points) && points.length) {
        const descriptors = pick(record, descriptorAliases) ?? (parent ? pick(parent, descriptorAliases) : null);
        const enriched = descriptors ? { ...record, bodyBatteryValueDescriptorDTOList: descriptors } : record;
        const col = levelColumn(enriched, points);
        candidates.push({ report: record, points, path: `${path}.${alias}`, levelIndex: col.index, method: col.method });
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (aliases.includes(key)) continue;
      if (child && typeof child === 'object') walk(child, `${path}.${key}`, depth + 1, record);
    }
  }
  walk(raw, '$', 0, null);

  function readingsFor(candidate: Candidate): number[] {
    const result: number[] = [];
    for (const point of candidate.points) {
      const value = Array.isArray(point)
        ? candidate.levelIndex >= 0 ? point[candidate.levelIndex] : null
        : numberAt(point, ['bodyBatteryLevel', 'bodyBattery', 'batteryLevel', 'value']);
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) result.push(value);
    }
    return result;
  }
  // Prefer the candidate with the most valid samples; retain actual sample order.
  const ranked = candidates.map(c => ({ ...c, readings: readingsFor(c) }))
    .sort((a, b) => b.readings.length - a.readings.length);
  const selected = ranked[0];
  const readings = selected?.readings ?? [];
  // Charge/drain metadata can be outside the nested sample container.
  const root = obj(raw) ?? (Array.isArray(raw) ? obj(raw[0]) : null) ?? {};
  const detail = selected?.report ?? root;
  const metadata = (names: string[]) => numberAt(detail, names) ?? numberAt(root, names);

  return {
    first_sample: readings.length ? readings[0] : null,
    last_sample: readings.length ? readings[readings.length - 1] : null,
    charged: metadata(['charged', 'chargedValue', 'chargedAmount']),
    drained: metadata(['drained', 'drainedValue', 'drainedAmount']),
    high: readings.length ? Math.max(...readings) : metadata(['highestValue', 'high', 'maxValue']),
    low: readings.length ? Math.min(...readings) : metadata(['lowestValue', 'low', 'minValue']),
    sampled_points: readings.length,
    sample_parse: {
      source_path: selected?.path ?? null,
      method: selected?.method ?? 'no_sample_array_found',
      candidate_arrays: candidates.length,
    },
    note: 'First/last refer to valid returned samples, not necessarily midnight/end-of-day; missing samples are never interpolated.'
  };
}
export function recoveryDigest(date: string, sleep: unknown, hrv: unknown, heartRate: unknown, battery: unknown): unknown {
  const sleepBody = obj(sleep) ?? {};
  const sleepDetail = obj(sleepBody.dailySleepDTO) ?? sleepBody;
  const scores = obj(sleepBody.sleepScores) ?? obj(sleepDetail.sleepScores) ?? {};
  const overall = obj(scores.overall) ?? {};
  const hrvBody = obj(hrv) ?? {};
  const hrvDetail = obj(hrvBody.hrvSummary) ?? hrvBody;
  const hrBody = obj(heartRate) ?? {};
  return {
    date,
    sleep: {
      duration_seconds: numberAt(sleepDetail,['sleepTimeSeconds','durationInSeconds']),
      score: numberAt(sleepDetail,['sleepScore','overallSleepScore']) ?? numberAt(overall,['value','score']),
      deep_seconds: stageDuration(sleepBody,sleepDetail,['deepSleepSeconds']),
      light_seconds: stageDuration(sleepBody,sleepDetail,['lightSleepSeconds']),
      rem_seconds: stageDuration(sleepBody,sleepDetail,['remSleepSeconds']),
      awake_seconds: stageDuration(sleepBody,sleepDetail,['awakeSleepSeconds']),
    },
    hrv: {
      overnight_average_ms: numberAt(hrvDetail,['lastNightAvg','avgOvernightHrv']),
      weekly_average_ms: numberAt(hrvDetail,['weeklyAvg']),
      status: pick(hrvDetail,['status','hrvStatus']),
      baseline: pick(hrvDetail,['baseline']),
    },
    heart_rate: {
      resting_bpm: numberAt(hrBody,['restingHeartRate','restingHeartRateValue']),
      seven_day_resting_bpm: numberAt(hrBody,['lastSevenDaysAvgRestingHeartRate']),
    },
    body_battery: batterySummary(battery),
    warnings: ['Factual snapshot, not a validated readiness score.', 'Missing or unrecognized Garmin response fields are null.']
  };
}
