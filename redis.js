import { Random } from 'meteor/random';
import { createClient, createSentinel } from 'redis';
import { messenger } from './messenger';

// Generate a unique server id to prevent echoing messages sent by this server.
const serverId = Random.id();
// Object to store Redis clients for publishing and subscribing.
const clients = {};

/**
 * @typedef {Object} SentinelConfig
 * @property {'sentinel'} mode
 * @property {Array<{host: string, port: number}>} sentinelRootNodes
 * @property {string} name - Sentinel master name.
 * @property {Object} [nodeClientOptions] - Options for the underlying Redis client (e.g., password).
 */

/**
 * @typedef {Object} RegularConfig
 * @property {'regular'} mode
 * @property {string} [url] - Redis connection URL.
 */

/**
 * Parses Redis connection configuration from environment variables.
 *
 * Sentinel mode (preferred for K8s):
 *   RPS_REDIS_SENTINEL_NODES - Comma-separated sentinel addresses (host:port).
 *   RPS_REDIS_SENTINEL_NAME  - Master name (default: "mymaster").
 *   RPS_REDIS_PASSWORD        - Password for Redis master nodes.
 *
 * Regular mode (backward compatible):
 *   RPS_REDIS_URL - Standard redis:// connection URL.
 *
 * @return {SentinelConfig | RegularConfig}
 */
function parseRedisConfig() {
    if (process.env.RPS_REDIS_SENTINEL_NODES) {
        const sentinelRootNodes = process.env.RPS_REDIS_SENTINEL_NODES
            .split(',')
            .map((node) => node.trim())
            .filter((node) => node.length > 0)
            .map((node) => {
                const lastColon = node.lastIndexOf(':');
                if (lastColon === -1) {
                    return { host: node, port: 26379 };
                }
                return {
                    host: node.slice(0, lastColon),
                    port: parseInt(node.slice(lastColon + 1), 10) || 26379,
                };
            });

        if (sentinelRootNodes.length === 0) {
            throw new Error('RPS_REDIS_SENTINEL_NODES is set but contains no valid sentinel nodes (check for trailing or double commas).');
        }

        const name = process.env.RPS_REDIS_SENTINEL_NAME || 'mymaster';
        const password = process.env.RPS_REDIS_PASSWORD;
        const nodeClientOptions = password ? { password } : {};

        return { mode: 'sentinel', sentinelRootNodes, name, nodeClientOptions };
    }

    if (process.env.RPS_REDIS_URL) {
        return { mode: 'regular', url: process.env.RPS_REDIS_URL };
    }

    return { mode: 'regular' };
}

const redisConfig = parseRedisConfig();

/**
 * Creates a Redis client for either publishing or subscribing.
 * Uses Sentinel discovery when RPS_REDIS_SENTINEL_NODES is set,
 * otherwise falls back to a direct connection via RPS_REDIS_URL.
 * @param {string} key The client key, e.g., 'pub' or 'sub'.
 */
