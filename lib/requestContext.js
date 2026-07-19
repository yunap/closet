// Spec 33 Part 1: request-scoped user context. AsyncLocalStorage propagates through the
// whole async chain automatically — including background phases spawned from a request
// (the importer's long-running phases are continuations of that request's async context),
// so no manual threading is needed anywhere downstream.
import { AsyncLocalStorage } from 'node:async_hooks'

// Yuna's instance is user #1 (spec 33 Part 3 adoption). Until auth exists (Part 2), every
// request runs as this user, and any code that runs outside a request (scratch scripts,
// tests that never call runWithUser) resolves to it too.
export const DEFAULT_USER_ID = 1

const storage = new AsyncLocalStorage()

export function runWithUser(userId, fn) {
  return storage.run({ userId }, fn)
}

export function getCurrentUserId() {
  return storage.getStore()?.userId ?? DEFAULT_USER_ID
}
