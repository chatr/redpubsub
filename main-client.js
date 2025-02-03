import { write as writeClient } from './write-client';

// Expose the RPS object on the client.
export const RPS = {
    write: writeClient, // Client-side write operation.
};
