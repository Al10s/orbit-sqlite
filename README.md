# react-native-orbit-sqlite

Allows creating a source of [react-native-sqlite-storage](https://github.com/andpor/react-native-sqlite-storage) for [Orbit.js](https://github.com/orbitjs/orbit)@0.16.x.


## Disclaimer

The current content of this repo should be safe to use, but may not be actively maintained. Use it at your own risks.

I will bump the PATCH version for every new fix that occurs, but the MINOR will stay at 0 until the whole content has been fully approved.

Then I will bump the version to match the supported Orbit.js version.

**Note** : I noticed some internal changes that might break the compatibility of my code towards the upcoming release of Orbit.js v0.17.

**Note(2)** : Help and advices are welcome.


## Install

Check your version of Orbit. Current supported version is 0.16.x.

```bash
yarn add react-native-sqlite-storage # Required to autolink for react native
yarn add @al10s/react-native-orbit-sqlite
```


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


## Tests

I created a little React Native app in order to execute the tests. It is located under the `/tests` directory.

First of all, install the node modules.

```bash
# Location : <project>/tests/
yarn install
```

The tested code is the one published on npm.

To test modifications of the code, we will need to replace the tested code as follows :

```bash
# Location : <project>/
yarn run tsc # Compile the TypeScript code into JavaScript
rm tests/node_modules/@al10s/react-native-orbit-sqlite/dist/* # Delete the published code that is tested
cp dist/* tests/node_modules/@al10s/react-native-orbit-sqlite/dist/ # Copy the compiled code instead
```

### Android

You will need to add a valid `debug.keystore` in `android/app/`.

If you ever worked with Android Studio, there's a chance that one is located under the `.android` folder.

```bash
cp ~/.android/debug.keystore <project>/tests/android/app/
```

Then you can start a metro server

```bash
# Location : <project>/tests/
yarn start
```
Then you are ready to test it on your device (or in a VM)

```bash
# Location : <project>/tests/
yarn run android
```

### iOS

I don't own a Mac so I can't test it yet, but if you know the procedure to follow you can tell me and I will change it if needed.

```bash
# Location : <project>/tests/
yarn run ios
```