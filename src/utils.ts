export function supportsSQLite(): boolean {
  return true;
}

let DEBUG = false;
export const log = (...args) => {
  if (DEBUG) {
    console.log.call(console, ...args);
  }
}

export const logQuery = (...args) => {
  if (DEBUG) {
    args.push(new Date());
    console.log.call(console, ...args);
  }
}

export const logMethod = (...args) => {
  if (DEBUG) {
    args.push(new Date());
    console.log.call(console, ...args);
  }
}

export const debug = (debug: boolean) => {
  DEBUG = debug;
}

export const stripNull = (input: object): object => {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null) {
      output[key] = value;
    }
  }
  return output;
}