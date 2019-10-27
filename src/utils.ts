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
    console.warn.call(console, ...args);
  }
}

export const debug = (debug: boolean) => {
  DEBUG = debug;
}
