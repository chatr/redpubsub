RPS._serverId = Random.id();

const Redis = Npm.require('redis');
const url = Npm.require('url');

function createRedisClient (conf, key, revive) {
    conf = conf || {};

    const logLabel = 'RPS: [' + key + '] ';
    let needToResubscribe = revive;

    console.info(logLabel + 'connecting to Redis...', redisConfToString(conf));

    const client = Redis.createClient(
        conf.port,
        conf.host,
        {
            retry_strategy: function (options) {
                return Math.min(options.attempt * 100, 3000);
            }
        });

    if (conf.auth) {
        client.auth(conf.auth, afterAuthenticated);
    }

    function afterAuthenticated (err) {
        if (err) {
            throw err;
        }
    }

    client.on('error', function (err) {
        console.error(logLabel + err.toString())
    });

    client.on('connect', function () {
        console.info(logLabel + 'connected to Redis!');
        if (needToResubscribe) {
            resubscribe();
            needToResubscribe = false;
        }
    });

    client.on('reconnecting', function () {
        console.info(logLabel + 'reconnecting to Redis...');
    });

    client.on('end', function () {
        console.error(logLabel + 'end of the Redis? No...');
    });

    client.on('message', function (channel, messageString) {
        let message;
        try {
            message = JSON.parse(messageString);
        } catch (err) {
            console.error(logLabel + 'failed `JSON.parse`; channel: ' + channel + ', messageString: ' + messageString, err.toString());
        }

        if (message && message._serverId !== RPS._serverId) {
            RPS._messenger.onMessage(channel, message, true);
        }
    });

    return client;
}

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

function redisConfToString (conf) {
    let str = (conf.host || 'localhost') + ':' + (conf.port || 6379);
    if (conf.auth) {
        str = 'redis:' + conf.auth + '@' + str;
    }
    return str;
}

const redisConfig = parseRedisEnvUrl() || {};

const clients = {
    pub: createRedisClient(redisConfig, 'pub'),
    sub: createRedisClient(redisConfig, 'sub')
};

RPS._sub = function (channel) {
    clients.sub.subscribe(channel);
};

RPS._unsub = function (channel) {
    clients.sub.unsubscribe(channel);
};

RPS._pub = function (channel, message) {
    clients.pub.publish(channel, message);
};

function resubscribe () {
    _.each(RPS._messenger.channels, function (observerKeys, channel) {
        RPS._sub(channel);
    });
}