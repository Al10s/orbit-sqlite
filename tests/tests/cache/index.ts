import { TestUnit, EventEmitter, RunnableTestUnit, TestSuite, TestContext } from '../../utils';
import { Schema, KeyMap, Record } from '@orbit/data';
import { SQLiteCache } from '@al10s/react-native-orbit-sqlite';
import assert from 'assert';

interface Context extends TestContext {
  schema: Schema;
  cache: SQLiteCache;
  keyMap: KeyMap;
}

const before = async (): Promise<void> => {}

const beforeEach = async (): Promise<Context> => {
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
  return {
    schema,
    keyMap,
    cache,
  };
}

const afterEach = async (context: Context): Promise<void> => {
  const { cache } = context;
  return cache.deleteDB();
}

const after = async (): Promise<void> => {}

const units: RunnableTestUnit<Context>[] = [
  {
    label: 'it exists',
    run: async (context: Context) => {
      const { cache, schema, keyMap } = context;
      assert.ok(cache, 'cache exists');
      assert.strictEqual(cache.schema, schema, 'schema has been assigned');
      assert.strictEqual(cache.keyMap, keyMap, 'keyMap has been assigned');
    },
  },
  {
    label: 'is assigned a default dbName',
    run: async (context: Context) => {
      const { cache } = context;
      assert.equal(cache.dbName, 'sqlite', '`dbName` is `sqlite` by default');
    },
  },
  {
    label: 'sets/gets records individually',
    run: async (context: Context) => {
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

      assert.deepStrictEqual(await cache.getRecordAsync(jupiter), jupiter);
      assert.deepStrictEqual(await cache.getRecordAsync(io), io);
      assert.deepStrictEqual(await cache.getRecordAsync(europa), europa);

      await cache.removeRecordAsync(jupiter);
      await cache.removeRecordAsync(io);
      await cache.removeRecordAsync(europa);

      assert.deepStrictEqual(await cache.getRecordAsync(jupiter), undefined);
      assert.deepStrictEqual(await cache.getRecordAsync(io), undefined);
      assert.deepStrictEqual(await cache.getRecordAsync(europa), undefined);
    },
  },
  {
    label: 'sets/gets records in bulk',
    run: async (context: Context) => {
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

      await cache.setRecordsAsync([jupiter, io, europa]);

      assert.deepStrictEqual(await cache.getRecordsAsync([jupiter, io, europa]), [
        jupiter,
        io,
        europa
      ]);

      await cache.removeRecordsAsync([jupiter, io, europa]);

      assert.deepStrictEqual(await cache.getRecordsAsync([jupiter, io, europa]), []);
    },
  },
  {
    label: 'sets/gets inverse relationships',
    run: async (context: Context) => {
      const { cache } = context;
      const jupiter = { type: 'planet', id: 'jupiter' };
      const io = { type: 'moon', id: 'io' };
      const europa = { type: 'moon', id: 'europa' };
      const callisto = { type: 'moon', id: 'callisto' };

      assert.deepStrictEqual(
        await cache.getInverseRelationshipsAsync(jupiter),
        [],
        'no inverse relationships to start'
      );

      await cache.addInverseRelationshipsAsync([
        { record: jupiter, relationship: 'moons', relatedRecord: io },
        { record: jupiter, relationship: 'moons', relatedRecord: europa },
        { record: jupiter, relationship: 'moons', relatedRecord: callisto }
      ]);

      assert.deepStrictEqual(
        await cache.getInverseRelationshipsAsync(jupiter),
        [
          { record: jupiter, relationship: 'moons', relatedRecord: io },
          { record: jupiter, relationship: 'moons', relatedRecord: europa },
          { record: jupiter, relationship: 'moons', relatedRecord: callisto },
        ],
        'inverse relationships have been added'
      );

      await cache.removeInverseRelationshipsAsync([
        { record: jupiter, relationship: 'moons', relatedRecord: io },
        { record: jupiter, relationship: 'moons', relatedRecord: europa },
        { record: jupiter, relationship: 'moons', relatedRecord: callisto }
      ]);

      assert.deepStrictEqual(
        await cache.getInverseRelationshipsAsync(jupiter),
        [],
        'inverse relationships have been removed'
      );
    },
  },
  {
    label: '#patch - addRecord',
    run: async (context: Context) => {
      const { cache, keyMap } = context;
      const planet: Record = {
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

      assert.deepStrictEqual(
        await cache.getRecordAsync(planet),
        planet,
      );

      assert.equal(
        keyMap.keyToId('planet', 'remoteId', 'j'),
        'jupiter',
        'key has been mapped'
      );
    },
  },
  {
    label: '#patch - updateRecord',
    run: async (context: Context) => {
      const { cache, keyMap } = context;
      const original: Record = {
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

      const updates: Record = {
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

      const expected: Record = {
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

      assert.deepStrictEqual(
        await cache.getRecordAsync(expected),
        expected,
        'sqlitedb contains record'
      );
      assert.equal(
        keyMap.keyToId('planet', 'remoteId', 'j'),
        'jupiter',
        'key has been mapped'
      );
    },
  },
  {
    label: '#patch - updateRecord - when record does not exist',
    run: async (context: Context) => {
      const { cache } = context;
      const revised = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant',
          // revised: true TODO when booleans will be supported (Data should be stored as JSON, it won't be querried anyways)
        }
      };

      await cache.patch(t => t.updateRecord(revised));
      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#patch - removeRecord',
    run: async (context: Context) => {
      const { cache } = context;
      const planet: Record = {
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
        await cache.getRecordAsync(planet),
        null,
        'sqlitedb does not contain record'
      );
    },
  },
  {
    label: '#patch - removeRecord - when record does not exist',
    run: async (context: Context) => {
      const { cache } = context;
      const planet = {
        type: 'planet',
        id: 'jupiter'
      };

      await cache.patch(t => t.removeRecord(planet));
      assert.equal(
        await cache.getRecordAsync(planet),
        null,
        'sqlitedb does not contain record'
      );
    },
  },
  {
    label: '#patch - replaceKey',
    run: async (context: Context) => {
      const { cache, keyMap } = context;
      const original: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        }
      };

      const revised: Record = {
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
      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );

      assert.equal(
        keyMap.keyToId('planet', 'remoteId', '123'),
        'jupiter',
        'key has been mapped'
      );
    },
  },
  {
    label: '#patch - replaceKey - when base record does not exist',
    run: async (context: Context) => {
      const { cache, keyMap } = context;
      const revised: Record = {
        type: 'planet',
        id: 'jupiter',
        keys: {
          remoteId: '123'
        }
      };

      await cache.patch(t =>
        t.replaceKey({ type: 'planet', id: 'jupiter' }, 'remoteId', '123')
      );
      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
      );

      assert.equal(
        keyMap.keyToId('planet', 'remoteId', '123'),
        'jupiter',
        'key has been mapped'
      );
    },
  },
  {
    label: '#patch - replaceAttribute - when base record does not exist',
    run: async (context: Context) => {
      const { cache } = context;
      const revised: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          // order: 5 TODO When the attributes will be serialized as JSON (outside of the schema)
          name: 'Jupiter'
        }
      };

      await cache.patch(t =>
        t.replaceAttribute({ type: 'planet', id: 'jupiter' }, 'name', 'Jupiter')
      );
      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#patch - addToRelatedRecords',
    run: async (context: Context) => {
      const { cache } = context;
      const original: Record = {
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

      const revised: Record = {
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
      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#patch - addToRelatedRecords - when base record does not exist',
    run: async (context: Context) => {
      const { cache } = context;
      const revised: Record = {
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
      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#patch - removeFromRelatedRecords',
    run: async (context: Context) => {
      const { cache } = context;
      const original: Record = {
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

      const revised: Record = {
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

      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#patch - removeFromRelatedRecords - when base record does not exist',
    run: async (context: Context) => {
      const { cache } = context;
      const revised: Record = {
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
        await cache.getRecordAsync(revised),
        null,
        'sqlitedb does not contain record'
      );
    },
  },
  {
    label: '#patch - replaceRelatedRecords',
    run: async (context: Context) => {
      const { cache } = context;
      const original: Record = {
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

      const revised: Record = {
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
      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#patch - replaceRelatedRecords - when base record does not exist',
    run: async (context: Context) => {
      const { cache } = context;
      const revised: Record = {
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
      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#patch - replaceRelatedRecord - with record',
    run: async (context: Context) => {
      const { cache } = context;
      const original: Record = {
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

      const revised: Record = {
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
      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#patch - replaceRelatedRecord - with record - when base record does not exist',
    run: async (context: Context) => {
      const { cache } = context;
      const revised: Record = {
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
      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#patch - replaceRelatedRecord - with null',
    run: async (context: Context) => {
      const { cache } = context;
      const original: Record = {
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

      const revised: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        // TODO Support empty-to-one relationships ?
//        relationships: {
//          solarSystem: {
//            data: null
//          }
//        }
      };

      await cache.patch(t => t.addRecord(original));
      await cache.patch(t =>
        t.replaceRelatedRecord(original, 'solarSystem', null)
      );
      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#patch - replaceRelatedRecord - with null - when base record does not exist',
    run: async (context: Context) => {
      const { cache } = context;
      const revised: Record = {
        type: 'planet',
        id: 'jupiter',
        // TODO Support empty-to-one relationships ?
//        relationships: {
//          solarSystem: {
//            data: null
//          }
//        }
      };

      await cache.patch(t =>
        t.replaceRelatedRecord(
          { type: 'planet', id: 'jupiter' },
          'solarSystem',
          null
        )
      );
      assert.deepStrictEqual(
        await cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#query - all records',
    run: async (context: Context) => {
      const { cache, keyMap } = context;
      const earth: Record = {
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

      const jupiter: Record = {
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

      const io: Record = {
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

      const records = await cache.query(q => q.findRecords());
      assert.deepStrictEqual(
        records,
        [earth, jupiter, io],
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
    },
  },
  {
    label: '#query - records of one type',
    run: async (context: Context) => {
      const { cache } = context;
      const earth: Record = {
        type: 'planet',
        id: 'earth',
        attributes: {
          name: 'Earth',
          classification: 'terrestrial'
        }
      };

      const jupiter: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        }
      };

      const io: Record = {
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

      const records = await cache.query(q => q.findRecords('planet'));
      assert.deepStrictEqual(records, [earth, jupiter], 'query results are expected');
    },
  },
  {
    label: '#query - records by identity',
    run: async (context: Context) => {
      const { cache } = context;
      const earth: Record = {
        type: 'planet',
        id: 'earth',
        attributes: {
          name: 'Earth',
          classification: 'terrestrial'
        }
      };

      const jupiter: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        }
      };

      const io: Record = {
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

      const records = await cache.query(q =>
        q.findRecords([earth, io, { type: 'planet', id: 'FAKE' }])
      );
      assert.deepStrictEqual(records, [earth, io], 'only matches are returned');
    },
  },
  {
    label: '#query - a specific record',
    run: async (context: Context) => {
      const { cache, keyMap } = context;
      const earth: Record = {
        type: 'planet',
        id: 'earth',
        attributes: {
          name: 'Earth',
          classification: 'terrestrial'
        }
      };

      const jupiter: Record = {
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

      const io: Record = {
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

      const record = await cache.query(q => q.findRecord(jupiter));

      assert.deepStrictEqual(record, jupiter, 'query results are expected');

      assert.equal(
        keyMap.keyToId('planet', 'remoteId', 'p2'),
        'jupiter',
        'key has been mapped'
      );
    },
  },
].map((t: TestUnit<Context>) => ({ ...t, emitter: new EventEmitter() }));

export const suite: TestSuite<Context> = {
  name: 'SQLiteCache',
  units,
  beforeEach,
  afterEach,
  before,
  after,
}