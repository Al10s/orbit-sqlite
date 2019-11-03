import Orbit, {
  Record,
  RecordIdentity,
  RecordRelationship,
} from '@orbit/data';
import {
  RecordRelationshipIdentity,
  AsyncRecordCache,
  AsyncRecordCacheSettings,
} from '@orbit/record-cache';
import {
  supportsSQLite,
  stripNullFields,
  rsToArray,
  EventEmitter
} from './utils';
import SQLite, { SQLiteDatabase, Transaction } from 'react-native-sqlite-storage';
import { Dict } from '@orbit/utils';

const { assert } = Orbit;

const VERSION_TABLE_NAME = '__VERSION__';
const INTERNAL_VERSION_TABLE_NAME = '__RN_ORBIT_SQLITE_VERSION__';
const RELATIONSHIPS_TABLE_NAME = '__RELATIONSHIPS__';
const ID_FIELD_NAME = 'id';
const ATTRIBUTES_FIELD_NAME = 'attributes';
const KEYS_FIELD_NAME = 'keys';

export const VERSION = 2;

export type SQLiteDBLocation = 'default'|'Documents'|'Library'

export interface SQLiteRecord {
  id: string;
  attributes: any,
  keys: any;
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
        const [ res ] = await db.executeSql(
          `SELECT *
            FROM 'sqlite_master'
            WHERE type=?
            AND name=?`,
          [ 'table', INTERNAL_VERSION_TABLE_NAME ]
        );
        let currentInternalVersion = 0;
        if (res.rows.length !== 0) {
          const [ versions ] = await db.executeSql(
            `SELECT *
              FROM '${INTERNAL_VERSION_TABLE_NAME}'`
          );
          currentInternalVersion = versions.rows.item(0).version;
        }

