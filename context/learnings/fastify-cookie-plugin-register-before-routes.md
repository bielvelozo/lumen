---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/05-login-jwt-sessions/spec]]"
created: 2026-06-18
---
# `@fastify/cookie` must be registered BEFORE the routes that use cookies

`reply.setCookie`/`reply.clearCookie` and `request.cookies` are decorations added by
`@fastify/cookie`. A route only sees decorations from plugins registered **before** it in
the same encapsulation context. In `buildApp(deps)` the order is therefore:

```ts
if (deps.auth) {
  app.register(cookie);          // first
  registerAuthRoutes(app, deps.auth); // then the routes / requireAuth that read cookies
}
```

`app.register(...)` is queued and runs at `app.ready()`, and `registerAuthRoutes` adds the
routes synchronously after it — so on `ready()` the cookie plugin loads first and the auth
routes (and the `requireAuth` preHandler reading `request.cookies`) have `setCookie` and
`request.cookies` available. Registering it conditionally (only when auth deps exist) keeps
`buildApp()` with no deps minimal so the dependency-free `/health` test stays green.

## Context

Hit wiring spec 05 into the shared `buildApp(deps?: AppDeps)` factory. `buildApp` stays
synchronous (it doesn't `await` the register) — Fastify processes the registration queue on
`ready()`, which the tests call via `app.ready()` / `app.inject`.

## How to Apply

- Register cross-cutting plugins (cookie, cors, etc.) before the routes that depend on
  their decorations; never after.
- Keep optional feature wiring gated on its injected dep so the base app (and its tests)
  doesn't pull in unused plugins.
- In `app.inject` tests, set incoming cookies via the `cookies: { [NAME]: value }` option
  and assert outgoing ones via `res.cookies` (parsed: `httpOnly`, `secure`, `sameSite`,
  `path`, `value`, `expires`).
