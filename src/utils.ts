import { ResultSet } from "react-native-sqlite-storage";
import { RecordIdentity } from "@orbit/data";
import { Dict } from "@orbit/utils";

export function supportsSQLite(): boolean {
  return true;
}

export const stripNullFields = (input: object): object => {
  const output: any = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null) {
      output[key] = value;
    }
  }
  return output;
}

export const rsToArray = (rs?: ResultSet): any[] => {
  const result: any[] = [];
  if (!rs || !rs.rows || !rs.rows.length) {
    return result;
  }
  for (let i = 0; i < rs.rows.length; i ++) {
    result.push(rs.rows.item(i));
  }
  return result;
}

export const isSameIdentity = (i1: RecordIdentity, i2: RecordIdentity): boolean => {
  return i1.id === i2.id && i1.type === i2.type;
}

export const getDiff = <T>(src: T[], target: T[], comparator: (i1: T, i2: T) => boolean): T[] => {
  return src.filter(srcItem => {
    return target.filter(targetItem => comparator(srcItem, targetItem)).length === 0;
  });
}

export class EventEmitter {
  private handlers: Dict<Array<(args?: object) => void>> = {};
  on (event: string, callback: (args?: object) => void) {
    if (this.handlers[event] === undefined) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(callback);
  }

  off (event: string, callback: (args?: object) => void) {
    this.handlers[event].splice(this.handlers[event].indexOf(callback), 1);
  }

  trigger (event: string, args?: object) {
    const handlers = this.handlers[event];
    if (handlers) {
      for (const handler of handlers) {
        handler(args);
      }
    }
  }
}