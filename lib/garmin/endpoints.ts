// Endpoint audit: Garmin's official connect-personal-api-python README,
// "Endpoint wrappers" table, accessed 2026-10-25.
// The list includes every documented *dedicated Python wrapper*, not a claim
// that all possible Swagger endpoints have wrappers.

export const rangeEndpoints = [
  { name: "garmin_get_stress", description: "Daily stress totals for a date range", path: "/usersummary-service/stats/stress/daily/{start}/{end}" },
  { name: "garmin_get_steps", description: "Daily step totals for a date range", path: "/usersummary-service/stats/steps/daily/{start}/{end}" },
  { name: "garmin_get_hydration", description: "Daily hydration data for a date range", path: "/usersummary-service/stats/hydration/daily/{start}/{end}" },
  { name: "garmin_get_weight_goals", description: "Effective weight goals for a date range", path: "/goal-service/goal/user/effective/weightgoal/{start}/{end}" },
  { name: "garmin_get_weight_measurements", description: "Weight measurements for a date range", path: "/weight-service/weight/range/{start}/{end}", query: { includeAll: "true" } },
  { name: "garmin_get_sleep_summaries", description: "Daily sleep summaries across a date range", path: "/sleep-service/sleep/dailySleepSummariesByDate", queryMode: "dateRange" },
  { name: "garmin_get_body_battery", description: "Daily Body Battery reports across a date range", path: "/wellness-service/wellness/bodyBattery/reports/daily", queryMode: "dateRange" },
  { name: "garmin_get_daily_summaries", description: "Daily Garmin health/activity summaries", path: "/usersummary-service/v2/dailysummaries", queryMode: "dateRange" },
  { name: "garmin_get_hrv_summaries", description: "Daily HRV summaries across a date range", path: "/hrv-service/hrv/daily/{start}/{end}" },
  { name: "garmin_get_wellness_activity_summaries", description: "Wellness activity summaries for a date range", path: "/wellnessactivity-service/activity/summary/range/{start}/{end}" },
] as const;

export const dailyEndpoints = [
  { name: "garmin_get_food_logs", description: "Food logs for one calendar day", path: "/nutrition-service/food/logs/{date}" },
  { name: "garmin_get_sleep", description: "Detailed sleep data for a calendar day", path: "/sleep-service/sleep/dailySleep", queryMode: "date" },
  { name: "garmin_get_heart_rate", description: "Daily heart rate measurements", path: "/wellness-service/wellness/dailyHeartRate", queryMode: "date" },
  { name: "garmin_get_hrv", description: "Detailed HRV data for a calendar day", path: "/hrv-service/hrv/{date}" },
  { name: "garmin_get_menstrual_cycle_summary", description: "Menstrual cycle summary for a calendar day", path: "/periodichealth-service/menstrualcycle/summary/{date}" },
  { name: "garmin_get_fitness_age", description: "Fitness age for a calendar day", path: "/fitnessage-service/fitnessage/v2/{date}" },
  { name: "garmin_get_spo2", description: "Pulse oximetry / SpO2 for a calendar day", path: "/wellness-service/wellness/daily/spo2acclimation/{date}" },
] as const;

export const noArgumentEndpoints = [
  { name: "garmin_get_profile", description: "Garmin Connect profile settings", path: "/userprofile-service/userprofile/settings" },
  { name: "garmin_get_heart_rate_zones", description: "Configured Garmin heart rate zones", path: "/biometric-service/heartRateZones/v2" },
] as const;

export const extraEndpoints = [
  { name: "garmin_get_menstrual_cycle_day_view", description: "Menstrual cycle day view", path: "/periodichealth-service/menstrualcycle/dayview/{date}?todayDate={today}" },
  { name: "garmin_search_activities", description: "Search activities with pagination and optional filters", path: "/activitylist-service/activities/search/activities" },
  { name: "garmin_get_activity", description: "Get detailed data for one activity", path: "/activity-service/activity/{id}" },
  { name: "garmin_get_activity_workouts", description: "Get workouts attached to an activity", path: "/activity-service/activity/{id}/workouts" },
  { name: "garmin_download_activity", description: "Download activity ZIP in chunks (up to 15 MB)", path: "/download-service/files/activity/{id}" },
] as const;

export const endpointCatalog = [
  ...rangeEndpoints,
  ...dailyEndpoints,
  ...noArgumentEndpoints,
  ...extraEndpoints,
];
