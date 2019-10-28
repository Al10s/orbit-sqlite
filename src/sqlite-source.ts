import Orbit, {
  buildTransform,
  pullable,
  Pullable,
  pushable,
  Pushable,
  Resettable,
  syncable,
  Syncable,
  Query,
  QueryOrExpression,
  Source,
  SourceSettings,
  Transform,
  TransformOrOperations,
  RecordOperation,
  Operation,
  UpdateRecordOperation,
  Record
} from '@orbit/data';
import { supportsSQLite } from './utils';
import SQLiteCache, { SQLiteCacheSettings } from './sqlite-cache';

const { assert, deprecate } = Orbit;

export interface SQLiteSourceSettings extends SourceSettings {
  namespace?: string;
  cacheSettings?: SQLiteCacheSettings;
  location?: 'default'|'Documents'|'Library';
}

@pullable
@pushable
@syncable
export default class SQLiteSource extends Source
  implements Pullable, Pushable, Resettable, Syncable {
  protected _cache: SQLiteCache;

  // Syncable interface stubs
  sync: (transformOrTransforms: Transform|Transform[]) => Promise<void>;

  // Pullable interface stubs
  pull: (
    queryOrExpressions: QueryOrExpression,
    options?: object,
    id?: string
  ) => Promise<Transform[]>;

  // Pushable interface stubs
  push: (
    transformOrOperations: TransformOrOperations,
    options?: object,
    id?: string
  ) => Promise<Transform[]>;

  constructor (settings: SQLiteSourceSettings = {}) {
    assert(
      "SQLiteSource's `schema` must be specified in `settings.schema` constructor argument",
      !!settings.schema
    );
    assert('Your browser does not support SQLite!', supportsSQLite());

    settings.name = settings.name || 'sqlite';

    super(settings);

    let cacheSettings: SQLiteCacheSettings = settings.cacheSettings || {} as SQLiteCacheSettings;
    cacheSettings.schema = settings.schema;
    cacheSettings.keyMap = settings.keyMap;
    cacheSettings.queryBuilder = cacheSettings.queryBuilder || this.queryBuilder;
    cacheSettings.transformBuilder = cacheSettings.transformBuilder || this.transformBuilder;
    cacheSettings.namespace = cacheSettings.namespace || settings.namespace;
    cacheSettings.location = cacheSettings.location || settings.location;

    this._cache = new SQLiteCache(cacheSettings);
  }

  get cache (): SQLiteCache {
    return this._cache;
  }

  async upgrade (): Promise<void> {
    await this._cache.reopenDB();
  }

  closeDB () {
    deprecate('`closeDB()` must be called as `cache.closeDB()`.');
    return this.cache.closeDB();
  }

  /////////////////////////////////////////////////////////////////////////////
  // Resettable interface implementation
  /////////////////////////////////////////////////////////////////////////////

  async reset (): Promise<void> {
    await this._cache.reset();
  }

  /////////////////////////////////////////////////////////////////////////////
  // Syncable interface implementation
  /////////////////////////////////////////////////////////////////////////////

  async _sync (transform: Transform): Promise<void> {
    if (!this.transformLog.contains(transform.id)) {
      await this._cache.patch(transform.operations as RecordOperation[]);
      await this.transformed([transform]);
    }
  }

  /////////////////////////////////////////////////////////////////////////////
  // Pushable interface implementation
  /////////////////////////////////////////////////////////////////////////////

  async _push (transform: Transform): Promise<Transform[]> {
    let results: Transform[];

    if (!this.transformLog.contains(transform.id)) {
      await this._cache.patch(transform.operations as RecordOperation[]);
      results = [transform];
      await this.transformed(results);
    }
    else {
      results = [];
    }

    return results;
  }

  /////////////////////////////////////////////////////////////////////////////
  // Pullable implementation
  /////////////////////////////////////////////////////////////////////////////

  async _pull(query: Query): Promise<Transform[]> {
    let operations: Operation[];

    const results = await this._cache.query(query);

    if (Array.isArray(results)) {
      operations = results.map(r => {
        return {
          op: 'updateRecord',
          record: r
        };
      });
    } else if (results) {
      let record = results as Record;
      operations = [
        {
          op: 'updateRecord',
          record
        } as UpdateRecordOperation
      ];
    } else {
      operations = [];
    }

    const transforms = [buildTransform(operations)];

    await this.transformed(transforms);

    return transforms;
  }
}
