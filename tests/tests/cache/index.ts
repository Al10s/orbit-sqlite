import { Test } from '../../utils';
import { Schema, KeyMap, Record } from '@orbit/data';
import { SQLiteCache } from '@al10s/react-native-orbit-sqlite';
import assert from 'assert';

const timeout = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface Context {
  schema: Schema;
  cache: SQLiteCache;
  keyMap: KeyMap;
}

const beforeEach = async () => {
  const schema = new Schema({
    models: {
      planet: {
        keys: { remoteId: {} },
        attributes: {
          name: { type: 'string' },
          classification: { type: 'string' },
          revised: { type: 'boolean' }
        },
        relationships: {
          moons: { type: 'hasMany', model: 'moon', inverse: 'planet' },
          solarSystem: {
            type: 'hasOne',
            model: 'solarSystem',
            inverse: 'planets'
          }
        }
      },
      moon: {
        keys: { remoteId: {} },
        attributes: {
          name: { type: 'string' }
        },
        relationships: {
          planet: { type: 'hasOne', model: 'planet', inverse: 'moons' }
        }
      },
      solarSystem: {
        keys: { remoteId: {} },
        attributes: {
          name: { type: 'string' }
        },
        relationships: {
          planets: {
            type: 'hasMany',
            model: 'planet',
            inverse: 'solarSystem'
          }
        }
      }
    }
  });
  const keyMap = new KeyMap();
  const cache = new SQLiteCache({ schema, keyMap });
  await cache.openDB()
    .then(() => cache.closeDB());
  return {
    schema,
    keyMap,
    cache,
  };
}

const afterEach = async (context: Context) => {
  return context.cache.deleteDB();
}

const runner = (run: (context: Context) => Promise<void>): (() => Promise<void>) => async (): Promise<void> => {
  const context = await beforeEach();
  await run(context);
  await afterEach(context);
}

const getRecordFromSQLiteDB = async (cache: SQLiteCache, record: Record): Promise<Record> => {
  const db = await cache.openDB();
  const [ res ] = await db.executeSql(`SELECT * FROM ${record.type} WHERE id=?`, [ record.id ]);
  const { id, ...attributes } = res.rows.item(0);
  return {
    id: record.id,
    type: record.type,
    keys: undefined,
    attributes,
    relationships: undefined, // TODO
    links: undefined,
    meta: undefined,
  };
}

