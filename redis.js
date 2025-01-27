import { Random } from 'meteor/random';
import { createClient } from 'redis';
import { messenger } from './messenger';

const serverId = Random.id();
const clients = {};

/**
 * Parses the Redis URL from the environment variable.
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
 * Creates a Redis client.
 * @param {string} key The client key ('pub' or 'sub').
 */
async function createRedisClient(key) {
    const logLabel = `RPS: [${key}]`;

    console.info(`${logLabel} connecting to Redis...`, redisConfig);

    const client = createClient(redisConfig);

    clients[key] = client;

    client.on('error', (err) => {
        if (err.errors) {
            console.error(`${logLabel} Errors:\n${err.errors.join('\n')}`);
        } else {
            console.error(`${logLabel} ${err}`);
        }
    });

    client.on('connect', () => {
        console.info(`${logLabel} connected to Redis!`);
    });

    client.on('reconnecting', () => {
        console.info(`${logLabel} reconnecting to Redis...`);
    });

    client.on('end', () => {
        console.error(`${logLabel} Redis connection ended.`);
    });

    await client.connect();
}

(async () => {
    await createRedisClient('pub');
    await createRedisClient('sub');
})();

/**
 * Subscribes to a Redis channel.
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
 * @param {string} message The message to publish.
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
