import SQLiteSource from '@al10s/react-native-orbit-sqlite';
import { TestContext, RunnableTestUnit, TestUnit, EventEmitter, TestSuite } from '../../utils';
import { Schema, KeyMap, Record, buildTransform, AddRecordOperation, Transform } from '@orbit/data';
import assert from 'assert';

interface Context extends TestContext {
  schema: Schema;
  source: SQLiteSource;
  keyMap: KeyMap;
}

const before = async () => {};

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
  const source = new SQLiteSource({ schema, keyMap });
  return {
    schema,
    keyMap,
    source,
  };
}

const afterEach = async (context: Context) => {
  const { cache } = context.source;
  return cache.deleteDB()
}

const after = async () => {}

const units: RunnableTestUnit<Context>[] = [
  {
    label: 'it exists',
    run: async (context: Context) => {
      const { source, schema, keyMap } = context;
      assert.ok(source, 'source exists');
      assert.strictEqual(source.schema, schema, 'schema has been assigned');
      assert.strictEqual(source.keyMap, keyMap, 'keyMap has been assigned');
    },
  },
  {
    label: 'is assigned a default dbName',
    run: async (context: Context) => {
      const { source } = context;
      assert.equal(
        source.cache.dbName,
        'sqlite',
        '`dbName` is `sqlite` by default'
      );
    },
  },
  {
    label: 'will reopen the database when the schema is upgraded',
    run: async (context: Context) => {
      const { source, schema } = context;
      assert.equal(source.cache.dbVersion, 1, 'db starts with version == 1');

      await new Promise(async (resolve, reject) => {
        source.cache.migrateDB = async (db, event) => {
          try {
            assert.equal(
              event.oldVersion,
              1,
              'migrateDB called with oldVersion == 1'
            );
            assert.equal(
              event.newVersion,
              2,
              'migrateDB called with newVersion == 2'
            );
          }
          catch (e) {
            return reject(e)
          }
          resolve();
        };

        schema.on('upgrade', version => {
          try {
            assert.equal(version, 2, 'schema has upgraded to v2');
            assert.equal(source.cache.dbVersion, 2, 'db has the correct version');
          }
          catch (e) {
            reject(e)
          }
        });

        await source.cache.openDB();

        schema.upgrade({
          models: {
            planet: {
              attributes: {
                name: { type: 'string' }
              }
            },
            moon: {
              attributes: {
                name: { type: 'string' }
              }
            }
          }
        });
      })
    }
  },
  {
    label: '#reset is idempotent',
    run: async (context: Context) => {
      const { source } = context;
      await source.cache.openDB();
      await source.reset();
      await source.reset();
      await source.cache.openDB();
      assert.ok(true, 'db has been reset twice and can still be reopened');
    },
  },
  {
    label: 'data persists across re-instantiating source',
    run: async (context: Context) => {
      const { source, schema, keyMap } = context;

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

      await source.push(t => t.addRecord(planet));
      assert.deepEqual(
        await source.cache.getRecordAsync(planet),
        planet,
        'sqlitedb contains record'
      );
  
      await source.cache.closeDB();
  
      const newSource = new SQLiteSource({ schema, keyMap });
      assert.deepEqual(
        await newSource.cache.getRecordAsync(planet),
        planet,
        'sqlitedb still contains record'
      );
    },
  },
  {
    label: '#sync - addRecord', 
    run: async (context: Context) => {
      const { source, keyMap } = context;

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
  
      const t = buildTransform({
        op: 'addRecord',
        record: planet
      } as AddRecordOperation);
  
      await source.sync(t);
  
      assert.ok(source.transformLog.contains(t.id), 'log contains transform');
      assert.deepEqual(
        await source.cache.getRecordAsync(planet),
        planet,
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
    label: '#push - addRecord',
    run: async (context: Context) => {
      const { source, keyMap } = context;

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
  
      const t = buildTransform({
        op: 'addRecord',
        record: planet
      } as AddRecordOperation);
  
      await source.push(t);
  
      assert.ok(source.transformLog.contains(t.id), 'log contains transform');
      assert.deepEqual(
        await source.cache.getRecordAsync(planet),
        planet,
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
    label: '#push - addRecord - with beforePush listener that syncs transform',
    run: async (context: Context) => {
      const { source, keyMap } = context;

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
  
      const t = buildTransform({
        op: 'addRecord',
        record: planet
      } as AddRecordOperation);
  
      source.on('beforePush', async (transform: Transform) => {
        await source.sync(transform);
      });
  
      const result = await source.push(t);
  
      assert.deepEqual(result, [], 'result represents transforms applied');
      assert.ok(source.transformLog.contains(t.id), 'log contains transform');
      assert.deepEqual(
        await source.cache.getRecordAsync(planet),
        planet,
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
    label: '#push - updateRecord',
    run: async (context: Context) => {
      const { source, keyMap } = context;

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
  
      await source.push(t => t.addRecord(original));
      await source.push(t => t.updateRecord(updates));
      assert.deepEqual(
        await source.cache.getRecordAsync(expected),
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
    label: '#push - updateRecord - when record does not exist',
    run: async (context: Context) => {
      const { source } = context;

      const revised: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant',
          revised: true
        }
      };
  
      await source.push(t => t.updateRecord(revised));
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#push - removeRecord',
    run: async (context: Context) => {
      const { source } = context;

      const planet: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        }
      };
  
      await source.push(t => t.addRecord(planet));
      await source.push(t => t.removeRecord(planet));
      assert.equal(
        await source.cache.getRecordAsync(planet),
        undefined,
        'sqlitedb does not contain record'
      );
    },
  },
  {
    label: '#push - removeRecord when part of has many relationship',
    run: async (context: Context) => {
      const { source } = context;

      const moon1 = { type: 'moon', id: 'moon1' };
      const moon2 = { type: 'moon', id: 'moon2' };
      const planet: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          moons: {
            data: [moon1, moon2]
          }
        }
      };
  
      await source.push(t => [
        t.addRecord(moon1),
        t.addRecord(moon2),
        t.addRecord(planet)
      ]);

      assert.deepEqual(
        (await source.cache.getRecordAsync(planet)).relationships.moons
          .data.length,
        2,
        'record has 2 moons'
      );
      await source.push(t => t.removeRecord(moon1));
      assert.deepEqual(
        (await source.cache.getRecordAsync(planet)).relationships.moons
          .data.length,
        1,
        'record has 1 moon'
      );
    },
  },
  {
    label: '#push - removeRecord - when record does not exist',
    run: async (context: Context) => {
      const { source } = context;

      const planet: Record = {
        type: 'planet',
        id: 'jupiter'
      };
  
      await source.push(t => t.removeRecord(planet));
      assert.equal(
        await source.cache.getRecordAsync(planet),
        undefined,
        'sqlitedb does not contain record'
      );
    },
  },
  {
    label: '#push - replaceKey',
    run: async (context: Context) => {
      const { source, keyMap } = context;

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
  
      await source.push(t => t.addRecord(original));
      await source.push(t => t.replaceKey(original, 'remoteId', '123'));
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
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
    label: '#push - replaceKey - when base record does not exist',
    run: async (context: Context) => {
      const { source, keyMap } = context;

      const revised: Record = {
        type: 'planet',
        id: 'jupiter',
        keys: {
          remoteId: '123'
        }
      };
  
      await source.push(t =>
        t.replaceKey({ type: 'planet', id: 'jupiter' }, 'remoteId', '123')
      );
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
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
    label: '#push - replaceAttribute',
    run: async (context: Context) => {
      const { source } = context;

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
          classification: 'gas giant',
          order: 5
        }
      };
  
      await source.push(t => t.addRecord(original));
      await source.push(t => t.replaceAttribute(original, 'order', 5));
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#push - replaceAttribute - when base record does not exist',
    run: async (context: Context) => {
      const { source } = context;

      const revised: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          order: 5
        }
      };
  
      await source.push(t =>
        t.replaceAttribute({ type: 'planet', id: 'jupiter' }, 'order', 5)
      );
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#push - addToRelatedRecords',
    run: async (context: Context) => {
      const { source } = context;

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
  
      await source.push(t => t.addRecord(original));
      await source.push(t =>
        t.addToRelatedRecords(original, 'moons', { type: 'moon', id: 'moon1' })
      );
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#push - addToRelatedRecords - when base record does not exist',
    run: async (context: Context) => {
      const { source } = context;

      const revised: Record = {
        type: 'planet',
        id: 'jupiter',
        relationships: {
          moons: {
            data: [{ type: 'moon', id: 'moon1' }]
          }
        }
      };
  
      await source.push(t =>
        t.addToRelatedRecords({ type: 'planet', id: 'jupiter' }, 'moons', {
          type: 'moon',
          id: 'moon1'
        })
      );
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#push - removeFromRelatedRecords',
    run: async (context: Context) => {
      const { source } = context;

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
  
      await source.push(t => t.addRecord(original));
      await source.push(t =>
        t.removeFromRelatedRecords(original, 'moons', {
          type: 'moon',
          id: 'moon2'
        })
      );
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#push - removeFromRelatedRecords - when base record does not exist',
    run: async (context: Context) => {
      const { source } = context;

      const revised: Record = {
        type: 'planet',
        id: 'jupiter',
        relationships: {
          moons: {
            data: []
          }
        }
      };
  
      await source.push(t =>
        t.removeFromRelatedRecords({ type: 'planet', id: 'jupiter' }, 'moons', {
          type: 'moon',
          id: 'moon2'
        })
      );
      assert.equal(
        await source.cache.getRecordAsync(revised),
        undefined,
        'sqlitedb does not contain record'
      );
    },
  },
  {
    label: '#push - replaceRelatedRecords',
    run: async (context: Context) => {
      const { source } = context;

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

      await source.push(t => t.addRecord(original));
      await source.push(t =>
        t.replaceRelatedRecords(original, 'moons', [
          { type: 'moon', id: 'moon2' },
          { type: 'moon', id: 'moon3' }
        ])
      );
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#push - replaceRelatedRecords - when base record does not exist',
    run: async (context: Context) => {
      const { source } = context;

      const revised: Record = {
        type: 'planet',
        id: 'jupiter',
        relationships: {
          moons: {
            data: [{ type: 'moon', id: 'moon2' }, { type: 'moon', id: 'moon3' }]
          }
        }
      };
  
      await source.push(t =>
        t.replaceRelatedRecords({ type: 'planet', id: 'jupiter' }, 'moons', [
          { type: 'moon', id: 'moon2' },
          { type: 'moon', id: 'moon3' }
        ])
      );
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#push - replaceRelatedRecord - with record',
    run: async (context: Context) => {
      const { source } = context;

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
  
      await source.push(t => t.addRecord(original));
      await source.push(t =>
        t.replaceRelatedRecord(original, 'solarSystem', {
          type: 'solarSystem',
          id: 'ss1'
        })
      );
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#push - replaceRelatedRecord - with record - when base record does not exist',
    run: async (context: Context) => {
      const { source } = context;

      const revised: Record = {
        type: 'planet',
        id: 'jupiter',
        relationships: {
          solarSystem: {
            data: { type: 'solarSystem', id: 'ss1' }
          }
        }
      };
  
      await source.push(t =>
        t.replaceRelatedRecord({ type: 'planet', id: 'jupiter' }, 'solarSystem', {
          type: 'solarSystem',
          id: 'ss1'
        })
      );
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#push - replaceRelatedRecord - with null',
    run: async (context: Context) => {
      const { source } = context;

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
        relationships: {
          solarSystem: {
            data: null
          }
        }
      };
  
      await source.push(t => t.addRecord(original));
      await source.push(t =>
        t.replaceRelatedRecord(original, 'solarSystem', null)
      );
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#push - replaceRelatedRecord - with null - when base record does not exist',
    run: async (context: Context) => {
      const { source } = context;

      const revised: Record = {
        type: 'planet',
        id: 'jupiter',
        relationships: {
          solarSystem: {
            data: null
          }
        }
      };
  
      await source.push(t =>
        t.replaceRelatedRecord(
          { type: 'planet', id: 'jupiter' },
          'solarSystem',
          null
        )
      );
      assert.deepEqual(
        await source.cache.getRecordAsync(revised),
        revised,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#push - inverse relationships are created',
    run: async (context: Context) => {
      const { source } = context;

      const ss = {
        type: 'solarSystem',
        id: 'ss'
      };
  
      const earth: Record = {
        type: 'planet',
        id: 'earth',
        attributes: {
          name: 'Earth',
          classification: 'terrestrial'
        },
        relationships: {
          solarSystem: {
            data: { type: 'solarSystem', id: 'ss' }
          }
        }
      };
  
      const jupiter: Record = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          solarSystem: {
            data: { type: 'solarSystem', id: 'ss' }
          }
        }
      };
  
      const io: Record = {
        type: 'moon',
        id: 'io',
        attributes: {
          name: 'Io'
        },
        relationships: {
          planet: {
            data: { type: 'planet', id: 'jupiter' }
          }
        }
      };
  
      await source.push(t => [
        t.addRecord(ss),
        t.addRecord(earth),
        t.addRecord(jupiter),
        t.addRecord(io)
      ]);
  
      const revisedSs = {
        type: 'solarSystem',
        id: 'ss',
        relationships: {
          planets: {
            data: [
              { type: 'planet', id: 'earth' },
              { type: 'planet', id: 'jupiter' }
            ]
          }
        }
      };
  
      assert.deepEqual(
        await source.cache.getRecordAsync(revisedSs),
        revisedSs,
        'sqlitedb contains record'
      );
  
      const revisedJupiter = {
        type: 'planet',
        id: 'jupiter',
        attributes: {
          name: 'Jupiter',
          classification: 'gas giant'
        },
        relationships: {
          moons: {
            data: [{ type: 'moon', id: 'io' }]
          },
          solarSystem: {
            data: { type: 'solarSystem', id: 'ss' }
          }
        }
      };
  
      assert.deepEqual(
        await source.cache.getRecordAsync(revisedJupiter),
        revisedJupiter,
        'sqlitedb contains record'
      );
    },
  },
  {
    label: '#pull - all records',
    run: async (context: Context) => {
      const { source, keyMap } = context;

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
  
      await source.push(t => [
        t.addRecord(earth),
        t.addRecord(jupiter),
        t.addRecord(io)
      ]);
  
      // reset keyMap to verify that pulling records also adds keys
      keyMap.reset();
  
      const transforms = await source.pull(q => q.findRecords());
  
      assert.equal(transforms.length, 1, 'one transform returned');
      assert.deepEqual(
        transforms[0].operations.map(o => o.op),
        ['updateRecord', 'updateRecord', 'updateRecord'],
        'operations match expectations'
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
    label: '#pull - records of one type',
    run: async (context: Context) => {
      const { source } = context;

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
  
      await source.push(t => [
        t.addRecord(earth),
        t.addRecord(jupiter),
        t.addRecord(io)
      ]);
  
      const transforms = await source.pull(q => q.findRecords('planet'));
  
      assert.equal(transforms.length, 1, 'one transform returned');
      assert.ok(
        source.transformLog.contains(transforms[0].id),
        'log contains transform'
      );
      assert.deepEqual(
        transforms[0].operations.map(o => o.op),
        ['updateRecord', 'updateRecord'],
        'operations match expectations'
      );
      assert.deepEqual(
        transforms[0].operations.map((o) => {
          const op = o as AddRecordOperation;
          return op.record.type
        }),
        ['planet', 'planet'],
        'operations match expectations'
      );
    },
  },
  {
    label: '#pull - specific records',
    run: async (context: Context) => {
      const { source } = context;

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
  
      await source.push(t => [
        t.addRecord(earth),
        t.addRecord(jupiter),
        t.addRecord(io)
      ]);
  
      const transforms = await source.pull(q =>
        q.findRecords([earth, io, { type: 'moon', id: 'FAKE' }])
      );
  
      assert.equal(transforms.length, 1, 'one transform returned');
      assert.ok(
        source.transformLog.contains(transforms[0].id),
        'log contains transform'
      );
      assert.deepEqual(
        transforms[0].operations.map(o => o.op),
        ['updateRecord', 'updateRecord'],
        'operations match expectations'
      );
      assert.deepEqual(
        transforms[0].operations.map((o) => {
          const op = o as AddRecordOperation
          return op.record.type
        }),
        ['planet', 'moon'],
        'operations match expectations'
      );
    },
  },
  {
    label: '#pull - a specific record',
    run: async (context: Context) => {
      const { source, keyMap } = context;

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
  
      await source.push(t => [
        t.addRecord(earth),
        t.addRecord(jupiter),
        t.addRecord(io)
      ]);
  
      // reset keyMap to verify that pulling records also adds keys
      keyMap.reset();
  
      const transforms = await source.pull(q => q.findRecord(jupiter));
  
      assert.equal(transforms.length, 1, 'one transform returned');
      assert.ok(
        source.transformLog.contains(transforms[0].id),
        'log contains transform'
      );
      assert.deepEqual(
        transforms[0].operations.map(o => o.op),
        ['updateRecord'],
        'operations match expectations'
      );
      assert.equal(
        keyMap.keyToId('planet', 'remoteId', 'p2'),
        'jupiter',
        'key has been mapped'
      );
    },
  },
].map((t: TestUnit<Context>) => ({ ...t, emitter: new EventEmitter() }));

export const suite: TestSuite<Context> = {
  name: 'SQLiteSource',
  units,
  beforeEach,
  afterEach,
  before,
  after,
};