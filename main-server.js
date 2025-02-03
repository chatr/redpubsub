import { write as writeServer } from './write-server';
import { publish } from './publish';
import { observeChanges } from './observe-changes';
import './redis';

// Expose the RPS object on the server.
export const RPS = {
    write: writeServer, // Server-side write operation with publishing.
    publish, // Publish method to hook into Meteor.publish.
    observeChanges, // Method to observe changes on a collection.
    config: {}, // Configuration object for custom channels etc.
};
