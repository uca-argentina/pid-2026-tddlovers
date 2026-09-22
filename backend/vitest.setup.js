// Shared test-only env so any test can call buildApp() without wiring
// COOKIE_SECRET itself. Real secrets always come from .env / compose.
process.env.COOKIE_SECRET ??= 'test-secret-at-least-32-characters-long';
