import { write as writeServer } from './write-server';
import { publish } from './publish';
import { observeChanges } from './observe-changes';
import './redis';

export const RPS = {
    write: writeServer,
    publish,
    observeChanges,
    config: {},
};
