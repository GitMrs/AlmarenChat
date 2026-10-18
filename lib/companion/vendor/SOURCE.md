# Koro renderer subset
`koro-core.js` contains the model evaluation, mesh batching, clipping mask and shader subset of the public browser runtime, formatted and isolated for the local companion prototype. Top-level symbols were renamed. The remote asset loader, telemetry, application code, atlas renderer and optional WebAssembly optimization are excluded. The CPU evaluator and basic WebGL2 renderer are used instead.

This is reference runtime code from the source site, not an implementation of the Live2D Cubism SDK. It has no network calls, vault keys, authentication code or dependencies on the source website. Model assets and this runtime are for local prototype validation; this integration does not establish redistribution rights.
