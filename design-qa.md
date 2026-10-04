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

## Update All

- Added a shared capsule on the right of the Available Plugins heading. It is disabled when no installed compatible updates exist, and retains an Updating text label during the batch instead of duplicating each plugin's progress ring.
- The action refreshes the complete catalog and reads the current installed snapshot before building its queue. Search and source filters do not limit the Update All scope.
- Updates run sequentially through the existing install API. Failure or cancellation of one item does not prevent the remaining items from being processed. A global toast reports success or partial results and failure details.
- Native visual checks: light/dark themes at the minimum supported 960×640 logical window size (1920×1280 screenshot pixels), including the no-updates disabled state. Confirmed the original System theme preference before returning to the plugin catalog.
- Automated checks cover candidate selection, serial execution, failures/cancellation, empty queues, localized capsule labels, batch busy/disabled rendering, and disabled dark-theme text styling. Full tests: 307 passed, 1 skipped; typecheck and production build passed.
- Live batch downloads were not exercised because the current device has no available installed-plugin updates. No installed versions or plugin data were modified to manufacture an update.

## Action transition alignment

- Replaced size-based FLIP transforms with a centered width transition inside a stable action slot. Get, Update and Details reserve the same localized width; progress no longer changes the card's text column. Indicator and text fades do not scale their contents.
- Native light-theme check at 960×640 logical size: explicitly confirmed installation of IQ 草案生成, captured preparing and real download progress at 3%, verified the installed Details capsule, and opened the plugin's actual detail page. The plugin remains installed; no uninstall was performed. The short completed check was not captured during this download.
- Supplemental geometry harness reused the production ResourceCard and PluginActionButton, without invoking installation. Under the root dark theme, eight configurations (Chinese/English, 300px/600px cards, local light/dark variants) were sampled over 722 frames through Get → preparing → download → verifying → completed → Details and Update → download → completed → Details.
- Maximum horizontal/vertical center drift, slot-width drift and text-column drift were all 0px. Chinese capsules stayed 64px wide and English capsules stayed 77.21875px wide before and after; active width reached 28px. Canvas bounds remained 20×20 throughout. This controlled sequence is animation evidence, not another real download or update.
- Temporary harness files and browser tab were removed after checking. Automated tests: 310 passed, 1 skipped. Typecheck and production build passed (existing large-chunk warning remains); development config was restored. No package, commit or push was performed.

## Additional diagnosed issues (before follow-up fixes)

- AppLogo system-appearance rules conflict with root dark-theme rules. Reproduced with the production AppLogo/CSS in the temporary harness: system light + app dark produces display:block for both light and dark images. No OS or saved application theme setting was changed.
- Detail header independently rendered install progress and Uninstall once the installed snapshot arrived. The completed progress remained for 500ms, so both controls could coexist. The follow-up below resolves this separately from the shared button's geometry correction.

## Startup, detail completion and sticky-search follow-up

- App-theme Logo selectors now explicitly exclude system-appearance Logos. Removed competing important declarations, and the startup screen uses the resolved application appearance. Native startup preview in both light and dark mode at 960×640 logical size showed a single centered Logo with the existing shimmer intact. Preview mode and the temporary theme override were restored before checks; no saved theme preference or OS setting was changed.
- Extracted the detail header's lifecycle actions into PluginDetailActions, composed from the existing shared capsule. Its primary button stays mounted and right-anchored across the installed snapshot and completion. Localized Get/Update/Uninstall widths share a reserved slot. During an install/update, only this progress control is present; Uninstall is not exposed. Idle updates retain both update and uninstall access.
- With explicit user approval, installed IQ 草案生成 0.1.18 from its actual detail page and captured preparing, downloading at 2%, verifying, activating, completed, and then Uninstall (about 2.9 seconds). Completion showed only one check ring, not a separate Uninstall capsule. After the transition settled, only the Uninstall capsule occupied the same center. Plugin content loaded successfully; it remains installed, and no uninstall was performed.
- Reproduced Update All painting over the sticky search bar at a 0.6-page scroll. Isolated the shared action slot's stacking context rather than increasing sticky z-indices. At the same scroll position the search bar correctly covered the scrolled-out action in both light and dark themes. List actions and Details navigation remained visible below it.
- Regression coverage includes every progress phase after the installed snapshot, busy-before-progress, completed-to-uninstall, idle update actions, batch disabling, localized sizing, Logo selector scoping and action stacking isolation. Full checks: 325 tests passed, 1 skipped; typecheck and production build passed. Existing large-chunk build warning remains. No package, commit or push was performed.

