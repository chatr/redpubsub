import { subscribe, unsubscribe } from './redis';

class Messenger {
    constructor() {
        this.channels = {};
        this.observers = {};
        this.onMessage = null;
    }

    addObserver(observerKey, channel) {
        if (!this.channels[channel]) {
            this.channels[channel] = {};
        }

        this.channels[channel][observerKey] = true;
        this.observers[observerKey] = channel;

        subscribe(channel);
    }

    removeObserver(observerKey) {
        const channel = this.observers[observerKey];
        if (channel) {
            delete this.channels[channel][observerKey];
            if (Object.keys(this.channels[channel]).length === 0) {
                unsubscribe(channel);
                delete this.channels[channel];
            }
        }
        delete this.observers[observerKey];
    }

    handleMessage(channel, message) {
        if (this.onMessage) {
            this.onMessage(channel, message);
        }
    }
}

const messenger = new Messenger();

export { Messenger, messenger };
