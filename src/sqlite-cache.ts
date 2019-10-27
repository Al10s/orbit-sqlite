import Orbit, {
  Record,
  RecordIdentity,
  QueryOrExpression,
  RecordOperation,
  TransformBuilderFunc,
  RecordRelationship
} from '@orbit/data';
import {
  RecordRelationshipIdentity,
  AsyncRecordCache,
  AsyncRecordCacheSettings,
  QueryResultData,
  PatchResult
} from '@orbit/record-cache';
import { supportsSQLite, log, logQuery, logMethod } from './utils';
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
    logMethod('SQLiteCache', 'query started', queryOrExpression, options, id);
    await this.openDB();
    return super.query(queryOrExpression, options, id)
    .finally(() => {
      logMethod('SQLiteCache', 'query ended', queryOrExpression, options, id);
    });
  }

  async patch (
    operationOrOperations:
      | RecordOperation
      | RecordOperation[]
      | TransformBuilderFunc
  ): Promise<PatchResult> {
    logMethod('SQLiteCache', 'patch started', operationOrOperations);
    await this.openDB();
    return super.patch(operationOrOperations)
    .finally(() => {
      logMethod('SQLiteCache', 'patch ended', operationOrOperations);
    });
  }

  get namespace (): string {
    return this._namespace;
  }

  async upgrade (): Promise<void> {
    logMethod('SQLiteCache', 'upgrade started');
    await this.reopenDB();
    for (let processor of this._processors) {
      await processor.upgrade();
    }
    logMethod('SQLiteCache', 'upgrade ended');
  }

  async reset (): Promise<void> {
    logMethod('SQLiteCache', 'reset started');
    await this.deleteDB();
    for (let processor of this._processors) {
      await processor.reset();
    }
    logMethod('SQLiteCache', 'reset ended');
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
    logMethod('SQLiteCache', 'openDB called');
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
          logQuery(
            `SELECT * FROM sqlite_master WHERE type=? AND name=?`,
            [ 'table', VERSION_TABLE_NAME ]
          );
          const [ res ] = await db.executeSql(
            `SELECT * FROM sqlite_master WHERE type=? AND name=?`,
            [ 'table', VERSION_TABLE_NAME ]
          );
          if (res.rows.length === 0) {
            log('No version in database.');
            await this.createDB(db, newVersion);
          }
          else {
            logQuery(`SELECT * FROM ${VERSION_TABLE_NAME}`);
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
    logMethod('SQLiteCache', 'closeDB started');
    if (!!this._db) {
      await this._db.close();
      this._db = undefined;
    }
    logMethod('SQLiteCache', 'closeDB ended');
  }

  async reopenDB (): Promise<SQLiteDatabase> {
    logMethod('SQLiteCache', 'reopenDB started');
    await this.closeDB();
    return this.openDB()
    .finally(() => {
      logMethod('SQLiteCache', 'reopenDB ended');
    })
  }

  async createDB (db: SQLiteDatabase, version: number): Promise<void> {
    logMethod('SQLiteCache', 'createDB started');
    await db.transaction((tx: Transaction) => {
      logQuery(`CREATE TABLE ${VERSION_TABLE_NAME}(version NUMERIC)`);
      tx.executeSql(`CREATE TABLE ${VERSION_TABLE_NAME}(version NUMERIC)`);
      logQuery(`INSERT INTO ${VERSION_TABLE_NAME}(version) VALUES(?)`, [ version ]);
      tx.executeSql(`INSERT INTO ${VERSION_TABLE_NAME}(version) VALUES(?)`, [ version ]);
      for (const model of Object.keys(this.schema.models)) {
        this._createModelTable(model, tx);
        this._createRelationshipTables(model, tx);
      }
    });
    logMethod('SQLiteCache', 'createDB ended');
  }

  async migrateDB (db: SQLiteDatabase, { oldVersion, newVersion }: MigrateDBData): Promise<void> {
    logMethod('SQLiteCache', 'migrateDB started');
    console.error(
      'IndexedDBSource#migrateDB - should be overridden to upgrade SQLiteDatabase from: ',
      oldVersion,
      ' -> ',
      newVersion
    );
    logMethod('SQLiteCache', 'migrateDB ended');
  }

  async deleteDB (): Promise<void> {
    logMethod('SQLiteCache', 'deleteDB started');
    await this.closeDB();
    await SQLite.deleteDatabase({ name: this.dbName, location: this.location });
    logMethod('SQLiteCache', 'deleteDB ended');
  }

  private _createModelTable (type: string, tx: Transaction) {
    logMethod('SQLiteCache', '_createModelTable started', type);
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
    logQuery(`CREATE TABLE ${type}(${fieldsQuery.join(',')})`);
    tx.executeSql(`CREATE TABLE ${type}(${fieldsQuery.join(',')})`);
    logMethod('SQLiteCache', '_createModelTable ended', type);
  }

  private _createRelationshipTables (type: string, tx: Transaction) {
    logMethod('SQLiteCache', '_createRelationshipTables started', type);
    const { relationships } = this.schema.getModel(type);
    if (relationships !== undefined) {
      for (const relationshipKey of Object.keys(relationships)) {
        const { model } = relationships[relationshipKey];
        logQuery(`CREATE TABLE relationships_${type}_${model}(
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
    logMethod('SQLiteCache', '_createRelationshipTables ended', type);
  }

  async clearRecords (type: string): Promise<void> {
    logMethod('SQLiteCache', 'clearRecords started', type);
    const db = await this.openDB();
    await db.transaction((tx: Transaction) => {
      logQuery(`DELETE FROM ${type} WHERE 1`)
      tx.executeSql(`DELETE FROM ${type} WHERE 1`);
    });
    logMethod('SQLiteCache', 'clearRecords ended', type);
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

  private async _parseRecordFromDb (input: SQLiteRecord, type: string, db: SQLiteDatabase): Promise<Record> {
    logMethod('SQLiteCache', '_parseRecordFromDb started', input, type);
    const attributes = { ...input };
    const id = attributes.id;
    delete attributes.id;
    const keys = attributes.__keys__;
    delete attributes.__keys__;
    const processedAttributes = this._stripNull(attributes);
    const record: Record = { type, id };
    if (Object.keys(processedAttributes).length) {
      record.attributes = processedAttributes;
    }
    if (keys) {
      record.keys = JSON.parse(keys);
    }
    const relationships = await this._getRelationshipsForRecord(record, db);
    if (Object.keys(relationships).length) {
      record.relationships = relationships;
    }
    logMethod('SQLiteCache', '_parseRecordFromDb ended', input, type);
    return record;
  }

  async getRecordAsync (record: RecordIdentity): Promise<Record|undefined> {
    logMethod('SQLiteCache', 'getRecordAsync started', record);
    const db = await this.openDB()
    logQuery(`SELECT * FROM ${record.type} WHERE id=?`, [ record.id ]);
    const [ res ] = await db.executeSql(`SELECT * FROM ${record.type} WHERE id=?`, [ record.id ])
    log('SQLiteCache', 'getRecordAsync query done', res);
    if (res.rows.length && res.rows.length === 1) {
      const recordFound = await this._parseRecordFromDb(res.rows.item(0), record.type, db);
      if (this._keyMap) {
        this._keyMap.pushRecord(recordFound);
      }
      log('SQLiteCache', 'getRecordAsync resolving with', recordFound);
      logMethod('SQLiteCache', 'getRecordAsync ended', record);
      return recordFound;
    }
    log('SQLiteCache', 'getRecordAsync resolving with', undefined);
    logMethod('SQLiteCache', 'getRecordAsync ended', record);
    return undefined;
  }

  getRecordsAsync (typeOrIdentities?: string|RecordIdentity[]): Promise<Record[]> {
    logMethod('SQLiteCache', 'getRecordsAsync started', typeOrIdentities);
    if (!typeOrIdentities) {
      log('No type or identity provided');
      return this._getAllRecords()
      .finally(() => {
        logMethod('SQLiteCache', 'getRecordsAsync ended', typeOrIdentities);
      })
    }
    else if (typeof typeOrIdentities === 'string') {
      log('String type provided');
      const type: string = typeOrIdentities;
      return new Promise((resolve, reject) => {
        this.openDB()
          .then(async (db: SQLiteDatabase) => {
            logQuery(`SELECT * FROM ${type}`)
            const [ res ] = await db.executeSql(`SELECT * FROM ${type}`);
              log(`fetched ${res.rows.length} record(s) from table`);
              const records: Array<Record> = [];
              for (let idx = 0 ; idx < res.rows.length; idx ++) {
                const record = await this._parseRecordFromDb(res.rows.item(idx), type, db);
                if (this._keyMap) {
                  this._keyMap.pushRecord(record);
                }
                records.push(record);
              }
              log('Records fetched', records);
              logMethod('SQLiteCache', 'getRecordsAsync ended', typeOrIdentities);
              log('SQLiteCache', 'getRecordsAsync resolving with', records);
              return resolve(records);
            })
          .catch(reject);
      });
    }
    else if (Array.isArray(typeOrIdentities)) {
      const identities: RecordIdentity[] = typeOrIdentities;
      if (identities.length > 0) {
        return new Promise((resolve, reject) => {
          this.openDB()
            .then(async (db: SQLiteDatabase) => {
              const records = (await Promise.all(identities.map(async ({ id, type }): Promise<Record|undefined> => {
                logQuery(`SELECT * FROM ${type} WHERE id=?`, [ id ])
                const [ resultSet ] = await db.executeSql(`SELECT * FROM ${type} WHERE id=?`, [ id ]);
                const result = resultSet.rows.item(0);
                if (result) {
                  const record = await this._parseRecordFromDb(result, type, db);
                  if (this._keyMap) {
                    this._keyMap.pushRecord(record);
                  }
                  return record;
                }
              }))).filter((record?: Record) => record !== undefined)
              logMethod('SQLiteCache', 'getRecordsAsync ended', typeOrIdentities);
              log('SQLiteCache', 'getRecordsAsync resolving with', records);
              resolve(records);
            })
            .catch(reject);
        });
      }
      else {
        logMethod('SQLiteCache', 'getRecordsAsync ended', typeOrIdentities);
        return Promise.resolve([]);
      }
    }
    else {
      logMethod('SQLiteCache', 'getRecordsAsync ended', typeOrIdentities);
      return Promise.reject();
    }
  }

  private async _setRecord (record: Record, tx: Transaction, shouldInsert: boolean, existingRelationships: Dict<RecordRelationship>): Promise<Record> {
    logMethod('SQLiteCache', '_setRecord started', record, shouldInsert, existingRelationships);
    interface KV {
      key: string;
      value: number|string;
    }
    const { id, type, attributes, keys, relationships } = record;
    const kv: KV[] = (attributes === undefined) ? [] : Object.keys(attributes).map((key: string) => ({ key, value: attributes[key] }));
    if (keys) {
      kv.push({ key: '__keys__', value: keys ? JSON.stringify(keys) : null });
    }
    if (shouldInsert) {
      kv.unshift({ key: 'id', value: id });
      const placeholder = Array(kv.length).fill('?');
      logQuery(`INSERT INTO ${type}(${kv.map(({key}) => key).join(', ')}) VALUES(${placeholder.join(', ')})`, kv.map(({value}) => value))
      await tx.executeSql(`INSERT INTO ${type}(${kv.map(({key}) => key).join(', ')}) VALUES(${placeholder.join(', ')})`, kv.map(({value}) => value));
    }
    else {
      if (kv.length > 0) {
        const values = kv.map(({value}) => value);
        values.push(id);
        logQuery(`UPDATE ${type} SET ${kv.map(({key}) => `${key}=?`).join(', ')} WHERE id=?`, values)
        await tx.executeSql(`UPDATE ${type} SET ${kv.map(({key}) => `${key}=?`).join(', ')} WHERE id=?`, values);
      }
    }
    if (relationships !== undefined) {
      const relationshipsToAdd: Dict<RecordRelationship> = {};
      const model = this.schema.getModel(type)
      for (const [name, recordRelationship] of Object.entries(relationships)) {
        const relationshipType = model.relationships[name].type;
        if (relationshipType === 'hasMany') {
          const existing = existingRelationships[name] ? existingRelationships[name].data as RecordIdentity[] : [];
          const recordIdentitiesToAdd: RecordIdentity[] =
            (recordRelationship.data as RecordIdentity[])
              .filter((recordIdentity: RecordIdentity) => {
                return existing.filter((existingIdentity: RecordIdentity) => (
                  existingIdentity.id !== recordIdentity.id ||
                  existingIdentity.type !== recordIdentity.type
                )).length === 0;
              })
          if (recordIdentitiesToAdd.length) {
            relationshipsToAdd[name] = { data: recordIdentitiesToAdd };
          }
        }
        else {
          const existing = existingRelationships[name] ? existingRelationships[name].data as RecordIdentity : undefined;
          const recordIdentity = recordRelationship.data as RecordIdentity;
          if (existing === undefined || existing.id !== recordIdentity.id || existing.type !== recordIdentity.type ) {
            relationshipsToAdd[name] = recordRelationship;
          }
        }
      }
      await Promise.all(Object.entries(relationshipsToAdd).map(async ([ name, relationship ]): Promise<void> => {
        const data: RecordIdentity[] = Array.isArray(relationship.data) ? relationship.data : [relationship.data];
        for (const {type: relationshipModel, id: relationshipId} of data) {
          logQuery(
            `INSERT INTO relationships_${type}_${relationshipModel} (${type}_id, ${relationshipModel}_id) VALUES (?, ?)`,
            [ id, relationshipId ]
          );
          await tx.executeSql(
            `INSERT INTO relationships_${type}_${relationshipModel} (${type}_id, ${relationshipModel}_id) VALUES (?, ?)`,
            [ id, relationshipId ]
          )
        }
      }))
    }
    logMethod('SQLiteCache', '_setRecord ended', record, shouldInsert, existingRelationships);
    return record;
  }

  private async _getRelationshipsForRecord (record: Record, db: SQLiteDatabase): Promise<Dict<RecordRelationship>> {
    logMethod('SQLiteCache', '_getRelationshipsForRecord started', record);
    const result: Dict<RecordRelationship> = {};
    const potentialRelationships = this.schema.getModel(record.type).relationships;
    if (potentialRelationships !== undefined) {
      await Promise.all(Object.entries(potentialRelationships).map(async ([ name, definition ]) => {
        const model: string = typeof definition.model === 'string' ? definition.model : definition.model[0];
        logQuery(
          `SELECT ${model}_id FROM relationships_${model}_${record.type} WHERE ${record.type}_id=?`,
          [ record.id ]
        )
        const [ res ] = await db.executeSql(
          `SELECT ${model}_id FROM relationships_${model}_${record.type} WHERE ${record.type}_id=?`,
          [ record.id ]
        );
        if (definition.type === 'hasMany') {
          if (res.rows.length > 0) {
            const data: RecordIdentity[] = [];
            for (let i = 0; i < res.rows.length; i ++) {
              data.push({ type: model, id: res.rows.item(i)[`${model}_id`] });
            }
            result[name] = { data };
          }
        }
        else {
          if (res.rows.length > 0) {
            const data = { type: model, id: res.rows.item(0)[`${model}_id`] } as RecordIdentity;
            result[name] = { data }
          }
        }
      }))
    }
    logMethod('SQLiteCache', '_getRelationshipsForRecord ended', record);
    return result;
  }

  async setRecordAsync (record: Record): Promise<void> {
    logMethod('SQLiteCache', 'setRecordAsync started', record);
    await this.openDB()
      .then(async (db: SQLiteDatabase) => {
        const { type, id } = record;
        logQuery(`SELECT id FROM ${type} WHERE id=?`, [id])
        const [ existingItemRS ] = await db.executeSql(`SELECT id FROM ${type} WHERE id=?`, [id]);
        const existingRelationships = await this._getRelationshipsForRecord(record, db);
        await db.transaction(async (tx: Transaction) => {
          const rcd = await this._setRecord(record, tx, existingItemRS.rows.length === 0, existingRelationships);
          if (this._keyMap) {
            this._keyMap.pushRecord(rcd);
          }
        });
      });
    logMethod('SQLiteCache', 'setRecordAsync ended', record);
  }

  async setRecordsAsync (records: Record[]): Promise<void> {
    logMethod('SQLiteCache', 'setRecordsAsync started', records);
    if (records.length > 0) {
      await this.openDB()
        .then(async (db: SQLiteDatabase) => {
          const data = await Promise.all(records.map(async (record: Record) => {
            const { id, type } = record;
            logQuery(`SELECT id FROM ${type} WHERE id=?`, [id])
            const [ existingItemRS ] = await db.executeSql(`SELECT id FROM ${type} WHERE id=?`, [id]);
            const existingRelationships = await this._getRelationshipsForRecord(record, db);
            return {
              record,
              shouldInsert: existingItemRS.rows.length === 0,
              existingRelationships,
            };
          }));
          await db.transaction(async (tx: Transaction) => {
            const rcds = await Promise.all(data.map(async ({ record, shouldInsert, existingRelationships }) => {
              return await this._setRecord(record, tx, shouldInsert, existingRelationships);
            }));
            if (this._keyMap) {
              for (const rcd of rcds) {
                this._keyMap.pushRecord(rcd);
              }
            }
          })
        });
    }
    logMethod('SQLiteCache', 'setRecordsAsync ended', records);
  }

  private async _removeRecord (recordIdentity: RecordIdentity, tx: Transaction): Promise<void> {
    logMethod('SQLiteCache', '_removeRecord started', recordIdentity);
    const { type, id } = recordIdentity;
    logQuery(`DELETE FROM ${type} WHERE id=?`, [id]);
    await tx.executeSql(`DELETE FROM ${type} WHERE id=?`, [id]);
    logMethod('SQLiteCache', '_removeRecord ended', recordIdentity);
  }

  async removeRecordAsync (recordIdentity: RecordIdentity): Promise<Record> {
    logMethod('SQLiteCache', 'removeRecordAsync started', recordIdentity);
    const initialRecord = await this.getRecordAsync(recordIdentity);
    await this.openDB()
      .then((db: SQLiteDatabase) => db.transaction(async (tx: Transaction) => {
        await this._removeRecord(recordIdentity, tx);
      }));
    logMethod('SQLiteCache', 'removeRecordAsync ended', recordIdentity);
    return initialRecord;
  }

  async removeRecordsAsync (records: RecordIdentity[]): Promise<Record[]> {
    logMethod('SQLiteCache', 'removeRecordsAsync started', records);
    if (records.length > 0) {
      const initialRecords = await this.getRecordsAsync(records);
      await this.openDB()
        .then((db: SQLiteDatabase) => db.transaction(async (tx: Transaction) => {
          await Promise.all(records.map((record: RecordIdentity) => this._removeRecord(record, tx)));
        }));
      logMethod('SQLiteCache', 'removeRecordsAsync ended', records);
      return initialRecords;
    }
    logMethod('SQLiteCache', 'removeRecordsAsync ended', records);
    return Promise.resolve([]);
  }

  getInverseRelationshipsAsync (recordIdentity: RecordIdentity):
    Promise<RecordRelationshipIdentity[]> {
    logMethod('SQLiteCache', 'getInverseRelationshipsAsync started', recordIdentity);
    return new Promise((resolve, reject) => {
      const { type, id } = recordIdentity;
      const record = recordIdentity;
      const relationships = this.schema.getModel(type).relationships;
      if (relationships === undefined) {
        logMethod('SQLiteCache', 'getInverseRelationshipsAsync ended', recordIdentity);
        return resolve([]);
      }
      const records: RecordRelationshipIdentity[] = [];
      this.openDB()
        .then((db: SQLiteDatabase) => db.transaction(async (tx: Transaction) => {
          const results = await Promise.all(Object.entries(relationships).map(async ([ name, relationship ]) => {
            const model: string = typeof relationship.model === 'string' ? relationship.model : relationship.model[0];
            logQuery(
              `SELECT ${model}_id FROM relationships_${type}_${model} WHERE ${type}_id = ?`,
              [ id ]
            )
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
        .then(() => {
          logMethod('SQLiteCache', 'getInverseRelationshipsAsync ended', recordIdentity);
          resolve(records)
        })
        .catch(reject);
    });
  }

  async addInverseRelationshipsAsync (relationships: RecordRelationshipIdentity[]): Promise<void> {
    logMethod('SQLiteCache', 'addInverseRelationshipsAsync started', relationships);
    if (relationships.length === 0) {
      logMethod('SQLiteCache', 'addInverseRelationshipsAsync ended', relationships);
      return ;
    }
    const db = await this.openDB();
    const relationshipsToAdd = (await Promise.all(relationships.map(async (relationship: RecordRelationshipIdentity) => {
      const { record, relatedRecord } = relationship;
      const [ res ] = await db.executeSql(
        `SELECT * FROM relationships_${record.type}_${relatedRecord.type} WHERE ${record.type}_id=? AND ${relatedRecord.type}_id=?`,
        [ record.id, relatedRecord.id ]
      );
      if (res.rows.length === 0) {
        return relationship;
      }
      return null;
    }))).filter(r => r !== null);
    if (relationshipsToAdd.length > 0) {
      await db.transaction(async (tx: Transaction) => {
        await Promise.all(relationshipsToAdd.map(async ({ record, relatedRecord }) => {
          logQuery(
            `INSERT INTO relationships_${record.type}_${relatedRecord.type} (${record.type}_id, ${relatedRecord.type}_id) VALUES(?, ?)`,
            [ record.id, relatedRecord.id ]
          )
          await tx.executeSql(
            `INSERT INTO relationships_${record.type}_${relatedRecord.type} (${record.type}_id, ${relatedRecord.type}_id) VALUES(?, ?)`,
            [ record.id, relatedRecord.id ]
          );
        }));
      })
    }
  }

  removeInverseRelationshipsAsync (relationships: RecordRelationshipIdentity[]): Promise<void> {
    logMethod('SQLiteCache', 'removeInverseRelationshipsAsync started', relationships);
    if (relationships.length === 0) {
      logMethod('SQLiteCache', 'removeInverseRelationshipsAsync ended', relationships);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.openDB()
        .then((db: SQLiteDatabase) => db.transaction((tx: Transaction) => {
          return Promise.all(relationships.map(({ record, relatedRecord }) => {
            logQuery(
              `DELETE FROM relationships_${record.type}_${relatedRecord.type} WHERE ${record.type}_id = ? AND ${relatedRecord.type}_id = ?`,
              [ record.id, relatedRecord.id ]
            )
            return tx.executeSql(
              `DELETE FROM relationships_${record.type}_${relatedRecord.type} WHERE ${record.type}_id = ? AND ${relatedRecord.type}_id = ?`,
              [ record.id, relatedRecord.id ]
            );
          }));
        }))
        .then(() => {
          logMethod('SQLiteCache', 'removeInverseRelationshipsAsync ended', relationships);
          resolve()
        })
        .catch(reject);
    })
  }

  /////////////////////////////////////////////////////////////////////////////
  // Protected methods
  /////////////////////////////////////////////////////////////////////////////

  protected async _getAllRecords(): Promise<Record[]> {
    logMethod('SQLiteCache', '_getAllRecords started');
    const allRecords: Record[] = [];
    for (const model of Object.keys(this.schema.models)) {
      const records = await this.getRecordsAsync(model);
      for (const record of records) {
        allRecords.push(record);
      }
    }
    logMethod('SQLiteCache', '_getAllRecords ended');
    return allRecords;
  }
}
