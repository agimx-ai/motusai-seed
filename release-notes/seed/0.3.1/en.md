# MotusAI Seed 0.3.1

Fix plugin updates, activity history, and image rendering while improving stability when installed and development plugins coexist.

## Improvements

- **Activity history**: Group plugin calls from the same request into one card, hide internal polling and transport records, and show a user-facing title instead of the request path.
- **Plugin source selection**: Run the higher plugin version when installed and development sources coexist while retaining development hot reloads for equal versions.
- **Plugin images**: Allow plugin pages to display HTTP and HTTPS images without rejecting valid remote assets.

## Fixes

- **Activity list recovery**: Restore real activity entries nested below internal technical traces instead of showing an empty list.
- **Connection text**: Improve spacing between names in local-client authorization records.