export const tests: Test[] = [
  {
    label: 'Cache exists',
    run: runner(async (context: Context) => {
      const { cache, schema, keyMap } = context;
      assert.ok(cache, 'cache exists');
      assert.strictEqual(cache.schema, schema, 'schema has been assigned');
      assert.strictEqual(cache.keyMap, keyMap, 'keyMap has been assigned');
    }),
  },
  {
    label: 'Cache is assigned a default dbName',
    run: runner(async (context: Context) => {
      const { cache } = context;
      assert.equal(cache.dbName, 'sqlite', '`dbName` is `sqlite` by default');
    }),
  },
  {
    label: 'Cache: sets/gets records individually',
    run: runner(async (context: Context) => {
      const { cache } = context;
      const jupiter = {
        type: 'planet',
        id: 'jupiter',
        attributes: { name: 'Jupiter' }
      };
      const io = { type: 'moon', id: 'io', attributes: { name: 'Io' } };
      const europa = {
        type: 'moon',
        id: 'europa',
        attributes: { name: 'Europa' }
      };

      await cache.setRecordAsync(jupiter);
      await cache.setRecordAsync(io);
      await cache.setRecordAsync(europa);

      assert.deepEqual(await cache.getRecordAsync(jupiter), jupiter);
      assert.deepEqual(await cache.getRecordAsync(io), io);
      assert.deepEqual(await cache.getRecordAsync(europa), europa);

      await cache.removeRecordAsync(jupiter);
      await cache.removeRecordAsync(io);
      await cache.removeRecordAsync(europa);

      assert.deepEqual(await cache.getRecordAsync(jupiter), undefined);
      assert.deepEqual(await cache.getRecordAsync(io), undefined);
      assert.deepEqual(await cache.getRecordAsync(europa), undefined);
    }),
  },
  {
    label: 'Cache: sets/gets records in bulk',
    run: runner(async (context: Context) => {
      const { cache } = context;
      const jupiter = {
        type: 'planet',
        id: 'jupiter',
        attributes: { name: 'Jupiter' }
      };
      const io = { type: 'moon', id: 'io', attributes: { name: 'Io' } };
      const europa = {
        type: 'moon',
        id: 'europa',
        attributes: { name: 'Europa' }
      };
  
      await cache.openDB();
  
      await cache.setRecordsAsync([jupiter, io, europa]);
  
      assert.deepEqual(await cache.getRecordsAsync([jupiter, io, europa]), [
        jupiter,
        io,
        europa
      ]);
  
      await cache.removeRecordsAsync([jupiter, io, europa]);
  
      assert.deepEqual(await cache.getRecordsAsync([jupiter, io, europa]), []);
    }),
  },
  {
    label: 'Cache: sets/gets inverse relationships',
    run: runner(async (context: Context) => {
      const { cache } = context;
      const jupiter = { type: 'planet', id: 'jupiter' };
      const io = { type: 'moon', id: 'io' };
      const europa = { type: 'moon', id: 'europa' };
      const callisto = { type: 'moon', id: 'callisto' };
  
      await cache.openDB();
  
      assert.deepEqual(
        await cache.getInverseRelationshipsAsync(jupiter),
        [],
        'no inverse relationships to start'
      );
  
      await cache.addInverseRelationshipsAsync([
        { record: jupiter, relationship: 'moons', relatedRecord: io },
        { record: jupiter, relationship: 'moons', relatedRecord: europa },
        { record: jupiter, relationship: 'moons', relatedRecord: callisto }
      ]);
  
      assert.deepEqual(
        await cache.getInverseRelationshipsAsync(jupiter),
        [
          { record: jupiter, relationship: 'moons', relatedRecord: callisto },
          { record: jupiter, relationship: 'moons', relatedRecord: europa },
          { record: jupiter, relationship: 'moons', relatedRecord: io }
        ],
        'inverse relationships have been added'
      );
  
      await cache.removeInverseRelationshipsAsync([
        { record: jupiter, relationship: 'moons', relatedRecord: io },
        { record: jupiter, relationship: 'moons', relatedRecord: europa },
        { record: jupiter, relationship: 'moons', relatedRecord: callisto }
      ]);
  
      assert.deepEqual(
        await cache.getInverseRelationshipsAsync(jupiter),
        [],
        'inverse relationships have been removed'
      );
    }),
  },
  {
    label: 'Cache: #patch - addRecord',
    run: runner(async (context: Context) => {
      const { cache, keyMap } = context;
      let planet: Record = {
        type: 'planet',
        id: 'jupiter',
        keys: {
          remoteId: 'j'
        },
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        }
      };
  
      await cache.patch(t => t.addRecord(planet));

      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, planet),
        planet,
        'sqlitedb contains record'
      );
  
      assert.equal(
        keyMap.keyToId('planet', 'remoteId', 'j'),
        'jupiter',
        'key has been mapped'
      );
    }),
  },
  {
    label: 'Cache: #patch - updateRecord',
    run: runner(async (context: Context) => {
      const { cache, keyMap } = context;
      let original: Record = {
        type: 'planet',
        id: 'jupiter',
        keys: {
          remoteId: 'j'
        },
        attributes: {
          name: 'Jupiter'
        },
        relationships: {
          moons: {
            data: [{ type: 'moon', id: 'moon1' }]
          }
        }
      };
  
      let updates: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          classification: 'gas giant'
        },
        relationships: {
          solarSystem: {
            data: { type: 'solarSystem', id: 'ss1' }
          }
        }
      };
  
      let expected: Record = {
        type: 'planet',
        id: 'jupiter',
        keys: {
          remoteId: 'j'
        },
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          moons: {
            data: [{ type: 'moon', id: 'moon1' }]
          },
          solarSystem: {
            data: { type: 'solarSystem', id: 'ss1' }
          }
        }
      };
  
      await cache.patch(t => t.addRecord(original));
      await cache.patch(t => t.updateRecord(updates));
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, expected),
        expected,
        'sqlitedb contains record'
      );
      assert.equal(
        keyMap.keyToId('planet', 'remoteId', 'j'),
        'jupiter',
        'key has been mapped'
      );
    }),
  },
  {
    label: 'Cache: #patch - updateRecord - when record does not exist',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let revised = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant',
          revised: true
        }
      };
  
      await cache.patch(t => t.updateRecord(revised));
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
    }),
  },
  {
    label: 'Cache: #patch - removeRecord',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let planet: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        }
      };
  
      await cache.patch(t => t.addRecord(planet));
      await cache.patch(t => t.removeRecord(planet));
      assert.equal(
        await getRecordFromSQLiteDB(cache, planet),
        null,
        'sqlitedb does not contain record'
      );
    }),
  },
  {
    label: 'Cache: #patch - removeRecord - when record does not exist',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let planet = {
        type: 'planet',
        id: 'jupiter'
      };
  
      await cache.patch(t => t.removeRecord(planet));
      assert.equal(
        await getRecordFromSQLiteDB(cache, planet),
        null,
        'sqlitedb does not contain record'
      );
    }),
  },
  {
    label: 'Cache: #patch - replaceKey',
    run: runner(async (context: Context) => {
      const { cache, keyMap } = context;
      let original: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        }
      };
  
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        keys: {
          remoteId: '123'
        }
      };
  
      await cache.patch(t => t.addRecord(original));
      await cache.patch(t => t.replaceKey(original, 'remoteId', '123'));
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
  
      assert.equal(
        keyMap.keyToId('planet', 'remoteId', '123'),
        'jupiter',
        'key has been mapped'
      );
    }),
  },
  {
    label: 'Cache: #patch - replaceKey - when base record does not exist',
    run: runner(async (context: Context) => {
      const { cache, keyMap } = context;
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        keys: {
          remoteId: '123'
        }
      };
  
      await cache.patch(t =>
        t.replaceKey({ type: 'planet', id: 'jupiter' }, 'remoteId', '123')
      );
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
  
      assert.equal(
        keyMap.keyToId('planet', 'remoteId', '123'),
        'jupiter',
        'key has been mapped'
      );
    }),
  },
  {
    label: 'Cache: #patch - replaceAttribute - when base record does not exist',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          order: 5
        }
      };
  
      await cache.patch(t =>
        t.replaceAttribute({ type: 'planet', id: 'jupiter' }, 'order', 5)
      );
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
    }),
  },
  {
    label: 'Cache: #patch - addToRelatedRecords',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let original: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          moons: {
            data: []
          }
        }
      };
  
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          moons: {
            data: [{ type: 'moon', id: 'moon1' }]
          }
        }
      };
  
      await cache.patch(t => t.addRecord(original));
      await cache.patch(t =>
        t.addToRelatedRecords(original, 'moons', { type: 'moon', id: 'moon1' })
      );
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
    }),
  },
  {
    label: 'Cache: #patch - addToRelatedRecords - when base record does not exist',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        relationships: {
          moons: {
            data: [{ type: 'moon', id: 'moon1' }]
          }
        }
      };
  
      await cache.patch(t =>
        t.addToRelatedRecords({ type: 'planet', id: 'jupiter' }, 'moons', {
          type: 'moon',
          id: 'moon1'
        })
      );
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
    }),
  },
  {
    label: 'Cache: #patch - removeFromRelatedRecords',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let original: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          moons: {
            data: [{ type: 'moon', id: 'moon1' }, { type: 'moon', id: 'moon2' }]
          }
        }
      };
  
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          moons: {
            data: [{ type: 'moon', id: 'moon1' }]
          }
        }
      };
  
      await cache.patch(t => t.addRecord(original));
      await cache.patch(t =>
        t.removeFromRelatedRecords(original, 'moons', {
          type: 'moon',
          id: 'moon2'
        })
      );
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
    }),
  },
  {
    label: 'Cache: #patch - removeFromRelatedRecords - when base record does not exist',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        relationships: {
          moons: {
            data: []
          }
        }
      };
  
      await cache.patch(t =>
        t.removeFromRelatedRecords({ type: 'planet', id: 'jupiter' }, 'moons', {
          type: 'moon',
          id: 'moon2'
        })
      );
      assert.equal(
        await getRecordFromSQLiteDB(cache, revised),
        null,
        'sqlitedb does not contain record'
      );
    }),
  },
  {
    label: 'Cache: #patch - replaceRelatedRecords',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let original: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          moons: {
            data: [{ type: 'moon', id: 'moon1' }]
          }
        }
      };
  
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          moons: {
            data: [{ type: 'moon', id: 'moon2' }, { type: 'moon', id: 'moon3' }]
          }
        }
      };
  
      await cache.patch(t => t.addRecord(original));
      await cache.patch(t =>
        t.replaceRelatedRecords(original, 'moons', [
          { type: 'moon', id: 'moon2' },
          { type: 'moon', id: 'moon3' }
        ])
      );
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
    }),
  },
  {
    label: 'Cache: #patch - replaceRelatedRecords - when base record does not exist',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        relationships: {
          moons: {
            data: [{ type: 'moon', id: 'moon2' }, { type: 'moon', id: 'moon3' }]
          }
        }
      };
  
      await cache.patch(t =>
        t.replaceRelatedRecords({ type: 'planet', id: 'jupiter' }, 'moons', [
          { type: 'moon', id: 'moon2' },
          { type: 'moon', id: 'moon3' }
        ])
      );
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
    }),
  },
  {
    label: 'Cache: #patch - replaceRelatedRecord - with record',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let original: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          solarSystem: {
            data: null
          }
        }
      };
  
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          solarSystem: {
            data: { type: 'solarSystem', id: 'ss1' }
          }
        }
      };
  
      await cache.patch(t => t.addRecord(original));
      await cache.patch(t =>
        t.replaceRelatedRecord(original, 'solarSystem', {
          type: 'solarSystem',
          id: 'ss1'
        })
      );
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
    }),
  },
  {
    label: 'Cache: #patch - replaceRelatedRecord - with record - when base record does not exist',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        relationships: {
          solarSystem: {
            data: { type: 'solarSystem', id: 'ss1' }
          }
        }
      };
  
      await cache.patch(t =>
        t.replaceRelatedRecord({ type: 'planet', id: 'jupiter' }, 'solarSystem', {
          type: 'solarSystem',
          id: 'ss1'
        })
      );
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
    }),
  },
  {
    label: 'Cache: #patch - replaceRelatedRecord - with null',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let original: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          solarSystem: {
            data: { type: 'solarSystem', id: 'ss1' }
          }
        }
      };
  
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          solarSystem: {
            data: null
          }
        }
      };
  
      await cache.patch(t => t.addRecord(original));
      await cache.patch(t =>
        t.replaceRelatedRecord(original, 'solarSystem', null)
      );
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
    }),
  },
  {
    label: 'Cache: #patch - replaceRelatedRecord - with null - when base record does not exist',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let revised: Record = {
        type: 'planet',
        id: 'jupiter',
        relationships: {
          solarSystem: {
            data: null
          }
        }
      };
  
      await cache.patch(t =>
        t.replaceRelatedRecord(
          { type: 'planet', id: 'jupiter' },
          'solarSystem',
          null
        )
      );
      assert.deepEqual(
        await getRecordFromSQLiteDB(cache, revised),
        revised,
        'sqlitedb contains record'
      );
    }),
  },
  {
    label: 'Cache: #query - all records',
    run: runner(async (context: Context) => {
      const { cache, keyMap } = context;
      let earth: Record = {
        type: 'planet',
        id: 'earth',
        keys: {
          remoteId: 'p1'
        },
        attributes: {
          name: 'Earth',
          classification: 'terrestrial'
        }
      };
  
      let jupiter: Record = {
        type: 'planet',
        id: 'jupiter',
        keys: {
          remoteId: 'p2'
        },
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        }
      };
  
      let io: Record = {
        type: 'moon',
        id: 'io',
        keys: {
          remoteId: 'm1'
        },
        attributes: {
          name: 'Io'
        }
      };
  
      await cache.patch(t => [
        t.addRecord(earth),
        t.addRecord(jupiter),
        t.addRecord(io)
      ]);
  
      // reset keyMap to verify that querying records also adds keys
      keyMap.reset();
  
      let records = await cache.query(q => q.findRecords());
      assert.deepEqual(
        records,
        [io, earth, jupiter],
        'query results are expected'
      );
  
      assert.equal(
        keyMap.keyToId('planet', 'remoteId', 'p1'),
        'earth',
        'key has been mapped'
      );
      assert.equal(
        keyMap.keyToId('planet', 'remoteId', 'p2'),
        'jupiter',
        'key has been mapped'
      );
      assert.equal(
        keyMap.keyToId('moon', 'remoteId', 'm1'),
        'io',
        'key has been mapped'
      );
    }),
  },
  {
    label: 'Cache: #query - records of one type',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let earth: Record = {
        type: 'planet',
        id: 'earth',
        attributes: {
          name: 'Earth',
          classification: 'terrestrial'
        }
      };
  
      let jupiter: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        }
      };
  
      let io: Record = {
        type: 'moon',
        id: 'io',
        attributes: {
          name: 'Io'
        }
      };
  
      await cache.patch(t => [
        t.addRecord(earth),
        t.addRecord(jupiter),
        t.addRecord(io)
      ]);
  
      let records = await cache.query(q => q.findRecords('planet'));
      assert.deepEqual(records, [earth, jupiter], 'query results are expected');
    }),
  },
  {
    label: 'Cache: #query - records by identity',
    run: runner(async (context: Context) => {
      const { cache } = context;
      let earth: Record = {
        type: 'planet',
        id: 'earth',
        attributes: {
          name: 'Earth',
          classification: 'terrestrial'
        }
      };
  
      let jupiter: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        }
      };
  
      let io: Record = {
        type: 'moon',
        id: 'io',
        attributes: {
          name: 'Io'
        }
      };
  
      await cache.patch(t => [
        t.addRecord(earth),
        t.addRecord(jupiter),
        t.addRecord(io)
      ]);
  
      let records = await cache.query(q =>
        q.findRecords([earth, io, { type: 'planet', id: 'FAKE' }])
      );
      assert.deepEqual(records, [earth, io], 'only matches are returned');
    }),
  },
  {
    label: 'Cache: #query - a specific record',
    run: runner(async (context: Context) => {
      const { cache, keyMap } = context;
      let earth: Record = {
        type: 'planet',
        id: 'earth',
        attributes: {
          name: 'Earth',
          classification: 'terrestrial'
        }
      };
  
      let jupiter: Record = {
        type: 'planet',
        id: 'jupiter',
        keys: {
          remoteId: 'p2'
        },
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        }
      };
  
      let io: Record = {
        type: 'moon',
        id: 'io',
        attributes: {
          name: 'Io'
        }
      };
  
      await cache.patch(t => [
        t.addRecord(earth),
        t.addRecord(jupiter),
        t.addRecord(io)
      ]);
  
      // reset keyMap to verify that pulling records also adds keys
      keyMap.reset();
  
      let record = await cache.query(q => q.findRecord(jupiter));
  
      assert.deepEqual(record, jupiter, 'query results are expected');
  
      assert.equal(
        keyMap.keyToId('planet', 'remoteId', 'p2'),
        'jupiter',
        'key has been mapped'
      );
    }),
  },
];