async function createRedisClient(key) {
    const logLabel = `RPS: [${key}]`;

    let client;

    if (redisConfig.mode === 'sentinel') {
        console.info(`${logLabel} connecting to Redis via Sentinel...`, {
            sentinelNodes: redisConfig.sentinelRootNodes,
            masterName: redisConfig.name,
        });

        client = await createSentinel({
            name: redisConfig.name,
            sentinelRootNodes: redisConfig.sentinelRootNodes,
            nodeClientOptions: redisConfig.nodeClientOptions,
        });
    } else {
        const config = redisConfig.url ? { url: redisConfig.url } : {};

        // Avoid logging the full Redis URL, which may contain credentials.
        let logConfig;
        if (redisConfig.url) {
            try {
                const parsed = new URL(redisConfig.url);
                logConfig = {
                    urlProvided: true,
                    host: parsed.hostname,
                    port: parsed.port || undefined,
                };
            } catch (e) {
                // If parsing fails, only indicate that a URL was provided.
                logConfig = { urlProvided: true };
            }
        } else {
            logConfig = { urlProvided: false };
        }

        console.info(`${logLabel} connecting to Redis...`, logConfig);
        client = createClient(config);
    }

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

    // Log when client is ready
    client.on('ready', () => {
        console.info(`${logLabel} Redis client is ready!`);
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
    try {
        await createRedisClient('pub');
    } catch (err) {
        console.error('Failed to create Redis pub client:', err);
    }
    try {
        await createRedisClient('sub');
    } catch (err) {
        console.error('Failed to create Redis sub client:', err);
    }
})();

/**
 * Subscribes to a Redis channel.
 * When a message is received, it is parsed and passed to the messenger.
 * @param {string} channel The channel to subscribe to.
 */
async function subscribe(channel) {
    if (!clients.sub) {
        console.warn('RPS: Sub client not available');
        return;
    }
    
    // Check if client is ready
    if (!clients.sub.isReady) {
        console.warn('RPS: Sub client is not ready');
        return;
    }
    
    try {
        await clients.sub.subscribe(channel, (messageString, channelName) => {
            let message;
            try {
                message = JSON.parse(messageString);
            } catch (err) {
                console.error(
                    `RPS: Failed to parse JSON. Channel: ${channelName}, Message: ${messageString}`,
                    err,
                );
                return;
            }
            // Only process the message if it did not originate from this server.
            if (message && message._serverId !== serverId) {
                messenger.handleMessage(channelName, message);
            }
        });
    } catch (err) {
        console.error('RPS: Error subscribing to channel:', channel, err);
    }
}

/**
 * Unsubscribes from a Redis channel.
 * @param {string} channel The channel to unsubscribe from.
 */
async function unsubscribe(channel) {
    if (!clients.sub) {
        console.warn('RPS: Sub client not available');
        return;
    }
    
    // Check if client is ready
    if (!clients.sub.isReady) {
        console.warn('RPS: Sub client is not ready');
        return;
    }
    
    try {
        await clients.sub.unsubscribe(channel);
    } catch (err) {
        console.error('RPS: Error unsubscribing from channel:', channel, err);
    }
}

/**
 * Publishes a message to a Redis channel.
 * @param {string} channel The channel to publish to.
 * @param {string} message The message to publish (JSON string).
 */
async function publishMessage(channel, message) {
    if (!clients.pub) {
        console.warn('RPS: Pub client not available');
        return;
    }
    
    // Check if client is ready
    if (!clients.pub.isReady) {
        console.warn('RPS: Pub client is not ready, message not published');
        return;
    }
    
    try {
        await clients.pub.publish(channel, message);
    } catch (err) {
        console.error('RPS: Error publishing message:', err);
    }
}

/**
 * Checks the connection to Redis server by sending a PING command.
 * @return {Promise<string>} Resolves with 'PONG' if connection is successful.
 * @throws {Error} If Redis client is not available or connection fails.
 */
async function ping() {
    if (!clients.pub) {
        throw new Error('Redis client is not available. Connection may not be established yet.');
    }
    
    // Check if client is ready
    if (!clients.pub.isReady) {
        throw new Error('Redis client is not ready. Connection may be in progress.');
    }
    
    try {
        // Add timeout to prevent hanging forever
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Redis ping timeout after 5 seconds')), 5000);
        });
        
        const pingPromise = clients.pub.ping();
        
        const result = await Promise.race([pingPromise, timeoutPromise]);
        return result;
    } catch (err) {
        // If timeout occurred, try to reconnect the client
        if (err.message.includes('timeout')) {
            console.warn('RPS: Ping timeout detected, attempting to reconnect pub client...');
            try {
                await clients.pub.disconnect();
                await clients.pub.connect();
                console.info('RPS: Pub client reconnected successfully');
            } catch (reconnectErr) {
                console.error('RPS: Failed to reconnect pub client:', reconnectErr);
            }
        }
        
        throw new Error(`Redis ping failed: ${err.message}`);
    }
}

export {
    serverId,
    subscribe,
    unsubscribe,
    publishMessage,
    ping,
};
