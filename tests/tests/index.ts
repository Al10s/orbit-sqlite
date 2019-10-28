import { EventEmitter, RunnableTestSuite } from "../utils";

import { suite as CacheSuite } from './cache'

const getTestSuites = (): RunnableTestSuite<any>[] => {
  return [
    CacheSuite,
  ].map(t => ({ ...t, emitter: new EventEmitter() }))
}

export const suites = getTestSuites();