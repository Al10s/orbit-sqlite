export class EventEmitter {
  private handlers: { [index: string]: ((args?: object) => void)[] } = {};
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

export interface Test {
  run: () => Promise<void>;
  label: string;
}

export type RunnableTest = Test & {
  emitter: EventEmitter;
}