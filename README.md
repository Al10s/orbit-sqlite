# react-native-orbit-sqlite


Allows creating a source of [https://github.com/andpor/react-native-sqlite-storage] for [https://github.com/orbitjs/orbit]@0.16.x.


## Disclaimer

The current content of this repo is still under development and has not yet been tested (especially the relationships part). Use it at your own risks.

I *may* try to to improve it and to add tests later.

I will bump the PATCH version for every new fix that occurs, but the MINOR will stay at 0 until the whole content has been fully approved.

Then I will bump the version to match the supported Orbit.js version.

**Note** : I noticed some internal changes that might break the compatibility of my code towards the upcoming release of Orbit.js v0.17.

**Note(2)** : Help and advices are welcome.


## Example of use

```ts
// db.ts
import SQLiteSource from '@al10s/react-native-orbit-sqlite';
import { Schema, QueryBuilder } from '@orbit/data';
import MemorySource from '@orbit/memory';
import ExampleSchema from './schemas/example';

const schema = new Schema({
  models: {
    example: ExampleSchema,
  }
});

export const memory = new MemorySource({
  schema,
  name: 'memory',
});

const backup = new SQLiteSource({
  schema,
  name: 'backup',
  namespace: 'MyNamespace',
});

const coordinator = new Coordinator({
  sources: [ memory, backup ],
});

const backupMemorySync = new SyncStrategy({
  source: 'memory',
  target: 'backup',
  blocking: true,
});

coordinator.addStrategy(backupMemorySync);

export async function init (): Promise<void> {
  const transform = await backup.pull((q: QueryBuilder) => q.findRecords());
  await memory.sync(transform);
  await coordinator.activate();
}
```

```ts
// index.ts
import { memory, init as initDb } from './db';
import { QueryBuilder } from '@orbit/data';

initDb()
  .then(() => memory.query((q: QueryBuilder) => q.findRecords('example')))
  .then((examples) => { console.log(examples); });
```
