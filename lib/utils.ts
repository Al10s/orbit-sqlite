export function supportsSQLite(): boolean {
  return true;
}

let DEBUG = true;
export const log = (...args) => {
  if (DEBUG) {
    console.log.call(console, ...args);
  }
}

export const debug = (debug: boolean) => {
  DEBUG = debug;
}
