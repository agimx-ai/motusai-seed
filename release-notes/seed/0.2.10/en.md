# MotusAI Seed 0.2.10

Fix missing tool charges in conversation totals and stabilize macOS application icons.

## Fixes

- **Credit accounting**: Provide confirmed settlement receipts so conversation totals can include model, search, webpage reading and other tool charges. Deduplicate nested calls by call ID instead of estimating charges from quotes or tool content.
- **Settlement completeness**: Avoid misleading partial totals when settlement is unknown, failed or pending. Actual billing rules are unchanged.
- **Application icons**: Fix intermittent blank icons during builds and validate generated assets. Packaged apps preserve native macOS 26+ Liquid Glass icons instead of overriding them with the development Dock icon.

## Usage notes

- **Coordinated update**: Credit totals require Agent Harness 0.2.23. Historical totals cannot be reconstructed for sessions without tool settlement receipts.
- **Plugin development**: SDK 0.2.3 adds opt-in billing receipts; default capability invocations retain their existing business results.
