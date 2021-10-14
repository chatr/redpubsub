RPS._serverId = Random.id();

const Redis = Npm.require('redis');
const url = Npm.require('url');

RPS._status = {};
RPS._clients = {};

function parseRedisEnvUrl () {
    if (process.env.RPS_REDIS_URL) {
        const parsedUrl = url.parse(process.env.RPS_REDIS_URL);
        if (parsedUrl.protocol === 'redis:' && parsedUrl.hostname && parsedUrl.port) {
            const connObj = {
                host: parsedUrl.hostname,
                port: parseInt(parsedUrl.port)
            };

            if (parsedUrl.auth) {
                connObj.auth = parsedUrl.auth.split(':')[1];
            }

            return connObj;
        } else {
            throw new Error(
                'RPS_REDIS_URL must contain following url format\n\tredis://redis:<password>@<hostname>:<port>'
            );
        }
    } else {
        return null;
    }
}


const redisConfig = parseRedisEnvUrl() || {};
let needToResubscribe;

RPS._createRedisClient = function createRedisClient (key, revive) {
    const logLabel = 'RPS: [' + key + '] ';

    RPS._status[key] = {errors: [], messages: 0, reconnects: 0};

    console.info(logLabel + 'connecting to Redis...', redisConfig);

    const client = RPS._clients[key] = Redis.createClient(
        redisConfig.port,
        redisConfig.host,
        {
            retry_strategy: function (options) {
                return Math.min(options.attempt * 100, 3000);
            },
            password: redisConfig.auth
        });

    client.on('error', function (err) {
        console.error(logLabel + err.toString());

        RPS._status[key].errors.push(err.toString());
    });

    client.on('connect', function () {
        console.info(logLabel + 'connected to Redis!');

        if (needToResubscribe) {
            resubscribe();
            needToResubscribe = false;
        }

        RPS._status[key].connected = true;
    });

    client.on('reconnecting', function () {
        console.info(logLabel + 'reconnecting to Redis...');

        RPS._status[key].connected = false;
        RPS._status[key].reconnects++;
    });

    client.on('end', function () {
        console.error(logLabel + 'end of the Redis? No...');

        RPS._status[key].connected = false;
    });

    client.on('message', function (channel, messageString) {
        RPS._status[key].messages++;

        let message;
        try {
            message = JSON.parse(messageString);
        } catch (err) {
            console.error(logLabel + 'failed `JSON.parse`; channel: ' + channel + ', messageString: ' + messageString, err.toString());

            RPS._status[key].errors.push(err.toString());
        }

        if (message && message._serverId !== RPS._serverId) {
            RPS._messenger.onMessage(channel, message, true);
        }
    });
}

RPS._createRedisClient('pub');
RPS._createRedisClient('sub');

RPS._sub = function (channel) {
    RPS._clients.sub.subscribe(channel);
};

RPS._unsub = function (channel) {
    RPS._clients.sub.unsubscribe(channel);
};

RPS._pub = function (channel, message) {
    RPS._status.pub.messages++;
    RPS._clients.pub.publish(channel, message);
};

function resubscribe () {
    _.each(RPS._messenger.channels, function (observerKeys, channel) {
        RPS._sub(channel);
    });
}
