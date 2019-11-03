import { Schema, Record, RecordRelationship, ModelDefinition, RecordIdentity } from "@orbit/data";
import SQLite, { Transaction, SQLiteDatabase } from 'react-native-sqlite-storage';
import { Dict } from "@orbit/utils";


const createModelTable = (type: string, attributes: any, tx: Transaction) => {
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

const createRelationshipTables = (type: string, relationships: any, tx: Transaction) => {
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

const createDBForSchema = async (schema: Schema) => {
  const VERSION_TABLE_NAME = '__VERSION__';
  const db = await SQLite.openDatabase({ name: 'sqlite', location: 'default' });
  await db.transaction((tx: Transaction) => {
    tx.executeSql(`CREATE TABLE '${VERSION_TABLE_NAME}'('version' NUMERIC)`);
    tx.executeSql(`DELETE FROM '${VERSION_TABLE_NAME}'`)
    tx.executeSql(
      `INSERT INTO '${VERSION_TABLE_NAME}'
        ('version')
        VALUES(?)`,
      [ schema.version ]
    );
    for (const [ model, data ] of Object.entries(schema.models)) {
      createModelTable(model, data.attributes, tx);
      createRelationshipTables(model, data.relationships, tx);
    }
  });
  return db;
};

const _setRecord = (
  record: Record,
  tx: Transaction,
  model: ModelDefinition
): Record => {
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
  kv.unshift({ key: 'id', value: id });
  const placeholder = Array(kv.length).fill('?');
  tx.executeSql(
    `INSERT INTO '${type}'
    (${kv.map(({key}) => `'${key}'`).join(', ')})
    VALUES(${placeholder.join(', ')})`,
    kv.map(({value}) => value)
  );
  if (relationships !== undefined) {
    const relationshipsToAdd: Dict<RecordRelationship> = {};
    for (const [name, recordRelationship] of Object.entries(relationships)) {
      const relationshipType = model.relationships[name].type;
      if (relationshipType === 'hasMany') {
        const wanted = recordRelationship.data as RecordIdentity[];
        if (wanted.length) {
          relationshipsToAdd[name] = { data: wanted };
        }
      }
      else {
        const wanted = recordRelationship.data as RecordIdentity|null;
        if (wanted !== null) {
          relationshipsToAdd[name] = { data: wanted };
        }
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

const insertRecords = async (records: Record[], schema: Schema, db: SQLiteDatabase): Promise<void> => {
  if (records.length > 0) {
    await db.transaction((tx: Transaction) => {
      for (const record of records) {
        const model = schema.getModel(record.type);
        _setRecord(record, tx, model);
      }
    });
  }
}

export default {
  createDBForSchema,
  insertRecords,
}