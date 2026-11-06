# MotusAI Seed 0.3.17

Public SDK motion preference APIs let custom plugin animations follow the client's reduced motion setting.

## New

- **Motion preference reader**: Import `prefersReducedMotion()` from the SDK to check the current preference before starting an animation. The client choice takes priority, with the system preference used when following the system.
- **React motion preference**: Import `useReducedMotion()` from the React entry point to react to client and system preference changes. Subscriptions are released when the component unmounts.

## Usage notes

- **Matching versions**: The client and SDK both update to 0.3.17. Plugins using these APIs should require this client version or later.
- **Custom animations**: Plugins must adopt the APIs and stop or resume their own animations. Updating the client or SDK alone does not change existing custom animation logic.
