RPS._serverId = Random.id();

var Redis = Npm.require('redis');
var createRedisClient = function (conf, key, revive) {
    conf = conf || {};

    var logLabel = 'RPS: [' + key + '] ',
        needToResubscribe = revive;

    console.info(logLabel + 'connecting to Redis...', redisConfToString(conf));

    var client = Redis.createClient(conf.port, conf.host, {
        retry_max_delay: 1000 * 10
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

    /*client.on('idle', function () {
        console.info(logLabel + 'idle');
    });

    client.on('drain', function () {
        console.info(logLabel + 'drain');
    });*/

    client.on('end', Meteor.bindEnvironment(function () {
        client.end();
        console.error(logLabel + 'end of the Redis? No... Will try to revive!');
        Meteor.setTimeout(function () {
            reviveСlient(key);
        }, 1000 * 10);
    }));

    client.on('subscribe', function (channel, count) {
        console.info(logLabel + 'subscribed to "' +  channel + '"' + ' (' + count + ')');
    });

    client.on('unsubscribe', function (channel, count) {
        console.info(logLabel + 'unsubscribed from "' +  channel + '"' + ' (' + count + ')');
    });

    client.on('message', function (channel, messageString) {
        //console.log(logLabel + channel + ': ' + messageString);
        var message;
        try {
            message = JSON.parse(messageString);
        } catch (err) {
            console.error(logLabel + 'bad message: ' + channel + ': ' + messageString, err.toString());
        }

        if (message && message._serverId !== RPS._serverId) {
            RPS._messenger.onMessage(channel, message, true);
        }
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

var clients = {
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

var reviveСlient = function (key) {
    clients[key] = createRedisClient(redisConfig, key, key === 'sub');
};

var resubscribe = function () {
    console.info('RPS: resubscribe');
    _.each(RPS._messenger.channels, function (observerKeys, channel) {
        console.info('RPS: resubscribe to channel: ' + channel);
        RPS._sub(channel);
    });
};