# MotusAI Seed 0.2.13

Support fixed service fees after successful plugin runs and elapsed-time displays, and preserve billing receipts from failed invocations.

## New

- **Local plugin billing**: Use Cloud billing product configuration to settle a fixed service fee after success. Failed and cancelled runs do not incur this fee; duplicate requests and restart recovery reuse the original invocation.
- **Elapsed time**: Declarative status panels can display localized durations supplied by plugins during runs and after completion.

## Fixes

- **Failed invocation credits**: Preserve confirmed settlement receipts across plugin and native process errors so a tool failure does not discard known charges from the session total. Unconfirmed costs remain unknown.

## Usage notes

- **Companion plugins**: Update Agent Harness to 0.2.29 and IQ Protocol Generator to 0.1.22 for their corresponding error handling, billing and elapsed-time features.
