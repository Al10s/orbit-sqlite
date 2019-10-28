import { EventEmitter, RunnableTestSuite } from "../utils";

import { suite as CacheTestSuite } from './cache'
import { suite as SourceTestSuite } from './source'

const getTestSuites = (): RunnableTestSuite<any>[] => {
  return [
    SourceTestSuite,
    CacheTestSuite,
  ].map(t => ({ ...t, emitter: new EventEmitter() }))
}

export const suites = getTestSuites();