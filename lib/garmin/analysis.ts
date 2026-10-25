/** Read-only, deliberately conservative analytic helpers. No invented Garmin metrics. */
export type JsonRecord = Record<string, unknown>;
export function obj(v: unknown): JsonRecord | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as JsonRecord : null;
}
export function numberAt(v: unknown, names: string[]): number | null {
  const r = obj(v);
  if (!r) return null;
  for (const name of names) {
    const val = r[name];
    if (typeof val === 'number' && Number.isFinite(val)) return val;
  }
  return null;
}
export function pick(v: unknown, names: string[]): unknown {
  const r = obj(v);
  if (!r) return null;
  for (const name of names) if (r[name] !== undefined && r[name] !== null) return r[name];
  return null;
}
export function arr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  const r = obj(v);
  if (!r) return [];
  for (const key of ['data', 'items', 'results', 'activities', 'activityList', 'summaries', 'dailySummaries', 'dailyHrvSummaries', 'dailySleepSummaries']) {
    if (Array.isArray(r[key])) return r[key] as unknown[];
  }
  return [];
}
export function mean(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((a,b)=>a+b,0)/values.length * 100)/100 : null;
}
export function sum(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((a,b)=>a+b,0)*100)/100 : null;
}
export function dailySeries(raw: unknown, candidates: string[], dateKeys: string[] = ['calendarDate','date','summaryDate','measurementDate']): unknown {
  const source = arr(raw);
  const rows = source.map(item => {
    const r = obj(item);
    const date = r ? pick(r, dateKeys) : null;
    const val = numberAt(item, candidates);
    return { date, value: val };
  });
  const valid = rows.filter(r => r.value !== null);
  const values = valid.map(r => r.value as number);
  const first = values.slice(0, Math.min(7, Math.floor(values.length/2)));
  const last = values.slice(-first.length);
  return {
    observations_returned: source.length,
    numeric_observations: valid.length,
    candidate_fields: candidates,
    average: mean(values),
    minimum: values.length ? Math.min(...values) : null,
    maximum: values.length ? Math.max(...values) : null,
    sum: sum(values),
    first_window_average: mean(first),
    last_window_average: mean(last),
    last_minus_first: first.length ? Math.round(((mean(last) ?? 0)-(mean(first) ?? 0))*100)/100 : null,
    daily_values: rows.slice(0, 100),
    note: 'Null means missing/unrecognized data, not zero. First/last window compares up to 7 available observations; no causal inference or medical diagnosis.'
  };
}
export function activityDigest(raw: unknown, limit: number): unknown {
  const items = arr(raw).slice(0, limit);
  const rows = items.map(entry => {
    const d = obj(entry) ?? {};
    const distanceMeters = numberAt(d, ['distance','distanceMeters']);
    const durationSeconds = numberAt(d, ['movingDuration','duration','elapsedDuration']);
    return {
      activity_id: pick(d,['activityId','activity_id','id']),
      name: pick(d,['activityName','name']),
      start: pick(d,['startTimeLocal','startTimeGMT','startTime']),
      activity_type: pick(d,['activityType','activityTypeDTO','sportTypeId']),
      distance_km: distanceMeters === null ? null : Math.round(distanceMeters/10)/100,
      duration_minutes: durationSeconds === null ? null : Math.round(durationSeconds/60*100)/100,
      avg_pace_sec_per_km: distanceMeters && durationSeconds ? Math.round(durationSeconds/distanceMeters*1000) : null,
      avg_hr_bpm: numberAt(d,['averageHR','averageHeartRate','avgHr']),
      max_hr_bpm: numberAt(d,['maxHR','maxHeartRate']),
      elevation_gain_m: numberAt(d,['elevationGain','totalAscent']),
      training_effect_aerobic: numberAt(d,['aerobicTrainingEffect']),
    };
  });
  const distances = rows.map(r=>r.distance_km).filter((v):v is number=>v!==null);
  const durations = rows.map(r=>r.duration_minutes).filter((v):v is number=>v!==null);
  return {
    activities_returned: items.length,
    total_distance_km: sum(distances),
    total_duration_minutes: sum(durations),
    average_distance_km: mean(distances),
    activities: rows,
    caveats: ['Totals include only returned activities, not necessarily a complete period.', 'Unrecognized Garmin fields appear as null rather than estimated.', 'MovingDuration may exclude stops; pace uses the duration Garmin returns.'],
  };
}
export function recoveryDigest(date: string, sleep: unknown, hrv: unknown, heartRate: unknown, battery: unknown): unknown {
  const sleepBody = obj(sleep);
  const sleepDetail = sleepBody ? (obj(sleepBody.dailySleepDTO) ?? sleepBody) : {};
  const hrvBody = obj(hrv);
  const hrvDetail = hrvBody ? (obj(hrvBody.hrvSummary) ?? hrvBody) : {};
  const hrBody = obj(heartRate) ?? {};
  return {
    date,
    sleep: {
      duration_seconds: numberAt(sleepDetail,['sleepTimeSeconds','durationInSeconds']),
      score: numberAt(sleepDetail,['sleepScore','overallSleepScore']),
      stages: pick(sleepDetail,['sleepLevels','sleepLevelData']),
    },
    hrv: {
      overnight_average_ms: numberAt(hrvDetail,['lastNightAvg','weeklyAvg','avgOvernightHrv']),
      status: pick(hrvDetail,['status','hrvStatus']),
      baseline: pick(hrvDetail,['baseline']),
    },
    heart_rate: {
      resting_bpm: numberAt(hrBody,['restingHeartRate','restingHeartRateValue']),
      seven_day_resting_bpm: numberAt(hrBody,['lastSevenDaysAvgRestingHeartRate']),
    },
    body_battery: battery,
    warnings: ['This is a factual dashboard, NOT a validated readiness score.', 'Some Garmin fields differ by device/account; unavailable fields are null.', 'Use Garmin\'s own readiness score only if an authorized documented endpoint exposes it.'],
  };
}
