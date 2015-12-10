RPS._serverId = Random.id();

var Redis = Npm.require('redis');
var createRedisClient = function (conf, logLabel) {
    conf = conf || {};

    logLabel = 'RPS: [' + logLabel + '] ';

    console.info(logLabel + 'connecting to redis...', redisConfToString(conf));

    var client = Redis.createClient(conf.port, conf.host, {
        retry_max_delay: 1000 * 30
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
        console.error(logLabel + 'no connection to Redis', err.toString())
    });

    client.on('connect', function () {
        console.info(logLabel + 'connected to Redis!');
    });

    client.on('reconnecting', function () {
        console.info(logLabel + 'reconnecting to Redis...');
    });

    client.on('subscribe', function (channel, count) {
        console.info(logLabel + 'subscribed to "' +  channel + '"' + ' (' + count + ')');
    });

    client.on('unsubscribe', function (channel, count) {
        console.info(logLabel + 'unsubscribed from "' +  channel + '"' + ' (' + count + ')');
    });

    client.on('message', function (channel, message) {
        console.info(logLabel + channel + ': ' + message);
    });

    return client;
};

var url = Npm.require('url');
var parseRedisEnvUrl = function _parseRedisEnvUrl () {
    if (process.env.RPS_REDIS_URL) {
        var parsedUrl = url.parse(process.env.RPS_REDIS_URL);
        if (parsedUrl.protocol == 'redis:' && parsedUrl.hostname && parsedUrl.port) {
            var connObj = {
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
};

var redisConfToString = function (conf) {
    var str = (conf.host || 'localhost') + ':' + (conf.port || 6379);
    if (conf.auth) {
        str = 'redis:' + conf.auth + '@' + str;
    }
    return str;
};

var redisConfig = parseRedisEnvUrl() || {};
var pubClient = createRedisClient(redisConfig, 'pub client');
var subClient = createRedisClient(redisConfig, 'sub client');

RPS._sub = function (channel) {
    subClient.subscribe(channel);
};

RPS._unsub = function (channel) {
    subClient.unsubscribe(channel);
};

RPS._pub = function (channel, message) {
    pubClient.publish(channel, message);
};