# Bloub animation core

This directory contains only the framework-independent geometry, pose data, and SVG animation engine needed by the Seed mascot. It was extracted from [jeremy-prt/bloub](https://github.com/jeremy-prt/bloub) at commit `b4bb3c1b5f93c7b87a2e8d620f667c4093d97749`.

The upstream Vue application, animation editor, customizer pages, export tools, routing, styles, and UI components are intentionally not included. `SeedlingMascot.tsx` is Seed's React renderer and maps framework-level task snapshots to the extracted engine states.

See `LICENSE` for the upstream MIT license and copyright notice.
