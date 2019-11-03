export { default, SQLiteSourceSettings } from './sqlite-source';
export {
  default as SQLiteCache,
  SQLiteCacheSettings,
  VERSION,
} from './sqlite-cache';
export { supportsSQLite } from './utils';
import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);
