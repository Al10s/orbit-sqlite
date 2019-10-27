import { SQLiteCache } from "../../dist";
import { Record } from "@orbit/data";

const stripNull = (input: object): object => {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null) {
      output[key] = value;
    }
  }
  return output;
}

export const getRecordFromSQLiteDB = async (cache: SQLiteCache, record: Record): Promise<Record> => {
  const db = await cache.openDB();
  const [ res ] = await db.executeSql(`SELECT * FROM ${record.type} WHERE id=?`, [ record.id ]);
  const { id, __keys__, ...attributes } = res.rows.item(0);
  const keys = __keys__ ? JSON.parse(__keys__) : undefined;
  return stripNull({
    id,
    type: record.type,
    keys,
    attributes: stripNull(attributes),
    relationships: null, // TODO
    links: null,
    meta: null,
  }) as Record;
}