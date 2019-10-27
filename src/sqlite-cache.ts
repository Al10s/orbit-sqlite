import Orbit, {
  Record,
  RecordIdentity,
  RelationshipDefinition,
  QueryOrExpression,
  RecordOperation,
  TransformBuilderFunc
} from '@orbit/data';
import {
  RecordRelationshipIdentity,
  AsyncRecordCache,
  AsyncRecordCacheSettings,
  QueryResultData,
  PatchResult
} from '@orbit/record-cache';
import { supportsSQLite, log } from './utils';
import SQLite, { SQLiteDatabase, Transaction } from 'react-native-sqlite-storage';
import { Dict } from '@orbit/utils';

const { assert } = Orbit;

const VERSION_TABLE_NAME = '__VERSION__';

class EventEmitter {
  private handlers: Dict<Array<(args?: object) => void>> = {};
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

export type SQLiteDBLocation = 'default'|'Documents'|'Library'

export interface SQLiteRecord {
  id: string;
  __keys__: string;
}

export interface SQLiteCacheSettings extends AsyncRecordCacheSettings {
  namespace?: string;
  location?: SQLiteDBLocation;
}

export interface MigrateDBData {
  oldVersion: number;
  newVersion: number;
}

export default class SQLiteCache extends AsyncRecordCache {
  protected _namespace: string;
  protected _location: SQLiteDBLocation;
  protected _db?: SQLiteDatabase;
  protected _dbGenerating: boolean;
  protected _dbAvailableEvent: EventEmitter;

  constructor (settings: SQLiteCacheSettings) {
    log('SQLiteCache', 'constructor called with params', settings);
    assert('Your browser does not support SQLite!', supportsSQLite());

    super(settings);

    this._namespace = settings.namespace || 'sqlite';
    this._location = settings.location || 'default';
    this._dbGenerating = false;
    this._dbAvailableEvent = new EventEmitter();
  }

  async query (
    queryOrExpression: QueryOrExpression,
    options?: object,
    id?: string
  ): Promise<QueryResultData> {
    log('SQLiteCache', 'query called with params', queryOrExpression, options, id);
    await this.openDB();
    return super.query(queryOrExpression, options, id);
  }

  async patch (
    operationOrOperations:
      | RecordOperation
      | RecordOperation[]
      | TransformBuilderFunc
  ): Promise<PatchResult> {
    log('SQLiteCache', 'patch called with params', operationOrOperations);
    await this.openDB();
    return super.patch(operationOrOperations);
  }

  get namespace (): string {
    return this._namespace;
  }

  async upgrade (): Promise<void> {
    log('SQLiteCache', 'upgrade called');
    await this.reopenDB();
    for (let processor of this._processors) {
      await processor.upgrade();
    }
  }

  async reset (): Promise<void> {
    log('SQLiteCache', 'reset called');
    await this.deleteDB();
    for (let processor of this._processors) {
      await processor.reset();
    }
  }

  get location (): SQLiteDBLocation {
    return this._location;
  }

  get dbVersion(): number {
    return this._schema.version;
  }

  get dbName (): string {
    return this._namespace;
  }

  async openDB (): Promise<SQLiteDatabase> {
    log('SQLiteCache', 'openDB called');
    if (!!this._db) {
      return this._db;
    }
    else if (this._dbGenerating) {
      return new Promise((resolve) => {
        const handler = () => {
          resolve(this._db);
          this._dbAvailableEvent.off('dbReady', handler);
        };
        this._dbAvailableEvent.on('dbReady', handler);
      });
    }
    else {
      this._dbGenerating = true;
      const newVersion = this.dbVersion;
      return SQLite.openDatabase({ name: this.dbName, location: this.location })
        .then(async (db: SQLiteDatabase) => {
          this._db = db;
          const [ res ] = await db.executeSql(
            `SELECT * FROM sqlite_master WHERE type=? AND name=?`,
            [ 'table', VERSION_TABLE_NAME ]
          );
          if (res.rows.length === 0) {
            log('No version in database.');
            await this.createDB(db, newVersion);
          }
          else {
            const [ versions ] = await db.executeSql(`SELECT * FROM ${VERSION_TABLE_NAME}`);
            const oldVersion = versions.rows.item(0).version;
            log('Database version', oldVersion, 'Version wanted', newVersion);
            if (oldVersion !== newVersion) {
              await this.migrateDB(db, { oldVersion, newVersion });
            }
          }
          this._dbGenerating = false;
          this._dbAvailableEvent.trigger('dbReady');
          return db;
        });
    }
  }

  async closeDB (): Promise<void> {
    log('SQLiteCache', 'closeDB called');
    if (!!this._db) {
      await this._db.close();
      this._db = undefined;
    }
  }

