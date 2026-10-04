# Design QA

- Source reference: live macOS App Store in Chinese, plus `/var/folders/01/_z66w0s17cj8k_0hkwv48b0c0000gn/T/codex-clipboard-dd6cc3ef-53e2-40f2-9470-63bc6ed18d8e.png`
- Implementation: MotusAI Seed development app, plugin catalog and detail header
- Surface checked: light theme at 1920×1280
- States checked: Get, Update, determinate download at 58%, completed, persisted installed

## Comparison

- Idle action uses a 64×28 soft-fill capsule, system blue 13px medium-weight text, and no hover fill change. Font weight and size were reduced after the user identified the previous text as too heavy.
- Active action collapses to 28×28 with a 20px circular indicator.
- The indicator is drawn at the display pixel ratio with a 1.5px track, clockwise progress, rounded arc ends, and a centered 5px rounded stop square.
- Download completion remains at a full ring through verification, installation, and activation; it does not restart as a second spinner.
- Completion retains the circular check for 500ms, then the same action button expands into a Details capsule that opens the plugin detail page.
- Uninstall now shares the capsule component, dimensions, background, and typography with Get/Update/Details, while retaining danger-colored text. The old border and trash icon were removed.

## Interaction

- Real plugin installation reached the preparing state and completed successfully.
- Download byte progress and cancellation are covered by installer tests.
- Reduced-motion mode removes layout and progress animation.
- Details change: verified the installed capsules on the native catalog page and clicked Resume Screening's Details button; the corresponding plugin detail page opened.
- Completion-to-Details timing is set to 500ms; this transition was not rechecked with a real installation during the Details change.
- Uninstall change: inspected the native Resume Screening detail header, clicked the capsule to open the correct uninstall confirmation, and cancelled it. No plugin was uninstalled in this check.

## Result

passed for the installed Details button and navigation, plus the Uninstall capsule and confirmation/cancel interaction; the completion transition, narrow width, and dark theme were not visually rechecked in this change.
