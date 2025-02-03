import { subscribe, unsubscribe } from './redis';

/**
 * Messenger class handles registration of observers on channels,
 * routing messages from Redis to the corresponding observer callbacks.
 */
class Messenger {
    constructor() {
        // Map of channel names to objects with observer keys as properties.
        this.channels = {};
        // Map of observer keys to channel names.
        this.observers = {};
        // Global message handler callback (can be set externally).
        this.onMessage = null;
    }

    /**
     * Registers an observer for a given channel.
     * @param {string} observerKey Unique key identifying the observer.
     * @param {string} channel The Redis channel to subscribe to.
     */
    addObserver(observerKey, channel) {
        // Create channel entry if it doesn't exist.
        if (!this.channels[channel]) {
            this.channels[channel] = {};
        }
        // Register the observer key on this channel.
        this.channels[channel][observerKey] = true;
        // Map the observer key to the channel.
        this.observers[observerKey] = channel;
        // Subscribe to the Redis channel.
        subscribe(channel);
    }

    /**
     * Removes an observer from a channel.
     * @param {string} observerKey Unique key identifying the observer.
     */
    removeObserver(observerKey) {
        const channel = this.observers[observerKey];
        if (channel) {
            // Remove observer from the channel's observer list.
            delete this.channels[channel][observerKey];
            // If no more observers on the channel, unsubscribe from Redis.
            if (Object.keys(this.channels[channel]).length === 0) {
                unsubscribe(channel);
                delete this.channels[channel];
            }
        }
        // Remove the observer mapping.
        delete this.observers[observerKey];
    }

    /**
     * Handles an incoming message for a given channel.
     * Delegates the processing to an externally defined onMessage callback.
     * @param {string} channel The channel on which the message was received.
     * @param {Object} message The message object.
     */
    handleMessage(channel, message) {
        if (this.onMessage) {
            this.onMessage(channel, message);
        }
    }
}

const messenger = new Messenger();

export { messenger };