## Plugin list loading skeletons

- The runtime now reports catalog and installed-authorization load states independently. Initial empty arrays are not treated as loaded empty results. Failed loads settle to error rather than remaining in a skeleton; retries return to loading. Existing loaded lists remain visible during routine refreshes.
- Installed placeholders match the 36px icon row. Catalog placeholders compose the production ResourceCard and grid, including icon, text and capsule slots. Pulse animation honors reduced-motion preferences; placeholders are hidden from assistive technology under localized status labels.
- Native page visual checks at 960×640 logical size used temporary loading props for both lists in light and dark themes. These were controlled visual previews, not a claim that an actual startup fetch remained pending. Temporary props and theme override were removed; no stored appearance preference was changed.
- With production props restored, real searches for recording and an unmatched query showed the expected result and settled empty state. Real requests completed before the native capture returned, so pending-search frames were not captured. Clearing search restored the full catalog; scrolling kept the existing sticky search/action layering intact. No user plugin was installed or uninstalled.
- Automated coverage verifies initial loading, independent list settlement, empty-after-success, failures, retry, authorization failure when catalog refresh skips entitlements, and preservation during routine renewal. Production ResourceCard geometry is reused rather than copied. Narrower-than-minimum windows, live offline failure and plugin uninstall were not manually exercised in this change.
- Final checks: 335 tests passed, 1 skipped; typecheck and production build passed (existing large-chunk warning). Plugin Host smoke passed with an existing official package in a temporary isolated user-data directory; it did not modify the user's installation. No package, commit or push was performed.

## Orphaned plugin data reset

- Settings reuses the existing SettingsRow, ActionButton and ConfirmDialog. Reset scans before showing specific plugin identities and sends only the confirmed identities to deletion. The installed-record set, including disabled, unauthorized or broken installations, is protected independently from the renderer's displayed plugin subset.
- Cleanup covers orphan private directories, encrypted configuration and credentials. It leaves user workspaces, app account data, backups and installed-plugin data outside the cleanup scope. Installation/uninstallation and reset are mutually exclusive. Tests use disposable directories and verify exact-target deletion, reinstallation after preview, unconfirmed data protection, symlink/traversal rejection, partial failure/retry and exact stored scopes.
- Native dark-theme settings and confirmation were inspected at 960×640 logical size. The read-only scan found two remnants and displayed their identities; no real Delete Data action was invoked. Follow-up removes the explanatory paragraph and its Chinese/English locale keys, retaining title, identities and actions. Reset / 重置 button labels no longer contain an ellipsis.
- Full tests: 344 passed, 1 skipped; typecheck, production build and isolated Plugin Host smoke passed. The final label-only edit also passed its focused test. Light theme, English UI, empty-state toast and real-data deletion were not manually exercised. No package, commit or push was performed.
- Naming follow-up: Chinese and English settings, confirmation actions and result messages now consistently use cleanup terminology. The setting is 清理插件数据 / Clean Up Plugin Data; its description refers to intentionally retained data for uninstalled plugins, not leftovers. Three focused locale/component tests and raw typecheck passed; behavior and cleanup scope are unchanged.
- Native Chinese settings and a read-only confirmation scan verified the final labels 清理插件数据, 清理已卸载插件的数据？ and 清理数据. The confirmation was cancelled; no saved plugin data was deleted. English strings were verified by tests, not a native English UI inspection.
- Result-feedback follow-up: successful cleanup now shows only 插件数据已清理。 / Plugin data cleaned up. Partial failure uses a warning with retry guidance, total failure an error, and protected reinstalled-plugin data an informational message. Raw IDs, backend error text and zero-count statistics are no longer rendered in this result toast. Nine focused tests and raw typecheck passed. The native dark-theme success toast was visually checked using a temporary simulated result, then the preview code was removed; this QA did not perform another real cleanup. Other result states and English copy were tested, not visually exercised.
