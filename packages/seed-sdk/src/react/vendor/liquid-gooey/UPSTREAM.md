# liquid-gooey source

- Upstream: https://github.com/Jakubantalik/Libraries.dev
- Commit: `bcaf88f8a16a75fd95bf21e0747193ee3380a927`.
- Source: `packages/liquid-gooey/src`, version 0.2.2; MIT, see `LICENSE`.
- Reused from the pinned source in MotusAI's Obsidian client. The twelve mutually dependent core modules and the entrypoint license notice are retained; demos and npm dependencies are not added.
- Review comments from that copy remain. The two Obsidian-only `setCssStyles` calls in `imageMelt.tsx` use standard DOM `style.opacity` in Seed. No animation physics are changed.
- `DiscreteSlider.tsx` adapts the original Move settings, continuous pointer preview, native range selection, keyboard focus, and reduced-motion handling. Its rail follows the engine's body rectangle without a second animation clock.
- The packaged renderer carries the full MIT notice in `public/third-party-notices/liquid-gooey.txt`, independently of minifier comment stripping. A regression test keeps that notice identical to `LICENSE`.
- The SDK copy removes the Vite-wide invalidation hook. Component unmount and the plugin host own disposal; a reusable control must not reload the entire client.
