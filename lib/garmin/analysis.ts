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
 * Garmin Body Battery reports use descriptor-indexed samples:
 * bodyBatteryValueDescriptorDTOList maps array positions to fields, and
 * bodyBatteryValuesArray contains timestamped tuples in that field order.
 * The returned values describe samples, NOT necessarily midnight/end-of-day.
 */
function batterySummary(raw: unknown): unknown {
  const item = arr(raw)[0] ?? raw;
  const detail = obj(item) ?? {};
  const descriptors = pick(detail, [
    'bodyBatteryValueDescriptorDTOList',
    'bodyBatteryValueDescriptors',
  ]);
  const descriptorList = Array.isArray(descriptors) ? descriptors : [];
  const descriptorName = (descriptor: unknown): string | null => {
    if (typeof descriptor === 'string') return descriptor;
    const name = pick(descriptor, [
      'key', 'name', 'fieldName', 'field', 'type', 'descriptor', 'valueKey',
    ]);
    return typeof name === 'string' ? name : null;
  };
  const levelIndex = descriptorList.findIndex(
    d => descriptorName(d)?.toLowerCase() === 'bodybatterylevel'
  );
  // Older response variants sometimes omit descriptors but put the level
  // in tuple position 1. That fallback is not used when descriptors exist
  // but do not identify the level column (avoids silently wrong data).
  const sampleArrays = pick(detail, [
    'bodyBatteryValuesArray',
    'bodyBatteryValues',
    'bodyBatteryValueArray',
    'batteryValues',
  ]);
  const points = Array.isArray(sampleArrays) ? sampleArrays : [];
  const readings: number[] = [];
  for (const point of points) {
    let value: unknown = null;
    if (Array.isArray(point)) {
      const index = levelIndex >= 0 ? levelIndex : descriptorList.length === 0 ? 1 : -1;
      if (index >= 0) value = point[index];
    } else {
      value = numberAt(point, ['bodyBatteryLevel', 'bodyBattery', 'batteryLevel', 'value']);
    }
    if (typeof value === 'number' && Number.isFinite(value)) readings.push(value);
  }
  return {
    first_sample: readings.length ? readings[0] : null,
    last_sample: readings.length ? readings[readings.length - 1] : null,
    charged: numberAt(detail, ['charged','chargedValue','chargedAmount']),
    drained: numberAt(detail, ['drained','drainedValue','drainedAmount']),
    high: readings.length ? Math.max(...readings) : numberAt(detail, ['highestValue','high','maxValue']),
    low: readings.length ? Math.min(...readings) : numberAt(detail, ['lowestValue','low','minValue']),
    sampled_points: readings.length,
    note: 'First/last represent the first/last valid samples returned by Garmin, not necessarily start/end-of-day. Missing samples are not interpolated.'
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
