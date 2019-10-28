import Orbit, {
  Record,
  RecordIdentity,
  RecordRelationship
} from '@orbit/data';
import {
  RecordRelationshipIdentity,
  AsyncRecordCache,
  AsyncRecordCacheSettings,
} from '@orbit/record-cache';
import {
  supportsSQLite,
  stripNullFields,
  getDiff,
  isSameIdentity,
  rsToArray,
  EventEmitter
} from './utils';
import SQLite, { SQLiteDatabase, Transaction } from 'react-native-sqlite-storage';
import { Dict } from '@orbit/utils';

const { assert } = Orbit;

const VERSION_TABLE_NAME = '__VERSION__';

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
    assert('Your browser does not support SQLite!', supportsSQLite());

    super(settings);

    this._namespace = settings.namespace || 'sqlite';
    this._location = settings.location || 'default';
    this._dbGenerating = false;
    this._dbAvailableEvent = new EventEmitter();
  }

  get namespace (): string {
    return this._namespace;
  }

  async upgrade (): Promise<void> {
    await this.reopenDB();
    for (let processor of this._processors) {
      await processor.upgrade();
    }
  }

  async reset (): Promise<void> {
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
      const db = await SQLite.openDatabase({ name: this.dbName, location: this.location })
      this._db = db;
      const [ res ] = await db.executeSql(
        `SELECT *
          FROM 'sqlite_master'
          WHERE type=?
          AND name=?`,
        [ 'table', VERSION_TABLE_NAME ]
      );
      if (res.rows.length === 0) {
        await this.createDB(db, newVersion);
      }
      else {
        const [ versions ] = await db.executeSql(
          `SELECT *
            FROM '${VERSION_TABLE_NAME}'`
        );
        const oldVersion = versions.rows.item(0).version;
        if (oldVersion !== newVersion) {
          await this.migrateDB(db, { oldVersion, newVersion });
        }
      }
      this._dbGenerating = false;
      this._dbAvailableEvent.trigger('dbReady');
      return db;
    }
  }

  async closeDB (): Promise<void> {
    if (!!this._db) {
      await this._db.close();
      this._db = undefined;
    }
  }

  async reopenDB (): Promise<SQLiteDatabase> {
    await this.closeDB();
    return this.openDB()
  }

  async createDB (db: SQLiteDatabase, version: number): Promise<void> {
    await db.transaction((tx: Transaction) => {
      tx.executeSql(`CREATE TABLE '${VERSION_TABLE_NAME}'('version' NUMERIC)`);
      this.setVersion(version, tx);
      for (const model of Object.keys(this.schema.models)) {
        this._createModelTable(model, tx);
        this._createRelationshipTables(model, tx);
      }
    });
  }

  async migrateDB (db: SQLiteDatabase, { oldVersion, newVersion }: MigrateDBData): Promise<void> {
    console.error(
      'IndexedDBSource#migrateDB - should be overridden to upgrade SQLiteDatabase from: ',
      oldVersion,
      ' -> ',
      newVersion
    );
  }

  setVersion (version: number, tx: Transaction) {
    tx.executeSql(`DELETE FROM '${VERSION_TABLE_NAME}'`)
    tx.executeSql(
      `INSERT INTO '${VERSION_TABLE_NAME}'
        ('version')
        VALUES(?)`,
      [ version ]
    );
  }

  async deleteDB (): Promise<void> {
    await this.closeDB();
    await SQLite.deleteDatabase({ name: this.dbName, location: this.location });
  }

  // TODO create a single JSON field for the attributes
  private _createModelTable (type: string, tx: Transaction) {
    const { attributes } = this.schema.getModel(type);
    let fieldsQuery: string[] = [];
    if (attributes !== undefined) {
      fieldsQuery = Object.keys(attributes).map((attributeKey: string) => {
        const attributeType = attributes[attributeKey].type;
        switch (attributeType) {
          case 'number':
            return `'${attributeKey}' NUMERIC`;
          default:
            return `'${attributeKey}' TEXT`;
        }
      });
    }
    fieldsQuery.unshift(`'id' TEXT NOT NULL PRIMARY KEY`);
    fieldsQuery.push(`'__keys__' TEXT`);
    tx.executeSql(`CREATE TABLE '${type}'(${fieldsQuery.join(',')})`);
  }

  // TODO It might be possible to create a single table for all the realtionships
  // Structure : source_id, table_name, relation_name, target_id
  private _createRelationshipTables (type: string, tx: Transaction) {
    const { relationships } = this.schema.getModel(type);
    if (relationships !== undefined) {
      for (const relationshipKey of Object.keys(relationships)) {
        const { model } = relationships[relationshipKey];
        tx.executeSql(`CREATE TABLE 'relationships_${type}_${model}'(
          '${type}_id' TEXT NOT NULL,
          '${model}_id' TEXT NOT NULL,
          FOREIGN KEY ('${type}_id')
            REFERENCES '${type}'('id'),
          FOREIGN KEY ('${model}_id')
            REFERENCES '${model}'('id'),
          PRIMARY KEY('${type}_id', '${model}_id')
        )`);
      }
    }
  }

  async clearRecords (type: string): Promise<void> {
    const db = await this.openDB();
    await db.transaction((tx: Transaction) => {
      tx.executeSql(`DELETE FROM '${type}' WHERE 1`);
    });
  }

  private async _parseRecordFromDb (
    input: SQLiteRecord,
    type: string,
    db: SQLiteDatabase
  ): Promise<Record> {
    const attributes = { ...input };
    const id = attributes.id;
    delete attributes.id;
    const keys = attributes.__keys__;
    delete attributes.__keys__;
    const processedAttributes = stripNullFields(attributes);
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
    return record;
  }

  async getRecordAsync (record: RecordIdentity): Promise<Record|undefined> {
    const db = await this.openDB()
    const [ res ] = await db.executeSql(
      `SELECT * FROM '${record.type}' WHERE id=?`,
      [ record.id ]
    )
    if (res.rows.length && res.rows.length === 1) {
      const recordFound = await this._parseRecordFromDb(res.rows.item(0), record.type, db);
      if (this._keyMap) {
        this._keyMap.pushRecord(recordFound);
      }
      return recordFound;
    }
    return undefined;
  }

  async getRecordsAsync (typeOrIdentities?: string|RecordIdentity[]): Promise<Record[]> {
    if (!typeOrIdentities) {
      return this._getAllRecords()
    }
    else if (typeof typeOrIdentities === 'string') {
      const type: string = typeOrIdentities;
      const db = await this.openDB();
      const [ res ] = await db.executeSql(`SELECT * FROM '${type}'`);
      const records: Array<Record> = [];
      for (let idx = 0 ; idx < res.rows.length; idx ++) {
        const record = await this._parseRecordFromDb(res.rows.item(idx), type, db);
        if (this._keyMap) {
          this._keyMap.pushRecord(record);
        }
        records.push(record);
      }
      return records;
    }
    else if (Array.isArray(typeOrIdentities)) {
      const identities: RecordIdentity[] = typeOrIdentities;
      if (identities.length > 0) {
        const db = await this.openDB();
        const records = await Promise.all(identities.map(
          async (identity) => this.getRecordAsync(identity)
        ));
        return records.filter((record?: Record) => record !== undefined)
      }
    }
    return [];
  }

  private _setRecord (
    record: Record,
    tx: Transaction,
    shouldInsert: boolean,
    existingRelationships: Dict<RecordRelationship>
  ): Record {
    interface KV {
      key: string;
      value: number|string;
    }
    const { id, type, attributes, keys, relationships } = record;
    const kv: KV[] = (attributes === undefined) ?
      [] :
      Object.keys(attributes).map((key: string) => ({ key, value: attributes[key] }));
    if (keys) {
      kv.push({ key: '__keys__', value: keys ? JSON.stringify(keys) : null });
    }
    if (shouldInsert) {
      kv.unshift({ key: 'id', value: id });
      const placeholder = Array(kv.length).fill('?');
      tx.executeSql(
        `INSERT INTO '${type}'
        (${kv.map(({key}) => `'${key}'`).join(', ')})
        VALUES(${placeholder.join(', ')})`,
        kv.map(({value}) => value)
      );
    }
    else {
      if (kv.length > 0) {
        const values = kv.map(({value}) => value);
        values.push(id);
        tx.executeSql(
          `UPDATE '${type}'
          SET ${kv.map(({key}) => `'${key}'=?`).join(', ')}
          WHERE id=?`,
          values
        );
      }
    }
    if (relationships !== undefined) {
      const relationshipsToAdd: Dict<RecordRelationship> = {};
      const relationshipsToRemove: Dict<RecordRelationship> = {};
      const model = this.schema.getModel(type)
      for (const [name, recordRelationship] of Object.entries(relationships)) {
        const relationshipType = model.relationships[name].type;
        if (relationshipType === 'hasMany') {
          const existing = existingRelationships[name] ?
                            existingRelationships[name].data as RecordIdentity[] :
                            [];
          const wanted = recordRelationship.data as RecordIdentity[];
          const toAdd = getDiff(wanted, existing, isSameIdentity);
          const toRemove = getDiff(existing, wanted, isSameIdentity);
          if (toAdd.length) {
            relationshipsToAdd[name] = { data: toAdd };
          }
          if (toRemove.length) {
            relationshipsToRemove[name] = { data: toRemove };
          }
        }
        else {
          const existing = existingRelationships[name] ?
                            existingRelationships[name].data as RecordIdentity :
                            undefined;
          const wanted = recordRelationship.data as RecordIdentity|null;
          if (existing === undefined && wanted !== null) {
            relationshipsToAdd[name] = { data: wanted };
          }
          else if (existing !== undefined && wanted === null) {
            relationshipsToRemove[name] = { data: existing };
          }
          else if (existing !== undefined && wanted !== null &&
            !isSameIdentity(existing, wanted)
          ) {
            relationshipsToRemove[name] = { data: existing };
            relationshipsToAdd[name] = { data: wanted };
          }
        }
      }
      for (const [ name, relationship ] of Object.entries(relationshipsToRemove)) {
        const recordIdentitites: RecordIdentity[] = Array.isArray(relationship.data) ?
                                                    relationship.data :
                                                    [relationship.data];
        for (const recordIdentity of recordIdentitites) {
          const { type: relationshipModel, id: relationshipId } = recordIdentity;
          tx.executeSql(
            `DELETE FROM 'relationships_${type}_${relationshipModel}'
            WHERE ${type}_id=? AND ${relationshipModel}_id=?`,
            [ id, relationshipId ]
          )
        }
      }
      for (const [ name, relationship ] of Object.entries(relationshipsToAdd)) {
        const recordIdentitites: RecordIdentity[] = Array.isArray(relationship.data) ?
                                                    relationship.data :
                                                    [relationship.data];
        for (const recordIdentity of recordIdentitites) {
          const { type: relationshipModel, id: relationshipId } = recordIdentity;
          tx.executeSql(
            `INSERT INTO 'relationships_${type}_${relationshipModel}'
            ('${type}_id', '${relationshipModel}_id')
            VALUES (?, ?)`,
            [ id, relationshipId ]
          )
        }
      }
    }
    return record;
  }

  private async _getRelationshipsForRecord (
    record: Record,
    db: SQLiteDatabase
  ): Promise<Dict<RecordRelationship>> {
    const result: Dict<RecordRelationship> = {};
    const potentialRelationships = this.schema.getModel(record.type).relationships;
    if (potentialRelationships !== undefined) {
      await Promise.all(Object.entries(potentialRelationships).map(
        async ([ name, definition ]) => {
          const model: string = typeof definition.model === 'string' ?
                                  definition.model :
                                  definition.model[0];
          const [ res ] = await db.executeSql(
            `SELECT ${model}_id
            FROM 'relationships_${record.type}_${model}'
            WHERE ${record.type}_id=?`,
            [ record.id ]
          );
          const results = rsToArray(res);
          if (results.length > 0) {
            if (definition.type === 'hasMany') {
              const data: RecordIdentity[] = results.map((result) => (
                { type: model, id: result[`${model}_id`] }
              ));
              result[name] = { data };
            }
            else {
              const data = { type: model, id: results[0][`${model}_id`] } as RecordIdentity;
              result[name] = { data }
            }
          }
        }
      ))
    }
    return result;
  }

  async setRecordAsync (record: Record): Promise<void> {
    const db = await this.openDB();
    const { type, id } = record;
    const [ existingItemRS ] = await db.executeSql(
      `SELECT id
      FROM '${type}'
      WHERE id=?`,
      [id]
    );
    const existingRelationships = await this._getRelationshipsForRecord(record, db);
    await db.transaction((tx: Transaction) => {
      this._setRecord(record, tx, existingItemRS.rows.length === 0, existingRelationships);
    });
    const rcd = await this.getRecordAsync(record);
    if (this._keyMap) {
      this._keyMap.pushRecord(rcd);
    }
  }

  async setRecordsAsync (records: Record[]): Promise<void> {
    if (records.length > 0) {
      const db = await this.openDB();
      const recordsToAdd = await Promise.all(records.map(async (record: Record) => {
        const { id, type } = record;
        const [ existingItemRS ] = await db.executeSql(
          `SELECT id
          FROM '${type}'
          WHERE id=?`,
          [id]
        );
        const existingRelationships = await this._getRelationshipsForRecord(record, db);
        return {
          record,
          shouldInsert: existingItemRS.rows.length === 0,
          existingRelationships,
        };
      }));
      await db.transaction((tx: Transaction) => {
        for (const { record, shouldInsert, existingRelationships } of recordsToAdd) {
          this._setRecord(record, tx, shouldInsert, existingRelationships);
        }
      });
      const recordsAdded = await this.getRecordsAsync(recordsToAdd.map(
        ({ record }) => record
      ));
      if (this._keyMap) {
        for (const rcd of recordsAdded) {
          this._keyMap.pushRecord(rcd);
        }
      }
    }
  }

  private _removeRecord (recordIdentity: RecordIdentity, tx: Transaction) {
    const { type, id } = recordIdentity;
    tx.executeSql(
      `DELETE FROM '${type}'
      WHERE id=?`,
      [id]
    );
  }

  async removeRecordAsync (recordIdentity: RecordIdentity): Promise<Record> {
    const initialRecord = await this.getRecordAsync(recordIdentity);
    const db = await this.openDB();
    await db.transaction((tx: Transaction) => {
      this._removeRecord(recordIdentity, tx);
    });
    return initialRecord;
  }

  async removeRecordsAsync (records: RecordIdentity[]): Promise<Record[]> {
    if (records.length > 0) {
      const initialRecords = await this.getRecordsAsync(records);
      const db = await this.openDB()
      await db.transaction((tx: Transaction) => {
        for (const record of records) {
          this._removeRecord(record, tx)
        }
      });
      return initialRecords;
    }
    return [];
  }

  async getInverseRelationshipsAsync (
    recordIdentity: RecordIdentity
  ): Promise<RecordRelationshipIdentity[]> {
    const { type, id } = recordIdentity;
    const record = recordIdentity;
    const relationships = this.schema.getModel(type).relationships;
    if (relationships === undefined) {
      return [];
    }
    const db = await this.openDB();
    const results = await Promise.all(Object.entries(relationships).map(
      async ([ name, relationship ]) => {
        const model: string = typeof relationship.model === 'string' ?
                              relationship.model :
                              relationship.model[0];
        const [ rs ] = await db.executeSql(
          `SELECT ${model}_id
          FROM 'relationships_${model}_${type}'
          WHERE ${type}_id=?`,
          [ id ]
        );
        const results = rsToArray(rs);
        return results.map(
          (result) => ({
            record,
            relationship: name,
            relatedRecord: {
              type: model,
              id: result[`${model}_id`]
            }
          })
        )
      }
    ));
    return results.reduce((prev, curr) => [ ...prev, ...curr ], []);
  }

  async addInverseRelationshipsAsync (
    relationships: RecordRelationshipIdentity[]
  ): Promise<void> {
    if (relationships.length === 0) {
      return ;
    }
    const db = await this.openDB();
    const relationshipsToAdd = (await Promise.all(relationships.map(
      async (relationship: RecordRelationshipIdentity) => {
        const { record, relatedRecord } = relationship;
        const [ res ] = await db.executeSql(
          `SELECT *
          FROM 'relationships_${record.type}_${relatedRecord.type}'
          WHERE ${record.type}_id=?
          AND ${relatedRecord.type}_id=?`,
          [ record.id, relatedRecord.id ]
        );
        if (res.rows.length === 0) {
          return relationship;
        }
        return null;
      }
    ))).filter(r => r !== null);
    if (relationshipsToAdd.length > 0) {
      await db.transaction((tx: Transaction) => {
        for (const { record, relatedRecord } of relationshipsToAdd) {
          tx.executeSql(
            `INSERT INTO 'relationships_${relatedRecord.type}_${record.type}'
            ('${record.type}_id', '${relatedRecord.type}_id')
            VALUES(?, ?)`,
            [ record.id, relatedRecord.id ]
          );
        }
      })
    }
  }

  async removeInverseRelationshipsAsync (
    relationships: RecordRelationshipIdentity[]
  ): Promise<void> {
    if (relationships.length === 0) {
      return ;
    }
    const db = await this.openDB();
    await db.transaction((tx: Transaction) => {
      for (const { record, relatedRecord } of relationships) {
        tx.executeSql(
          `DELETE FROM 'relationships_${relatedRecord.type}_${record.type}'
          WHERE ${record.type}_id=?
          AND ${relatedRecord.type}_id=?`,
          [ record.id, relatedRecord.id ]
        );
      }
    })
  }

  /////////////////////////////////////////////////////////////////////////////
  // Protected methods
  /////////////////////////////////////////////////////////////////////////////

  protected async _getAllRecords(): Promise<Record[]> {
    const allRecords = await Promise.all(Object.keys(this.schema.models).map(
      async (model) => this.getRecordsAsync(model)
    ));
    return allRecords.reduce((prev, curr) => ([ ...prev, ...curr ]), [])
  }
}
