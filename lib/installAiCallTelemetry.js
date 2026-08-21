// Side-effect bootstrap imported before styling-engine/provider.js from server.js.
// Keeping this separate guarantees the global fetch observer is installed before either SDK module
// can capture the runtime fetch implementation, regardless of whether a particular SDK version
// resolves globalThis.fetch at module load or client construction time.
import { installAiFetchTelemetry } from './aiCallTelemetry.js'

installAiFetchTelemetry()