        if (currentInternalVersion < VERSION) {
          await this._migrateDBInternalFrom(currentInternalVersion, db);
        }

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
      tx.executeSql(`CREATE TABLE '${INTERNAL_VERSION_TABLE_NAME}'('version' NUMERIC)`);
      this._setInternalVersion(VERSION, tx);
      this._createRelationshipTables(tx);
      for (const model of Object.keys(this.schema.models)) {
        this._createModelTable(model, tx);
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

  async _migrateDBInternalTo1 (db: SQLiteDatabase) {
    interface SQLiteRecordV1 {
      id: string;
      attributes: any,
      keys: any;
    }
    const existingData: Dict<SQLiteRecordV1[]> = {};
    for (const model of Object.keys(this.schema.models)) {
      const [ res ] = await db.executeSql(`SELECT * FROM '${model}'`);
      const content = rsToArray(res);
      existingData[model] = content.map((item) => {
        const { id, __keys__, ...attributes } = item;
        return { id, attributes: JSON.stringify(stripNullFields(attributes)), keys: __keys__ };
      })
    }
    await db.transaction((tx: Transaction) => {
      for (const [ model, items ] of Object.entries(existingData)) {
        tx.executeSql(`DROP TABLE '${model}'`);
        this._createModelTable(model, tx);
        for (const { id, attributes, keys } of items) {
          tx.executeSql(
            `INSERT INTO '${model}'
            ('id', 'attributes', 'keys')
            VALUES (?, ?, ?)`,
            [ id, attributes, keys ]
          );
        }
      }
      tx.executeSql(`CREATE TABLE '${INTERNAL_VERSION_TABLE_NAME}'('version' NUMERIC)`);
      this._setInternalVersion(1, tx);
    });
  }

  async _migrateDBInternalTo2 (db: SQLiteDatabase) {
    interface RelationshipsV2 {
      source_id: string;
      source_table: string;
      relation_name: string;
      target_id: string;
      target_table: string;
    }
    const relationshipsToInsert: RelationshipsV2[] = [];
    for (const [ modelName, model ] of Object.entries(this.schema.models)) {
      if (model.relationships) {
        for (const [ name, relationship ] of Object.entries(model.relationships)) {
          const [ rels ] = await db.executeSql(`SELECT * FROM relationships_${modelName}_${relationship.model}`);
          const previousRelationships = rsToArray(rels);
          for (const previousRelationship of previousRelationships) {
            relationshipsToInsert.push({
              source_id: previousRelationship[`${modelName}_id`],
              source_table: modelName,
              relation_name: name,
              target_id: previousRelationship[`${relationship.model}_id`],
              target_table: relationship.model as string,
            });
          }
        }
      }
    }
    const [ tbl ] = await db.executeSql(`SELECT name FROM 'sqlite_master' WHERE type=? AND name LIKE ? ESCAPE ?`, [ 'table', 'relationships/_%/_%', '/' ]);
    const tableNamesToDrop: string[] = rsToArray(tbl).map((data) => data.name);
    await db.transaction((tx: Transaction) => {
      for (const tableNameToDrop of tableNamesToDrop) {
        tx.executeSql(`DROP TABLE ${tableNameToDrop}`);
      }
      this._createRelationshipTables(tx);
      for (const { source_id, source_table, relation_name, target_id, target_table } of relationshipsToInsert) {
        tx.executeSql(
          `INSERT INTO '${RELATIONSHIPS_TABLE_NAME}'
          ('source_id', 'source_table', 'relation_name', 'target_id', 'target_table')
          VALUES(?, ?, ?, ?, ?)`,
          [ source_id, source_table, relation_name, target_id, target_table ]
        )
      }
      this._setInternalVersion(2, tx);
    });
  }

  async _migrateDBInternalFrom (currentInternalVersion: number, db: SQLiteDatabase) {
    if (currentInternalVersion < 1) {
      await this._migrateDBInternalTo1(db);
    }
    if (currentInternalVersion < 2) {
      await this._migrateDBInternalTo2(db);
    }
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

  _setInternalVersion (version: number, tx: Transaction) {
    tx.executeSql(`DELETE FROM '${INTERNAL_VERSION_TABLE_NAME}'`)
    tx.executeSql(
      `INSERT INTO '${INTERNAL_VERSION_TABLE_NAME}'
        ('version')
        VALUES(?)`,
      [ version ]
    );
  }

  async deleteDB (): Promise<void> {
    await this.openDB();
    await this.closeDB();
    await SQLite.deleteDatabase({ name: this.dbName, location: this.location });
  }

  private _createModelTable (type: string, tx: Transaction) {
    let fieldsQuery: string[] = [
      `'${ID_FIELD_NAME}' TEXT NOT NULL PRIMARY KEY`,
      `'${ATTRIBUTES_FIELD_NAME}' TEXT`,
      `'${KEYS_FIELD_NAME}' TEXT`,
    ];
    tx.executeSql(`CREATE TABLE '${type}'(${fieldsQuery.join(',')})`);
  }

  private _createRelationshipTables (tx: Transaction) {
    tx.executeSql(`CREATE TABLE '${RELATIONSHIPS_TABLE_NAME}'(
      'source_id' TEXT NOT NULL,
      'source_table' TEXT NOT NULL,
      'relation_name' TEXT NOT NULL,
      'target_id' TEXT,
      'target_table' TEXT,
      PRIMARY KEY('source_id', 'source_table', 'relation_name', 'target_id', 'target_table')
    )`);
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
    const id = input[ID_FIELD_NAME];
    let attributes = {};
    let keys = {};

    try {
      attributes = JSON.parse(input[ATTRIBUTES_FIELD_NAME]);
    }
    catch (e) {}
    try {
      keys = JSON.parse(input[KEYS_FIELD_NAME]);
    }
    catch (e) {}

    const record: Record = { type, id };
    if (attributes && Object.keys(attributes).length) {
      record.attributes = attributes;
    }
    if (keys && Object.keys(keys).length) {
      record.keys = keys;
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
      `SELECT * FROM '${record.type}' WHERE ${ID_FIELD_NAME}=?`,
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
  ): Record {
    interface KV {
      key: string;
      value: number|string;
    }
    const { id, type, attributes, keys, relationships } = record;
    const kv: KV[] = (attributes === undefined) ?
      [] :
      [{ key: ATTRIBUTES_FIELD_NAME, value: JSON.stringify(attributes) }];
    if (keys) {
      kv.push({ key: KEYS_FIELD_NAME, value: keys ? JSON.stringify(keys) : null });
    }
    if (shouldInsert) {
      kv.unshift({ key: ID_FIELD_NAME, value: id });
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
          WHERE ${ID_FIELD_NAME}=?`,
          values
        );
      }
    }
    tx.executeSql(
      `DELETE FROM ${RELATIONSHIPS_TABLE_NAME}
      WHERE source_id=?
      AND source_table=?`,
      [ id, type ]
    );
    if (relationships !== undefined) {
      for (const [name, recordRelationship] of Object.entries(relationships)) {
        if (recordRelationship.data !== undefined) {
          if (Array.isArray(recordRelationship.data)) {
            for (const rel of recordRelationship.data) {
              tx.executeSql(
                `INSERT INTO '${RELATIONSHIPS_TABLE_NAME}'
                ('source_id', 'source_table', 'relation_name', 'target_id', 'target_table')
                VALUES(?, ?, ?, ?, ?)`,
                [ id, type, name, rel.id, rel.type ]
              )
            }
          }
          else if (recordRelationship.data !== null) {
            const rel = recordRelationship.data;
            tx.executeSql(
              `INSERT INTO '${RELATIONSHIPS_TABLE_NAME}'
              ('source_id', 'source_table', 'relation_name', 'target_id', 'target_table')
              VALUES(?, ?, ?, ?, ?)`,
              [ id, type, name, rel.id, rel.type ]
            )
          }
          else {
            tx.executeSql(
              `INSERT INTO '${RELATIONSHIPS_TABLE_NAME}'
              ('source_id', 'source_table', 'relation_name', 'target_id', 'target_table')
              VALUES(?, ?, ?, ?, ?)`,
              [ id, type, name, null, null ]
            )
          }
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
      const [ res ] = await db.executeSql(
        `SELECT relation_name, target_id, target_table
        FROM '${RELATIONSHIPS_TABLE_NAME}'
        WHERE source_id=? AND source_table=?`,
        [ record.id, record.type ]
      );
      const results = rsToArray(res);
      for (const [ name, definition ] of Object.entries(potentialRelationships)) {
        const data: RecordIdentity[] = results
          .filter((result) => result.relation_name === name)
          .map((result) => ({ type: result.target_table, id: result.target_id }));
        if (data.length) {
          if (definition.type === 'hasMany') {
            result[name] = { data };
          }
          else {
            const effectiveData = data[0];
            if (effectiveData.id === null) {
              result[name] = { data: null };
            }
            else {
              result[name] = { data: effectiveData };
            }
          }
        }
      }
    }
    return result;
  }

  async setRecordAsync (record: Record): Promise<void> {
    const db = await this.openDB();
    const { type, id } = record;
    const [ existingItemRS ] = await db.executeSql(
      `SELECT ${ID_FIELD_NAME}
      FROM '${type}'
      WHERE ${ID_FIELD_NAME}=?`,
      [id]
    );
    await db.transaction((tx: Transaction) => {
      this._setRecord(record, tx, existingItemRS.rows.length === 0);
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
          `SELECT ${ID_FIELD_NAME}
          FROM '${type}'
          WHERE ${ID_FIELD_NAME}=?`,
          [id]
        );
        return {
          record,
          shouldInsert: existingItemRS.rows.length === 0,
        };
      }));
      await db.transaction((tx: Transaction) => {
        for (const { record, shouldInsert } of recordsToAdd) {
          this._setRecord(record, tx, shouldInsert);
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
      WHERE ${ID_FIELD_NAME}=?`,
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
    const [ rs ] = await db.executeSql(
      `SELECT relation_name, source_id, source_table
      FROM '${RELATIONSHIPS_TABLE_NAME}'
      WHERE target_id=? AND target_table=?`,
      [ id, type ]
    );
    const results = rsToArray(rs);
    return results.map(
      (result) => ({
        record,
        relationship: result.relation_name,
        relatedRecord: {
          type: result.source_table,
          id: result.source_id,
        }
      })
    )
  }

  async addInverseRelationshipsAsync (
    relationships: RecordRelationshipIdentity[]
  ): Promise<void> {
    if (relationships.length === 0) {
      return ;
    }
    const db = await this.openDB();
    await db.transaction((tx: Transaction) => {
      for (const { record, relationship, relatedRecord } of relationships) {
        tx.executeSql(
          `INSERT INTO '${RELATIONSHIPS_TABLE_NAME}'
          ('source_id', 'source_table', 'relation_name', 'target_id', 'target_table')
          VALUES(?, ?, ?, ?, ?)`,
          [ relatedRecord.id, relatedRecord.type, relationship, record.id, record.type ]
        );
      }
    })
  }

  async removeInverseRelationshipsAsync (
    relationships: RecordRelationshipIdentity[]
  ): Promise<void> {
    if (relationships.length === 0) {
      return ;
    }
    const db = await this.openDB();
    await db.transaction((tx: Transaction) => {
      for (const { record, relationship, relatedRecord } of relationships) {
        tx.executeSql(
          `DELETE FROM '${RELATIONSHIPS_TABLE_NAME}'
          WHERE source_id=? AND
          source_table=? AND
          relation_name=? AND
          target_id=? AND
          target_table=?`,
          [ relatedRecord.id, relatedRecord.type, relationship, record.id, record.type ]
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