  async reopenDB (): Promise<SQLiteDatabase> {
    log('SQLiteCache', 'reopenDB called');
    await this.closeDB();
    return this.openDB();
  }

  async createDB (db: SQLiteDatabase, version: number): Promise<void> {
    log('SQLiteCache', 'createDB called');
    await db.transaction((tx: Transaction) => {
      tx.executeSql(`CREATE TABLE ${VERSION_TABLE_NAME}(version NUMERIC)`);
      tx.executeSql(`INSERT INTO ${VERSION_TABLE_NAME}(version) VALUES(?)`, [ version ]);
      for (const model of Object.keys(this.schema.models)) {
        this._createModelTable(model, tx);
        this._createRelationshipTables(model, tx);
      }
    });
  }

  async migrateDB (db: SQLiteDatabase, { oldVersion, newVersion }: MigrateDBData): Promise<void> {
    log('SQLiteCache', 'migrateDB called');
    console.error(
      'IndexedDBSource#migrateDB - should be overridden to upgrade SQLiteDatabase from: ',
      oldVersion,
      ' -> ',
      newVersion
    );
  }

  async deleteDB (): Promise<void> {
    log('SQLiteCache', 'deleteDB called');
    await this.closeDB();
    await SQLite.deleteDatabase({ name: this.dbName, location: this.location });
  }

  private _createModelTable (type: string, tx: Transaction) {
    log('SQLiteCache', '_createModelTable called for', type);
    const { attributes } = this.schema.getModel(type);
    let fieldsQuery: string[] = [];
    if (attributes !== undefined) {
      fieldsQuery = Object.keys(attributes).map((attributeKey: string) => {
        const attributeType = attributes[attributeKey].type;
        switch (attributeType) {
          case 'number':
            return `${attributeKey} NUMERIC`;
          default:
            return `${attributeKey} TEXT`;
        }
      });
    }
    fieldsQuery.unshift('id TEXT NOT NULL PRIMARY KEY');
    fieldsQuery.push('__keys__ TEXT');
    tx.executeSql(`CREATE TABLE ${type}(${fieldsQuery.join(',')})`);
  }

  private _createRelationshipTables (type: string, tx: Transaction) {
    log('SQLiteCache', '_createRelationshipTables called for', type);
    const { relationships } = this.schema.getModel(type);
    if (relationships !== undefined) {
      for (const relationshipKey of Object.keys(relationships)) {
        const { model } = relationships[relationshipKey];
        tx.executeSql(`CREATE TABLE relationships_${type}_${model}(
          ${type}_id TEXT NOT NULL,
          ${model}_id TEXT NOT NULL,
          FOREIGN KEY (${type}_id)
            REFERENCES ${type}(id)
            ON UPDATE CASCADE
            ON DELETE CASCADE,
          FOREIGN KEY (${model}_id)
            REFERENCES ${model}(id)
            ON UPDATE CASCADE
            ON DELETE CASCADE,
          PRIMARY KEY(${type}_id, ${model}_id)
        )`);
      }
    }
  }

  async clearRecords (type: string): Promise<void> {
    log('SQLiteCache', 'clearRecords called for', type);
    const db = await this.openDB();
    await db.transaction((tx: Transaction) => {
      tx.executeSql(`DELETE FROM ${type} WHERE 1`);
    });
  }

