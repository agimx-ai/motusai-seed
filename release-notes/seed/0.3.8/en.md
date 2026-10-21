# MotusAI Seed 0.3.8

Fix blank plugin detail pages and delayed errors after bulk updates.

## Fixes

- **Plugin updates**: Wait for background activation to finish before completing an update, preventing subsequent updates from interfering with activation still in progress.
- **Detail page recovery**: Open plugin detail pages automatically switch to the new version after updates or development reloads. Cancel stale mount requests promptly when a page is closed or switched.
