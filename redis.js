import { Random } from 'meteor/random';
import { createClient } from 'redis';
import { messenger } from './messenger';

// Generate a unique server id to prevent echoing messages sent by this server.
const serverId = Random.id();
// Object to store Redis clients for publishing and subscribing.
const clients = {};

/**
 * Parses the Redis connection URL from the environment variable.
 * @return {Object} The Redis connection options.
 */
function parseRedisEnvUrl() {
    if (process.env.RPS_REDIS_URL) {
        return { url: process.env.RPS_REDIS_URL };
    }
    return {};
}

const redisConfig = parseRedisEnvUrl();

/**
 * Creates a Redis client for either publishing or subscribing.
 * @param {string} key The client key, e.g., 'pub' or 'sub'.
 */
async function createRedisClient(key) {
    const logLabel = `RPS: [${key}]`;
    console.info(`${logLabel} connecting to Redis...`, redisConfig);

    const client = createClient(redisConfig);
    clients[key] = client;

    // Attach error handler.
    client.on('error', (err) => {
        if (err.errors) {
            console.error(`${logLabel} Errors:\n${err.errors.join('\n')}`);
        } else {
            console.error(`${logLabel} ${err}`);
        }
    });

    // Log when the client connects.
    client.on('connect', () => {
        console.info(`${logLabel} connected to Redis!`);
    });

    // Log reconnection attempts.
    client.on('reconnecting', () => {
        console.info(`${logLabel} reconnecting to Redis...`);
    });

    // Log when the connection ends.
    client.on('end', () => {
        console.error(`${logLabel} Redis connection ended.`);
    });

    // Connect asynchronously.
    await client.connect();
}

// Immediately create Redis clients for both publishing and subscribing.
(async () => {
    await createRedisClient('pub');
    await createRedisClient('sub');
})();

/**
 * Subscribes to a Redis channel.
 * When a message is received, it is parsed and passed to the messenger.
 * @param {string} channel The channel to subscribe to.
 */
function subscribe(channel) {
    if (!clients.sub) {
        return;
    }
    clients.sub
        .subscribe(channel, (messageString, channelName) => {
            let message;
            try {
                message = JSON.parse(messageString);
            } catch (err) {
                console.error(
                    `Failed to parse JSON. Channel: ${channelName}, Message: ${messageString}`,
                    err,
                );
                return;
            }
            // Only process the message if it did not originate from this server.
            if (message && message._serverId !== serverId) {
                messenger.handleMessage(channelName, message);
            }
        })
        .catch((err) => {
            console.error('Error subscribing to channel:', channel, err);
        });
}

/**
 * Unsubscribes from a Redis channel.
 * @param {string} channel The channel to unsubscribe from.
 */
function unsubscribe(channel) {
    if (!clients.sub) {
        return;
    }
    clients.sub
        .unsubscribe(channel)
        .catch((err) => {
            console.error('Error unsubscribing from channel:', channel, err);
        });
}

/**
 * Publishes a message to a Redis channel.
 * @param {string} channel The channel to publish to.
 * @param {string} message The message to publish (JSON string).
 */
function publishMessage(channel, message) {
    if (!clients.pub) {
        return;
    }
    clients.pub
        .publish(channel, message)
        .catch((err) => {
            console.error('Error publishing message:', err);
        });
}

export {
    serverId,
    subscribe,
    unsubscribe,
    publishMessage,
};