  private _stripNull (input: object): object {
    const output = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== null) {
        output[key] = value;
      }
    }
    return output;
  }

  private _parseRecordFromDb (input: SQLiteRecord, type: string): Record {
    log('SQLiteCache', '_parseRecordFromDb called for', type);
    const attributes = { ...input };
    const id = attributes.id;
    delete attributes.id;
    const keys = attributes.__keys__;
    delete attributes.__keys__;    
    const record: Record = { type, id, attributes: this._stripNull(attributes) };
    if (keys) {
      record.keys = JSON.parse(keys);
    }
    return record;
  }

  getRecordAsync (record: RecordIdentity): Promise<Record|undefined> {
    log('SQLiteCache', 'getRecordAsync called for', record);
    return new Promise((resolve, reject) => {
      this.openDB()
        .then((db: SQLiteDatabase) =>
          db.executeSql(`SELECT * FROM ${record.type} WHERE id=?`, [ record.id ])
            .then(([ res ]) => {
              log('SQLiteCache', 'getRecordAsync query done', res);
              if (res && res.rows && res.rows.length && res.rows.length === 1) {
                const recordFound = this._parseRecordFromDb(res.rows.item(0), record.type);
                if (this._keyMap) {
                  this._keyMap.pushRecord(recordFound);
                }
                log('SQLiteCache', 'getRecordAsync resolving with', recordFound);
                resolve(recordFound);
              }
              else {
                log('SQLiteCache', 'getRecordAsync resolving with', undefined);
                resolve(undefined);
              }
            })
        )
        .catch(reject);
    });
  }

  getRecordsAsync (typeOrIdentities?: string|RecordIdentity[]): Promise<Record[]> {
    log('SQLiteCache', 'getRecordsAsync called for', typeOrIdentities);
    if (!typeOrIdentities) {
      log('No type or identity provided');
      return this._getAllRecords();
    }
    else if (typeof typeOrIdentities === 'string') {
      log('String type provided');
      const type: string = typeOrIdentities;

      return new Promise((resolve, reject) => {
        this.openDB()
          .then((db: SQLiteDatabase) =>
            db.executeSql(`SELECT * FROM ${type}`)
              .then(([ res ]) => {
                log(`fetched ${res.rows.length} record(s) from table`);
                const records: Array<Record> = [];
                if (res && res.rows && res.rows.length) {
                  for (let idx = 0 ; idx < res.rows.length; idx ++) {
                    const record = this._parseRecordFromDb(res.rows.item(idx), type);
                    if (this._keyMap) {
                      this._keyMap.pushRecord(record);
                    }
                    records.push(record);
                  }
                }
                log('Records fetched', records);
                resolve(records);
                log('SQLiteCache', 'getRecordsAsync resolving with', records);
              })
          )
          .catch(reject);
      });
    }
    else if (Array.isArray(typeOrIdentities)) {
      const identities: RecordIdentity[] = typeOrIdentities;
      if (identities.length > 0) {
        return new Promise((resolve, reject) => {
          this.openDB()
            .then(async (db: SQLiteDatabase) => {
              Promise.all(identities.map(async ({ id, type }): Promise<Record|undefined> => {
                const [ resultSet ] = await db.executeSql(`SELECT * FROM ${type} WHERE id=?`, [ id ]);
                const result = resultSet.rows.item(0);
                if (result) {
                  const record = this._parseRecordFromDb(result, type);
                  if (this._keyMap) {
                    this._keyMap.pushRecord(record);
                  }
                  return record;
                }
              }))
              .then((records) => {
                resolve(records.filter((record?: Record) => record !== undefined));
              })
            })
            .catch(reject);
        });
      }
      else {
        return Promise.resolve([]);
      }
    }
    else {
      return Promise.reject();
    }
  }

  private async _setRecord (record: Record, tx: Transaction, shouldInsert: boolean): Promise<Record> {
    interface KV {
      key: string;
      value: number|string;
    }
    log('SQLiteCache', '_setRecord called for', record);
    const { id, type, attributes, keys } = record;
    const model = this.schema.getModel(type);
    const kv: KV[] = Object.keys(attributes).map((key: string) => ({ key, value: attributes[key] }));
    kv.push({ key: '__keys__', value: keys ? JSON.stringify(keys) : null });
    log(model.attributes);
    if (shouldInsert) {
      kv.unshift({ key: 'id', value: id });
      const placeholder = Array(kv.length).fill('?');
      await tx.executeSql(`INSERT INTO ${type}(${kv.map(({key}) => key).join(', ')}) VALUES(${placeholder.join(', ')})`, kv.map(({value}) => value));
    }
    else {
      const values = kv.map(({value}) => value);
      values.push(id);
      await tx.executeSql(`UPDATE ${type} SET ${kv.map(({key}) => `${key}=?`).join(', ')} WHERE id=?`, values);
    }
    return record;
  }

  async setRecordAsync (record: Record): Promise<void> {
    log('SQLiteCache', 'setRecordAsync called for', record);
    await this.openDB()
      .then(async (db: SQLiteDatabase) => {
        const { type, id } = record;
        const [ existingItemRS ] = await db.executeSql(`SELECT id FROM ${type} WHERE id=?`, [id]);
        return db.transaction(async (tx: Transaction) => {
          const rcd = await this._setRecord(record, tx, existingItemRS.rows.length === 0);
          if (this._keyMap) {
            this._keyMap.pushRecord(rcd);
          }
        });
      });
  }

  async setRecordsAsync (records: Record[]): Promise<void> {
    log('SQLiteCache', 'setRecordsAsync called for', records);
    if (records.length > 0) {
      await this.openDB()
        .then(async (db: SQLiteDatabase) => {
          const data = await Promise.all(records.map((record: Record) => {
            const { id, type } = record;
            return db.executeSql(`SELECT id FROM ${type} WHERE id=?`, [id])
              .then(([rs]) => ({ record, shouldInsert: rs.rows.length === 0 }));
          }));
          db.transaction(async (tx: Transaction) => {
            const rcds = await Promise.all(data.map(({ record, shouldInsert }) => this._setRecord(record, tx, shouldInsert)));
            if (this._keyMap) {
              for (const rcd of rcds) {
                this._keyMap.pushRecord(rcd);
              }
            }
          })
        });
    }
  }

  private async _removeRecord (recordIdentity: RecordIdentity, tx: Transaction): Promise<void> {
    log('SQLiteCache', '_removeRecord called for', recordIdentity);
    const { type, id } = recordIdentity;
    await tx.executeSql(`DELETE FROM ${type} WHERE id=?`, [id]);
  }

  async removeRecordAsync (recordIdentity: RecordIdentity): Promise<Record> {
    log('SQLiteCache', 'removeRecordAsync called for', recordIdentity);
    const initialRecord = await this.getRecordAsync(recordIdentity);
    await this.openDB()
      .then((db: SQLiteDatabase) => db.transaction(async (tx: Transaction) => {
        await this._removeRecord(recordIdentity, tx);
      }));
    return initialRecord;
  }

  async removeRecordsAsync (records: RecordIdentity[]): Promise<Record[]> {
    log('SQLiteCache', 'removeRecordsAsync called for', records);
    if (records.length > 0) {
      const initialRecords = await this.getRecordsAsync(records);
      await this.openDB()
        .then((db: SQLiteDatabase) => db.transaction(async (tx: Transaction) => {
          await Promise.all(records.map((record: RecordIdentity) => this._removeRecord(record, tx)));
        }));
      return initialRecords;
    }
    return Promise.resolve([]);
  }

  getInverseRelationshipsAsync (recordIdentity: RecordIdentity):
    Promise<RecordRelationshipIdentity[]> {
    log('SQLiteCache', 'getInverseRelationshipsAsync called for', recordIdentity);
    return new Promise((resolve, reject) => {
      const { type, id } = recordIdentity;
      const record = recordIdentity;
      const relationships = this.schema.getModel(type).relationships;
      if (relationships === undefined) {
        return resolve([]);
      }
      const records: RecordRelationshipIdentity[] = [];
      this.openDB()
        .then((db: SQLiteDatabase) => db.transaction(async (tx: Transaction) => {
          const results = await Promise.all(Object.entries(relationships).map(async ([ name, relationship ]) => {
            const model: string = typeof relationship.model === 'string' ? relationship.model : relationship.model[0];
            const [ , rs ] = await tx.executeSql(
              `SELECT ${model}_id FROM relationships_${type}_${model} WHERE ${type}_id = ?`,
              [ id ]
            );
            const modelRelationships: RecordRelationshipIdentity[] = [];
            if (rs && rs.rows && rs.rows.length) {
              for (let idx = 0; idx < rs.rows.length; idx ++) {
                modelRelationships.push({
                  record,
                  relationship: name,
                  relatedRecord: {
                    type: model,
                    id: rs.rows.item(idx)[`${model}_id`]
                  }
                })
              }
            }
            return modelRelationships;
          }));
          for (const result of results) {
            for (const record of result) {
              records.push(record);
            }
          }
        }))
        .then(() => resolve(records))
        .catch(reject);
    });
  }

  addInverseRelationshipsAsync (relationships: RecordRelationshipIdentity[]): Promise<void> {
    log('SQLiteCache', 'addInverseRelationshipsAsync called for', relationships);
    if (relationships.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.openDB()
        .then((db: SQLiteDatabase) => db.transaction((tx: Transaction) => {
          return Promise.all(relationships.map(({ record, relatedRecord }) => {
            return tx.executeSql(
              `
                INSERT INTO relationships_${record.type}_${relatedRecord.type}
                (${record.type}_id, ${relatedRecord.type}_id)
                VALUES(?, ?)
              `,
              [ record.id, relatedRecord.id ]
            );
          }));
        }))
        .then(() => resolve())
        .catch(reject);
    })
  }

  removeInverseRelationshipsAsync (relationships: RecordRelationshipIdentity[]): Promise<void> {
    log('SQLiteCache', 'removeInverseRelationshipsAsync called for', relationships);
    if (relationships.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.openDB()
        .then((db: SQLiteDatabase) => db.transaction((tx: Transaction) => {
          return Promise.all(relationships.map(({ record, relatedRecord }) => {
            return tx.executeSql(
              `
                DELETE FROM relationships_${record.type}_${relatedRecord.type}
                WHERE ${record.type}_id = ?
                AND ${relatedRecord.type}_id = ?
              `,
              [ record.id, relatedRecord.id ]
            );
          }));
        }))
        .then(() => resolve())
        .catch(reject);
    })
  }

  /////////////////////////////////////////////////////////////////////////////
  // Protected methods
  /////////////////////////////////////////////////////////////////////////////

  protected async _getAllRecords(): Promise<Record[]> {
    log('SQLiteCache', '_getAllRecords called');
    const allRecords: Record[] = [];
    for (const model of Object.keys(this.schema.models)) {
      const records = await this.getRecordsAsync(model);
      for (const record of records) {
        allRecords.push(record);
      }
    }
    return allRecords;
  }
}
