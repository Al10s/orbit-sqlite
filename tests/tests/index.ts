import { RunnableTest, EventEmitter } from "../utils";

import { tests as CacheTests } from './cache'

const getTests = (): RunnableTest[] => {
  return CacheTests.map(t => ({ ...t, emitter: new EventEmitter() }));
}

export const tests = getTests();