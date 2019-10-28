import { ResultSet } from "react-native-sqlite-storage";
import { SQLiteCache } from "@al10s/react-native-orbit-sqlite";
import moment, { Moment } from "moment";

export class EventEmitter {
  private handlers: { [index: string]: ((args?: object) => void)[] } = {};
  on (event: string, callback: (args?: object) => void) {
    if (this.handlers[event] === undefined) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(callback);
  }

  off (event: string, callback: (args?: object) => void) {
    this.handlers[event].splice(this.handlers[event].indexOf(callback), 1);
  }

  trigger (event: string, args?: object) {
    const handlers = this.handlers[event];
    if (handlers) {
      for (const handler of handlers) {
        handler(args);
      }
    }
  }
}

export interface TestContext {}

export interface TestUnit<T extends TestContext> {
  run: (context: T) => Promise<void>;
  label: string;
}

export type RunnableTestUnit<T> = TestUnit<T> & {
  emitter: EventEmitter;
}

export interface TestSuite<T extends TestContext> {
  beforeEach: () => Promise<T>;
  afterEach: (context: T) => Promise<void>;
  before: () => Promise<void>;
  after: () => Promise<void>;
  units: RunnableTestUnit<T>[];
  name: string;
}

export type RunnableTestSuite<T> = TestSuite<T> & {
  emitter: EventEmitter;
}

const rsToArray = (rs?: ResultSet): any[] => {
  const result: any[] = [];
  if (!rs || !rs.rows || !rs.rows.length) {
    return result;
  }
  for (let i = 0; i < rs.rows.length; i ++) {
    result.push(rs.rows.item(i));
  }
  return result;
}

const _getTableNames = async (cache: SQLiteCache) => {
  const db = await cache.openDB();
  const [content] = await db.executeSql('SELECT name FROM sqlite_master WHERE type=?', [ 'table' ]);
  return rsToArray(content).map(t => t.name).filter(t => ['android_metadata', '__VERSION__'].indexOf(t) === -1)
}

const logSQLiteDBContent = async ({ cache }: { cache: SQLiteCache }) => {
  const tableNames = await _getTableNames(cache);
  const db = await cache.openDB();
  for (const tableName of tableNames) {
    const [ tableContent ] = await db.executeSql(`SELECT * FROM ${tableName}`);
    console.log(tableName, rsToArray(tableContent))
  }
}

export const getFormattedDuration = (start: Moment, end: Moment): string => {
  const duration = end.diff(start);
  const format = duration > 60 * 60 * 1000 ?
                  'h:mm:ss:SSS' :
                  duration > 60 * 1000 ?
                    'm:ss:SSS' :
                    's.SSS';
  return moment.utc(duration).format(format);
}