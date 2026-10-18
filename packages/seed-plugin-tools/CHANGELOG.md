# Changelog

## 0.1.2

- Normalize author-declared UTF-8 text resources to LF so public plugin assets remain byte-identical across platform packages.
- Preserve binary resources and platform-specific sidecars without rewriting their contents.

## 0.1.1

- Remove this development session's synchronized plugin when `npm run dev` stops normally, including repeated termination signals forwarded by npm.
- Wait for interrupted builds before cleanup, and preserve plugins replaced by another development session, installed packages and user data.

## 0.1.0

- Build, package and continuously synchronize independent Seed Plugin API v2 projects.
